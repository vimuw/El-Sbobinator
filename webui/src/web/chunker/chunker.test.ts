import { BufferTarget, EncodedAudioPacketSource, EncodedPacket, Mp4OutputFormat, Output } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import { parseAdtsHeader } from './adts';
import { UnsupportedFormatError, chunkAudio, detectFormat } from './index';
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

  it('rejects files that are neither MP3, MP4 nor ADTS', async () => {
    await expect(chunkAudio(new Blob([new Uint8Array(64)]))).rejects.toThrow(/Formato non riconosciuto/);
    await expect(chunkAudio(new Blob([new Uint8Array(64)]))).rejects.toBeInstanceOf(UnsupportedFormatError);
  });
});

// AAC-LC, 48 kHz, stereo, no CRC, one raw block: 1024 samples per frame.
const ADTS_PAYLOAD = 90;
const ADTS_FRAME = ADTS_PAYLOAD + 7;
const ADTS_SEC = 1024 / 48000;

interface AdtsShape {
  /** Sample-rate index: 3 = 48 kHz, 4 = 44.1 kHz, 13+ is reserved. */
  freqIndex?: number;
  /** Channel configuration: 2 = stereo, 7 = 7.1 (8 channels). */
  channels?: number;
  /** protection_absent = 0: a 2-byte CRC follows the header, which is then 9 bytes. */
  crc?: boolean;
}

/** A 7-byte ADTS header of AAC-LC for a frame of `length` bytes, header included. */
function adtsHeader(length: number, { freqIndex = 3, channels = 2, crc = false }: AdtsShape = {}): number[] {
  return [
    0xff,
    crc ? 0xf0 : 0xf1,
    (1 << 6) | (freqIndex << 2) | ((channels >> 2) & 1),
    ((channels & 3) << 6) | (length >> 11),
    (length >> 3) & 0xff,
    ((length & 7) << 5) | 0x1f,
    0xfc,
  ];
}

function adtsFrames(count: number, payload = ADTS_PAYLOAD, shape: AdtsShape = {}): Uint8Array<ArrayBuffer> {
  const frame = payload + 7;
  const out = new Uint8Array(count * frame).fill(0x21);
  const header = adtsHeader(frame, shape);
  for (let i = 0; i < count; i += 1) out.set(header, i * frame);
  return out;
}

const tagId3v1 = () => {
  const tag = new Uint8Array(128);
  tag.set([0x54, 0x41, 0x47]);
  return tag;
};

