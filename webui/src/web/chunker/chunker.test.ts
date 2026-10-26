import { BufferTarget, EncodedAudioPacketSource, EncodedPacket, Mp4OutputFormat, Output } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import { chunkAudio, detectFormat } from './index';
import { parseHeader } from './mp3';
import { parseAsc } from './mp4';

// MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono, no padding: 417 bytes and 1152 samples per frame.
const FRAME_HEADER = [0xff, 0xfb, 0x90, 0xc4];
const FRAME_BYTES = 417;
const FRAME_SEC = 1152 / 44100;

function mp3Frames(count: number, fill = 0x11): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(count * FRAME_BYTES).fill(fill);
  for (let i = 0; i < count; i += 1) out.set(FRAME_HEADER, i * FRAME_BYTES);
  return out;
}

function id3v2(size: number): Uint8Array<ArrayBuffer> {
  const tag = new Uint8Array(10 + size);
  tag.set([0x49, 0x44, 0x33, 4, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  return tag;
}

describe('MP3 chunking', () => {
  it('parses a Layer III frame header', () => {
    expect(parseHeader(0xff, 0xfb, 0x90, 0xc4)).toMatchObject({ version: 3, bitrateKbps: 128, sampleRate: 44100, channels: 1, samples: 1152, length: 417 });
    expect(parseHeader(0xff, 0xfb, 0xf0, 0xc4)).toBeNull(); // bitrate index 15
    expect(parseHeader(0x00, 0xfb, 0x90, 0xc4)).toBeNull();
  });

  it('cuts overlapping windows on frame boundaries without copying audio', async () => {
    const tag = id3v2(100);
    const frames = mp3Frames(1149); // ~30 s
    const file = new Blob([tag, frames], { type: 'audio/mpeg' });
    expect(await detectFormat(file)).toBe('mp3');

    const seen: number[] = [];
    const { info, chunks } = await chunkAudio(file, { chunkSec: 10, stepSec: 8, onChunk: chunk => seen.push(chunk.index) });

    expect(info.format).toBe('mp3');
    expect(info.durationSec).toBeCloseTo(1149 * FRAME_SEC, 6);
    expect(info.notes.some(note => note.includes('ID3v2'))).toBe(true);
    // Starts every 8 s while inside the audio: 0, 8, 16, 24.
    expect(chunks.map(chunk => Math.round(chunk.startSec))).toEqual([0, 8, 16, 24]);
    expect(seen).toEqual([0, 1, 2, 3]);
    for (const chunk of chunks.slice(0, -1)) expect(chunk.durationSec).toBeGreaterThanOrEqual(10);
    expect(chunks.at(-1)!.durationSec).toBeCloseTo(info.durationSec - chunks.at(-1)!.startSec, 6);

    // Each chunk is a byte range of the source that starts on a frame header.
    for (const chunk of chunks) {
      const bytes = new Uint8Array(await chunk.blob.arrayBuffer());
      expect(Array.from(bytes.slice(0, 4))).toEqual(FRAME_HEADER);
      expect(bytes.length % FRAME_BYTES).toBe(0);
      expect(chunk.mimeType).toBe('audio/mpeg');
    }
  });

  it('skips the Xing frame, the ID3v1 tag and stray bytes', async () => {
    const xing = mp3Frames(1);
    xing.set([0x58, 0x69, 0x6e, 0x67], 4 + 17); // "Xing" after mono MPEG-1 side info
    const garbage = new Uint8Array([1, 2, 3]);
    const id3v1 = new Uint8Array(128);
    id3v1.set([0x54, 0x41, 0x47]);
    const file = new Blob([xing, mp3Frames(100), garbage, mp3Frames(100), id3v1]);
    const { info, chunks } = await chunkAudio(file, { chunkSec: 900 });
    expect(chunks).toHaveLength(1);
    expect(info.durationSec).toBeCloseTo(200 * FRAME_SEC, 6);
    expect(info.notes.join(' ')).toMatch(/Xing/);
    expect(info.notes.join(' ')).toMatch(/ID3v1/);
    expect(info.notes.join(' ')).toMatch(/resync/);
  });

  it('rejects files that are neither MP3 nor MP4', async () => {
    await expect(chunkAudio(new Blob([new Uint8Array(64)]))).rejects.toThrow(/Formato non riconosciuto/);
  });
});

async function syntheticM4a(seconds: number): Promise<Blob> {
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const source = new EncodedAudioPacketSource('aac');
  output.addAudioTrack(source);
  await output.start();
  const packetSec = 1024 / 48000;
  const decoderConfig = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1, description: new Uint8Array([0x11, 0x88]) };
  const count = Math.round(seconds / packetSec);
  for (let i = 0; i < count; i += 1) {
    const packet = new EncodedPacket(new Uint8Array(40).fill(i % 251), 'key', i * packetSec, packetSec);
    await source.add(packet, i === 0 ? { decoderConfig } : undefined);
  }
  await output.finalize();
  return new Blob([target.buffer!], { type: 'audio/mp4' });
}

describe('M4A chunking', () => {
  it('reads the AudioSpecificConfig that ADTS can express', () => {
    expect(parseAsc(new Uint8Array([0x11, 0x88]))).toEqual({ objectType: 2, freqIndex: 3, channelConfig: 1 });
    expect(parseAsc(new Uint8Array([0x2b, 0x88]))).toBeNull(); // object type 5 (SBR)
    expect(parseAsc(undefined)).toBeNull();
  });

  it('remuxes overlapping windows into ADTS frames', async () => {
    const file = await syntheticM4a(25);
    expect(await detectFormat(file)).toBe('mp4-aac');
    const { info, chunks } = await chunkAudio(file, { chunkSec: 10, stepSec: 8 });
    expect(info.format).toBe('mp4-aac');
    expect(info.sampleRate).toBe(48000);
    expect(chunks.map(chunk => Math.round(chunk.startSec))).toEqual([0, 8, 16, 24]);
    expect(chunks[0].durationSec).toBeCloseTo(10, 1);
    expect(chunks[0].mimeType).toBe('audio/aac');

    const bytes = new Uint8Array(await chunks[0].blob.arrayBuffer());
    // ADTS sync word, MPEG-4, no CRC; frame length = 7-byte header + 40-byte payload.
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xf1);
    expect(((bytes[3] & 3) << 11) | (bytes[4] << 3) | (bytes[5] >> 5)).toBe(47);
    expect(bytes.length % 47).toBe(0);
  });
});
