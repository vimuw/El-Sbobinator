// M4A/MP4 (AAC) chunking without re-encoding: demux the AAC track with
// mediabunny (reads the File lazily through BlobSource) and remux the packets
// of each 15-minute window into ADTS (.aac) or a small .m4a.

import {
  ADTS,
  AdtsOutputFormat,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
  QTFF,
  type EncodedPacket,
} from 'mediabunny';
import { DEFAULT_CHUNK_SEC, now, type Chunk, type ChunkOptions, type ChunkResult, type SourceInfo } from './types';

export async function chunkMp4(blob: Blob, opts: ChunkOptions = {}): Promise<ChunkResult> {
  const t0 = now();
  const chunkSec = opts.chunkSec ?? DEFAULT_CHUNK_SEC;
  const container = opts.mp4Output ?? 'adts';
  const input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF, ADTS] });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('Nessuna traccia audio nel file');
    const codec = await track.getCodec();
    if (codec !== 'aac') throw new Error(`Codec ${codec ?? 'sconosciuto'} non supportato (serve AAC)`);
    const decoderConfig = await track.getDecoderConfig();
    if (!decoderConfig) throw new Error('Configurazione decoder AAC mancante');
    const sampleRate = await track.getSampleRate();
    const channels = await track.getNumberOfChannels();
    const durationSec = await input.computeDuration();
    const notes: string[] = [`codec ${decoderConfig.codec}`, `uscita ${container === 'adts' ? 'ADTS .aac' : '.m4a'}`];

    // Fast path: AAC-LC (and other ADTS-expressible configs) -> write ADTS headers
    // ourselves. mediabunny's muxer costs ~1-2 s per 15-min chunk in the browser.
    const asc = container === 'adts' ? parseAsc(decoderConfig.description) : null;
    const writerKind = asc ? 'adts-manual' : container === 'adts' ? 'adts-mediabunny' : 'm4a-mediabunny';
    notes.push(`muxer ${writerKind}`);
    const mimeType = container === 'adts' ? 'audio/aac' : 'audio/mp4';
    const ext = container === 'adts' ? 'aac' : 'm4a';

    const chunks: Chunk[] = [];
    let lastEmit = now();
    const stepSec = opts.stepSec ?? chunkSec;
    // Open windows (two at a time while overlapping), oldest first.
    type Out = { writer: ChunkWriter; start: number; end: number; gridStart: number };
    const outs: Out[] = [];

    const open = async (start: number, gridStart: number) => {
      const writer = asc ? new AdtsWriter(asc, (blob.size * 8) / durationSec, chunkSec) : await MediabunnyWriter.create(container, decoderConfig);
      outs.push({ writer, start, end: start, gridStart });
    };
    const close = async () => {
      const o = outs.shift();
      if (!o) return;
      const blob = await o.writer.finish(mimeType);
      const c: Chunk = {
        index: chunks.length,
        startSec: o.start,
        durationSec: o.end - o.start,
        sizeBytes: blob.size,
        blob,
        mimeType,
        ext,
        cutMs: now() - lastEmit,
      };
      chunks.push(c);
      opts.onChunk?.(c);
      lastEmit = now();
    };

    const sink = new EncodedPacketSink(track);
    let t0Packet: number | null = null;
    let nextStart = 0;
    let lastProgress = 0;
    let packets = 0;
    for await (const packet of sink.packets() as AsyncGenerator<EncodedPacket>) {
      packets++;
      t0Packet ??= packet.timestamp;
      // Cut on packet (AAC frame, 1024 samples) boundaries: every AAC packet is a key packet.
      const rel = packet.timestamp - t0Packet;
      // Close and open on the k*step grid, so window ends and starts never drift apart.
      while (outs.length && rel >= outs[0].gridStart + chunkSec - 1e-9) await close();
      if (rel >= nextStart - 1e-9) {
        await open(packet.timestamp, nextStart);
        nextStart += stepSec;
      }
      for (const o of outs) {
        await o.writer.add(packet, o.start);
        o.end = packet.timestamp + packet.duration;
      }
      if (opts.onProgress && durationSec > 0 && packet.timestamp - lastProgress > 30) {
        lastProgress = packet.timestamp;
        opts.onProgress(packet.timestamp / durationSec);
      }
    }
    while (outs.length) await close();
    notes.push(`${packets} pacchetti AAC`);
    opts.onProgress?.(1);

    // Overlapping chunks share packets: measure only the non-overlapping part.
    const totalBytes = chunks.reduce((s, c, i) => s + (i < chunks.length - 1 ? c.sizeBytes * Math.min(1, stepSec / c.durationSec) : c.sizeBytes), 0);
    const info: SourceInfo = {
      format: 'mp4-aac',
      codec: decoderConfig.codec,
      sampleRate,
      channels,
      bitrateKbps: Math.round((totalBytes * 8) / durationSec / 1000),
      durationSec,
      notes,
    };
    return { info, chunks, totalMs: now() - t0 };
  } finally {
    input.dispose();
  }
}