describe('ADTS (raw AAC) chunking', () => {
  it('parses an ADTS header and tells it from an MP3 one', () => {
    expect(parseAdtsHeader(adtsFrames(1))).toMatchObject({ objectType: 2, sampleRate: 48000, channelConfig: 2, length: ADTS_FRAME, samples: 1024 });
    expect(parseAdtsHeader(FRAME_HEADER.concat([0, 0, 0]))).toBeNull(); // MP3 Layer III
  });

  // Regression: a bare ADTS stream named .m4a (some recorders) was refused as "Formato non riconosciuto".
  it('cuts overlapping windows of a bare ADTS stream on frame boundaries', async () => {
    const file = new Blob([adtsFrames(1407)], { type: 'audio/mp4' }); // ~30 s, labelled like the .m4a
    expect(await detectFormat(file)).toBe('adts-aac');
    const { info, chunks } = await chunkAudio(file, { chunkSec: 10, stepSec: 8 });
    expect(info).toMatchObject({ format: 'adts-aac', codec: 'mp4a.40.2', sampleRate: 48000, channels: 2 });
    expect(info.durationSec).toBeCloseTo(1407 * ADTS_SEC, 6);
    expect(chunks.map(chunk => Math.round(chunk.startSec))).toEqual([0, 8, 16, 24]);
    for (const chunk of chunks.slice(0, -1)) expect(chunk.durationSec).toBeGreaterThanOrEqual(10);
    for (const chunk of chunks) {
      const bytes = new Uint8Array(await chunk.blob.arrayBuffer());
      expect([bytes[0], bytes[1]]).toEqual([0xff, 0xf1]);
      expect(bytes.length % ADTS_FRAME).toBe(0);
      expect(chunk).toMatchObject({ mimeType: 'audio/aac', ext: 'aac' });
    }
  });

  it('reads ADTS behind an ID3v2 tag and over stray bytes', async () => {
    const file = new Blob([id3v2(50), adtsFrames(200), new Uint8Array([1, 2, 3]), adtsFrames(200)]);
    expect(await detectFormat(file)).toBe('adts-aac');
    const { info, chunks } = await chunkAudio(file, { chunkSec: 900 });
    expect(chunks).toHaveLength(1);
    expect(info.durationSec).toBeCloseTo(400 * ADTS_SEC, 6);
    expect(info.notes.join(' ')).toMatch(/ID3v2.*resync/);
  });

  // Regression: detection looked only right after the first ID3v2 tag, so these playable
  // files were taken for MP3 and refused as unreadable audio.
  it('detects ADTS behind two stacked ID3v2 tags', async () => {
    const file = new Blob([id3v2(50), id3v2(30), adtsFrames(200)]);
    expect(await detectFormat(file)).toBe('adts-aac');
    const { info } = await chunkAudio(file, { chunkSec: 900 });
    expect(info.durationSec).toBeCloseTo(200 * ADTS_SEC, 6);
    expect(info.notes.filter(note => note.includes('ID3v2'))).toHaveLength(2);
  });

  it('detects ADTS behind an ID3v2 tag followed by zero padding', async () => {
    const file = new Blob([id3v2(50), new Uint8Array(1000), adtsFrames(200)]);
    expect(await detectFormat(file)).toBe('adts-aac');
    const { info } = await chunkAudio(file, { chunkSec: 900 });
    expect(info.durationSec).toBeCloseTo(200 * ADTS_SEC, 6);
  });

  it('still detects MP3 behind stacked ID3v2 tags and padding', async () => {
    expect(await detectFormat(new Blob([id3v2(50), id3v2(30), mp3Frames(100)]))).toBe('mp3');
    expect(await detectFormat(new Blob([id3v2(50), new Uint8Array(1000), mp3Frames(100)]))).toBe('mp3');
  });

  it('rejects ADTS headers with a reserved rate or a length shorter than the header', () => {
    expect(parseAdtsHeader(adtsHeader(ADTS_FRAME, { freqIndex: 13 }))).toBeNull();
    expect(parseAdtsHeader(adtsHeader(7))).toBeNull();
    expect(parseAdtsHeader(adtsHeader(9, { crc: true }))).toBeNull(); // 7 + 2-byte CRC, no payload
    expect(parseAdtsHeader(adtsHeader(10, { crc: true }))).toMatchObject({ length: 10 });
    expect(parseAdtsHeader(adtsHeader(ADTS_FRAME, { channels: 7 }))).toMatchObject({ channelConfig: 7 });
  });

  it('stops before a truncated last frame and an ID3v1 tag, with CRC and 8 channels', async () => {
    const shape = { channels: 7, crc: true };
    const truncated = adtsFrames(1, ADTS_PAYLOAD, shape).slice(0, 50);
    const file = new Blob([adtsFrames(300, ADTS_PAYLOAD, shape), truncated, tagId3v1()]);
    expect(await detectFormat(file)).toBe('adts-aac');
    const { info, chunks } = await chunkAudio(file); // default window
    expect(info).toMatchObject({ format: 'adts-aac', channels: 8, sampleRate: 48000 });
    expect(info.durationSec).toBeCloseTo(300 * ADTS_SEC, 6);
    expect(info.notes.join(' ')).toMatch(/ID3v1/);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sizeBytes).toBe(300 * ADTS_FRAME);
  });

  it('skips a foreign header before and inside the stream and trailing junk', async () => {
    const foreign = adtsFrames(1, 13, { freqIndex: 4 }); // 20 bytes, 44.1 kHz instead of 48
    const junk = new Uint8Array([0xff, 0xf1, 0x7c, 0, 0, 0, 0, 0, 0, 0]); // reserved rate index 15
    const file = new Blob([foreign, adtsFrames(100), foreign, adtsFrames(100), junk]);
    expect(await detectFormat(file)).toBe('adts-aac');
    const { info, chunks } = await chunkAudio(file, { chunkSec: 900 });
    expect(info.sampleRate).toBe(48000);
    expect(info.durationSec).toBeCloseTo(200 * ADTS_SEC, 6);
    expect(info.notes).toContain('20 byte non audio prima del primo frame');
    expect(info.notes).toContain('20 byte non validi saltati (resync)');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sizeBytes).toBe(200 * ADTS_FRAME + 20); // the junk tail stays out
  });

  it('refuses a file that starts like ADTS but holds no valid frame', async () => {
    const file = new Blob([new Uint8Array([0xff, 0xf1, 0x7c]), new Uint8Array(200)]);
    expect(await detectFormat(file)).toBe('adts-aac');
    await expect(chunkAudio(file)).rejects.toMatchObject({ name: 'UnsupportedFormatError', message: 'Nessun frame AAC (ADTS) valido trovato' });
  });

  it('reads a file of a single ADTS frame', async () => {
    const { info, chunks } = await chunkAudio(new Blob([adtsFrames(1)]));
    expect(info.durationSec).toBeCloseTo(ADTS_SEC, 6);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sizeBytes).toBe(ADTS_FRAME);
  });

  it('reports progress through a long ADTS file', async () => {
    const payload = 8000; // ~8 KB frames: 1200 of them make ~9.6 MB, past one 8 MiB progress step
    const progress: number[] = [];
    const { info } = await chunkAudio(new Blob([adtsFrames(1200, payload)]), { chunkSec: 900, onProgress: p => progress.push(p) });
    expect(info.durationSec).toBeCloseTo(1200 * ADTS_SEC, 6);
    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress[0]).toBeGreaterThan(0);
    expect(progress[0]).toBeLessThan(1);
    expect(progress.at(-1)).toBe(1);
  });
});

