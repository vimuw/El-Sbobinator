// Raw AAC (ADTS) chunking without re-encoding: some recorders write a bare ADTS stream and name
// it .m4a. Every ADTS frame carries its own header and length, so, like MP3, a chunk is just a
// zero-copy Blob.slice() of the source cut on a frame boundary. Skips ID3v2 (start) and ID3v1
// (end) and resyncs over garbage.

import { BlobReader } from './blobReader';
import { skipId3v2 } from './mp3';
import { DEFAULT_CHUNK_SEC, UnsupportedFormatError, now, type Chunk, type ChunkOptions, type ChunkResult, type SourceInfo } from './types';

const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export interface AdtsHeader {
  /** Audio object type (profile + 1): 2 = AAC-LC. */
  objectType: number;
  freqIndex: number;
  sampleRate: number;
  channelConfig: number;
  /** Whole frame, header included. */
  length: number;
  samples: number;
}

/** True if two bytes start an ADTS header: 12-bit sync and layer 00 (MP3 frames have layer ≠ 00). */
export const isAdtsSync = (b0: number, b1: number): boolean => b0 === 0xff && (b1 & 0xf6) === 0xf0;

/** Parses a 7-byte ADTS header; null if not a valid one. */
export function parseAdtsHeader(b: ArrayLike<number>): AdtsHeader | null {
  if (!isAdtsSync(b[0], b[1])) return null;
  const freqIndex = (b[2] >> 2) & 15;
  if (freqIndex >= SAMPLE_RATES.length) return null;
  const length = ((b[3] & 3) << 11) | (b[4] << 3) | (b[5] >> 5);
  const headerLength = b[1] & 1 ? 7 : 9; // protection_absent = 0 adds a 2-byte CRC
  if (length <= headerLength) return null;
  return {
    objectType: (b[2] >> 6) + 1,
    freqIndex,
    sampleRate: SAMPLE_RATES[freqIndex],
    channelConfig: ((b[2] & 1) << 2) | (b[3] >> 6),
    length,
    samples: ((b[6] & 3) + 1) * 1024,
  };
}

export const sameAdtsStream = (a: AdtsHeader, b: AdtsHeader) =>
  a.objectType === b.objectType && a.freqIndex === b.freqIndex && a.channelConfig === b.channelConfig;

export async function chunkAdts(blob: Blob, opts: ChunkOptions = {}): Promise<ChunkResult> {
  const t0 = now();
  const chunkSec = opts.chunkSec ?? DEFAULT_CHUNK_SEC;
  const r = new BlobReader(blob);
  const notes: string[] = [];
  let pos = await skipId3v2(r, 0, notes);
  let end = r.size;
  if (end >= 128) {
    await r.ensure(end - 128, 3);
    if (r.at(end - 128) === 0x54 && r.at(end - 127) === 0x41 && r.at(end - 126) === 0x47) {
      end -= 128;
      notes.push('ID3v1 finale escluso');
    }
  }

  const headerAt = async (p: number): Promise<AdtsHeader | null> => {
    if (p + 7 > end) return null;
    if (!r.has(p, 7)) await r.ensure(p, 7);
    return parseAdtsHeader(r.bytes(p, 7));
  };
  // A header counts only if the next one follows it (or it is the last frame).
  const syncAt = async (p: number): Promise<AdtsHeader | null> => {
    const h = await headerAt(p);
    if (!h || p + h.length > end) return null;
    if (p + h.length + 7 > end) return h;
    const next = await headerAt(p + h.length);
    return next && sameAdtsStream(h, next) ? h : null;
  };
  const resync = async (from: number): Promise<{ pos: number; h: AdtsHeader } | null> => {
    for (let p = from; p + 7 <= end; p++) {
      if (!r.has(p, 2)) await r.ensure(p, 2);
      if (r.at(p) !== 0xff) continue;
      const h = await syncAt(p);
      if (h) return { pos: p, h };
    }
    return null;
  };

  const first = await resync(pos);
  if (!first) throw new UnsupportedFormatError('Nessun frame AAC (ADTS) valido trovato');
  if (first.pos !== pos) notes.push(`${first.pos - pos} byte non audio prima del primo frame`);
  pos = first.pos;
  const ref = first.h;

  const chunks: Chunk[] = [];
  const samplesPerChunk = chunkSec * ref.sampleRate;
  const samplesPerStep = (opts.stepSec ?? chunkSec) * ref.sampleRate;
  // Windows open at the current frame (two at a time while overlapping), oldest first.
  const open: Array<{ startPos: number; startSamples: number; gridSamples: number }> = [];
  let nextStartSamples = 0;
  let totalSamples = 0;
  let audioBytes = 0;
  let skipped = 0;
  let lastEmit = now();
  let lastProgress = 0;

  const emit = (w: { startPos: number; startSamples: number }, endPos: number) => {
    const c: Chunk = {
      index: chunks.length,
      startSec: w.startSamples / ref.sampleRate,
      durationSec: (totalSamples - w.startSamples) / ref.sampleRate,
      sizeBytes: endPos - w.startPos,
      blob: blob.slice(w.startPos, endPos, 'audio/aac'),
      mimeType: 'audio/aac',
      ext: 'aac',
      cutMs: now() - lastEmit,
    };
    chunks.push(c);
    opts.onChunk?.(c);
    lastEmit = now();
  };

  while (pos + 7 <= end) {
    // Hot loop: await only when the reader window has to be refilled.
    if (!r.has(pos, 7)) await r.ensure(pos, 7);
    let h = parseAdtsHeader(r.bytes(pos, 7));
    if (!h || !sameAdtsStream(h, ref) || pos + h.length > end) {
      if (h && pos + h.length > end) break; // truncated last frame
      const rs = await resync(pos + 1);
      if (!rs) break;
      // Bytes skipped stay inside the current chunk's slice; decoders resync over them.
      skipped += rs.pos - pos;
      pos = rs.pos;
      h = rs.h;
    }
    while (open.length && totalSamples >= open[0].gridSamples + samplesPerChunk) emit(open.shift()!, pos);
    if (totalSamples >= nextStartSamples) {
      open.push({ startPos: pos, startSamples: totalSamples, gridSamples: nextStartSamples });
      nextStartSamples += samplesPerStep;
    }
    totalSamples += h.samples;
    audioBytes += h.length;
    pos += h.length;
    if (opts.onProgress && pos - lastProgress > 8 * 1024 * 1024) {
      lastProgress = pos;
      opts.onProgress(pos / r.size);
    }
  }
  for (const w of open) emit(w, pos);
  if (skipped) notes.push(`${skipped} byte non validi saltati (resync)`);
  notes.push(`letti ${(r.bytesRead / 1048576).toFixed(1)} MiB in ${r.reads} letture`);
  opts.onProgress?.(1);

  const durationSec = totalSamples / ref.sampleRate;
  const info: SourceInfo = {
    format: 'adts-aac',
    codec: `mp4a.40.${ref.objectType}`,
    sampleRate: ref.sampleRate,
    channels: ref.channelConfig === 7 ? 8 : ref.channelConfig,
    bitrateKbps: durationSec > 0 ? Math.round((audioBytes * 8) / durationSec / 1000) : 0,
    durationSec,
    notes,
  };
  return { info, chunks, totalMs: now() - t0 };
}