interface ChunkWriter {
  add(packet: EncodedPacket, chunkStart: number): void | Promise<void>;
  finish(mimeType: string): Promise<Blob>;
}

interface Asc {
  objectType: number;
  freqIndex: number;
  channelConfig: number;
}

/** Parses an AudioSpecificConfig; null when it can't be expressed in an ADTS header. */
export function parseAsc(description: AllowSharedBufferSource | undefined): Asc | null {
  if (!description) return null;
  const b = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description as ArrayBuffer);
  if (b.length < 2) return null;
  const objectType = b[0] >> 3;
  const freqIndex = ((b[0] & 7) << 1) | (b[1] >> 7);
  const channelConfig = (b[1] >> 3) & 15;
  // ADTS profile is 2 bits (object types 1-4); explicit frequency (15) and
  // channelConfig 0 (PCE) are not handled here: fall back to mediabunny.
  if (objectType < 1 || objectType > 4 || freqIndex > 12 || channelConfig === 0 || channelConfig > 7) return null;
  return { objectType, freqIndex, channelConfig };
}

/** Writes raw AAC frames with a 7-byte ADTS header each into one growing buffer. */
class AdtsWriter implements ChunkWriter {
  private buf: Uint8Array;
  private len = 0;

  constructor(private asc: Asc, avgBitrate: number, chunkSec: number) {
    // Pre-size for one chunk at the source's average bitrate (+5%) to avoid regrowth.
    const est = Number.isFinite(avgBitrate) ? (avgBitrate / 8) * chunkSec * 1.05 : 0;
    this.buf = new Uint8Array(Math.max(1 << 20, Math.round(est)));
  }

  add(packet: EncodedPacket): void {
    const n = packet.data.byteLength + 7;
    if (n > 0x1fff) throw new Error('Frame AAC troppo grande per ADTS');
    if (this.len + n > this.buf.length) {
      const bigger = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
      bigger.set(this.buf.subarray(0, this.len));
      this.buf = bigger;
    }
    const b = this.buf;
    const o = this.len;
    const { objectType, freqIndex, channelConfig } = this.asc;
    b[o] = 0xff;
    b[o + 1] = 0xf1; // MPEG-4, layer 0, no CRC
    b[o + 2] = ((objectType - 1) << 6) | (freqIndex << 2) | (channelConfig >> 2);
    b[o + 3] = ((channelConfig & 3) << 6) | (n >> 11);
    b[o + 4] = (n >> 3) & 0xff;
    b[o + 5] = ((n & 7) << 5) | 0x1f; // buffer fullness 0x7FF (VBR)
    b[o + 6] = 0xfc; // fullness low bits + 1 raw data block
    b.set(packet.data, o + 7);
    this.len += n;
  }

  async finish(mimeType: string): Promise<Blob> {
    // Copy out only the used bytes so the oversized buffer can be collected.
    return new Blob([this.buf.slice(0, this.len)], { type: mimeType });
  }
}

/** Generic path through mediabunny's muxers (ADTS for odd configs, or .m4a). */
class MediabunnyWriter implements ChunkWriter {
  private first = true;
  private constructor(
    private output: Output,
    private target: BufferTarget,
    private source: EncodedAudioPacketSource,
    private decoderConfig: AudioDecoderConfig,
  ) {}

  static async create(container: 'adts' | 'm4a', decoderConfig: AudioDecoderConfig): Promise<MediabunnyWriter> {
    const target = new BufferTarget();
    const format = container === 'adts' ? new AdtsOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' });
    const output = new Output({ format, target });
    const source = new EncodedAudioPacketSource('aac');
    output.addAudioTrack(source);
    await output.start();
    return new MediabunnyWriter(output, target, source, decoderConfig);
  }

  async add(packet: EncodedPacket, chunkStart: number): Promise<void> {
    const shifted = packet.clone({ timestamp: Math.max(0, packet.timestamp - chunkStart) });
    await this.source.add(shifted, this.first ? { decoderConfig: this.decoderConfig } : undefined);
    this.first = false;
  }

  async finish(mimeType: string): Promise<Blob> {
    await this.output.finalize();
    return new Blob([this.target.buffer!], { type: mimeType });
  }
}