describe('format detection behind ID3v2', () => {
  it('takes a lone frame after the tag for what it is', async () => {
    expect(await detectFormat(new Blob([id3v2(50), adtsFrames(1)]))).toBe('adts-aac');
    expect(await detectFormat(new Blob([id3v2(50), mp3Frames(1)]))).toBe('mp3');
  });

  it('passes over an ADTS header that the next frame does not confirm', async () => {
    const foreign = adtsFrames(1, 13, { freqIndex: 4 });
    expect(await detectFormat(new Blob([id3v2(50), foreign, mp3Frames(100)]))).toBe('mp3');
  });

  it('falls back to MP3 when no frame follows the tag', async () => {
    expect(await detectFormat(new Blob([id3v2(50), new Uint8Array(100)]))).toBe('mp3');
    expect(await detectFormat(new Blob([id3v2(50), new Uint8Array([0xff])]))).toBe('mp3');
  });

  it('skips an ID3v2 tag with a footer', async () => {
    const tag = id3v2(50);
    tag[5] = 0x10; // footer present: 10 more bytes after the tag
    const file = new Blob([tag, new Uint8Array(10), adtsFrames(50)]);
    expect(await detectFormat(file)).toBe('adts-aac');
    const { info } = await chunkAudio(file, { chunkSec: 900 });
    expect(info.notes).toContain('ID3v2 di 70 byte saltato');
    expect(info.durationSec).toBeCloseTo(50 * ADTS_SEC, 6);
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

  // An interrupted recording keeps ftyp (and maybe mdat) but never gets its moov index. It must stop
  // for good like any unreadable audio (webRun: Audio non leggibile), not as a block failure to retry.
  it('refuses an interrupted M4A recording without moov as unreadable audio', async () => {
    const box = (type: string, payload: number[]) => {
      const size = 8 + payload.length;
      return new Uint8Array([size >>> 24, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff, ...[...type].map(c => c.charCodeAt(0)), ...payload]);
    };
    const ftyp = box('ftyp', [...'M4A '].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'M4A isom'].map(c => c.charCodeAt(0))));
    const mdat = box('mdat', Array.from({ length: 4000 }, (_, i) => i % 251));
    for (const parts of [[ftyp, mdat], [ftyp]]) {
      const file = new Blob(parts, { type: 'audio/mp4' });
      expect(await detectFormat(file)).toBe('mp4-aac');
      await expect(chunkAudio(file)).rejects.toMatchObject({ name: 'UnsupportedFormatError', message: 'Nessuna traccia audio nel file' });
    }
  });
});
