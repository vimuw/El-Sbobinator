// MP3 chunking without re-encoding: walk the frame headers, cut on frame
// boundaries every `chunkSec` seconds, and return each chunk as a zero-copy
// Blob.slice() of the source. Handles ID3v2 (start), ID3v1/APE (end),
// Xing/Info/VBRI header frames, CBR and VBR, and resyncs over garbage.

import { BlobReader } from './blobReader';
import { DEFAULT_CHUNK_SEC, now, type Chunk, type ChunkOptions, type ChunkResult, type SourceInfo } from './types';

// kbps, index 1..14. [MPEG1 L3, MPEG2/2.5 L3]
const BITRATES_L3 = [
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG1
  2: [22050, 24000, 16000], // MPEG2
  0: [11025, 12000, 8000], // MPEG2.5
};

export interface FrameHeader {
  version: number; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  bitrateKbps: number;
  sampleRate: number;
  channels: number;
  samples: number;
  length: number;
}

/** Parses a 4-byte MPEG audio Layer III header; null if not a valid one. */
export function parseHeader(b0: number, b1: number, b2: number, b3: number): FrameHeader | null {
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3;
  const layer = (b1 >> 1) & 3;
  if (version === 1 || layer !== 1) return null; // reserved version / not Layer III
  const brIdx = b2 >> 4;
  const srIdx = (b2 >> 2) & 3;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null; // free-format unsupported
  const padding = (b2 >> 1) & 1;
  const mpeg1 = version === 3;
  const bitrateKbps = BITRATES_L3[mpeg1 ? 0 : 1][brIdx];
  const sampleRate = SAMPLE_RATES[version][srIdx];
  const samples = mpeg1 ? 1152 : 576;
  const length = Math.floor(((mpeg1 ? 144 : 72) * bitrateKbps * 1000) / sampleRate) + padding;
  const channels = (b3 >> 6) === 3 ? 1 : 2;
  return { version, bitrateKbps, sampleRate, channels, samples, length };
}

function sameStream(a: FrameHeader, b: FrameHeader): boolean {
  return a.version === b.version && a.sampleRate === b.sampleRate;
}

/** Returns true if the frame at `pos` is a Xing/Info/VBRI metadata frame (no audio). */
function isVbrHeaderFrame(r: BlobReader, pos: number, h: FrameHeader): boolean {
  const mpeg1 = h.version === 3;
  const sideInfo = mpeg1 ? (h.channels === 1 ? 17 : 32) : h.channels === 1 ? 9 : 17;
  const tag = (o: number) => String.fromCharCode(r.at(o), r.at(o + 1), r.at(o + 2), r.at(o + 3));
  const x = pos + 4 + sideInfo;
  if (x + 4 <= pos + h.length) {
    const t = tag(x);
    if (t === 'Xing' || t === 'Info') return true;
  }
  if (pos + 36 + 4 <= pos + h.length && tag(pos + 36) === 'VBRI') return true;
  return false;
}

export async function chunkMp3(blob: Blob, opts: ChunkOptions = {}): Promise<ChunkResult> {
  const t0 = now();
  const chunkSec = opts.chunkSec ?? DEFAULT_CHUNK_SEC;
  const r = new BlobReader(blob);
  const notes: string[] = [];
  let pos = 0;

  // ID3v2 at start (possibly several stacked tags).
  for (;;) {
    await r.ensure(pos, 10);
    if (r.at(pos) === 0x49 && r.at(pos + 1) === 0x44 && r.at(pos + 2) === 0x33) {
      const flags = r.at(pos + 5);
      const size = ((r.at(pos + 6) & 0x7f) << 21) | ((r.at(pos + 7) & 0x7f) << 14) | ((r.at(pos + 8) & 0x7f) << 7) | (r.at(pos + 9) & 0x7f);
      const total = 10 + size + (flags & 0x10 ? 10 : 0);
      notes.push(`ID3v2 di ${total} byte saltato`);
      pos += total;
    } else break;
  }

  // Trailing tags: ID3v1 ("TAG", 128 bytes) and APEv2 footer.
  let end = r.size;
  if (end >= 128) {
    await r.ensure(end - 128, 3);
    if (r.at(end - 128) === 0x54 && r.at(end - 127) === 0x41 && r.at(end - 126) === 0x47) {
      end -= 128;
      notes.push('ID3v1 finale escluso');
    }
  }
  if (end >= 32) {
    await r.ensure(end - 32, 8);
    const s = String.fromCharCode(...r.bytes(end - 32, 8));
    if (s === 'APETAGEX') {
      await r.ensure(end - 20, 4);
      const tagSize = r.at(end - 20) | (r.at(end - 19) << 8) | (r.at(end - 18) << 16) | (r.at(end - 17) << 24);
      end -= tagSize + 32 > end ? 0 : tagSize + 32; // footer size field excludes the 32-byte header
      notes.push('APEv2 finale escluso');
    }
  }

  // Find the first frame (with next-frame confirmation).
  const syncAt = async (p: number): Promise<FrameHeader | null> => {
    if ((await r.ensure(p, 4)) < 4) return null;
    const h = parseHeader(r.at(p), r.at(p + 1), r.at(p + 2), r.at(p + 3));
    if (!h) return null;
    const q = p + h.length;
    if (q + 4 > end) return q <= end ? h : null;
    if ((await r.ensure(q, 4)) < 4) return h;
    const h2 = parseHeader(r.at(q), r.at(q + 1), r.at(q + 2), r.at(q + 3));
    return h2 && sameStream(h, h2) ? h : null;
  };
  const resync = async (from: number): Promise<{ pos: number; h: FrameHeader } | null> => {
    for (let p = from; p + 4 <= end; p++) {
      if (!r.has(p, 4)) await r.ensure(p, 4);
      if (r.at(p) !== 0xff) continue;
      const h = await syncAt(p);
      if (h) return { pos: p, h };
    }
    return null;
  };

  const first = await resync(pos);
  if (!first) throw new Error('Nessun frame MP3 valido trovato');
  if (first.pos !== pos) notes.push(`${first.pos - pos} byte non audio prima del primo frame`);
  pos = first.pos;
  const ref = first.h;
  await r.ensure(pos, ref.length);
  if (isVbrHeaderFrame(r, pos, ref)) {
    notes.push('Frame Xing/Info/VBRI escluso dai chunk');
    pos += ref.length;
  }

  const chunks: Chunk[] = [];
  const samplesPerChunk = chunkSec * ref.sampleRate;
  const samplesPerStep = (opts.stepSec ?? chunkSec) * ref.sampleRate;
  // Windows that are open at the current frame (two at a time while overlapping).
  const open: Array<{ startPos: number; startSamples: number; gridSamples: number }> = [];
  let nextStartSamples = 0;
  let totalSamples = 0;
  let audioBytes = 0;
  let skipped = 0;
  const bitrates = new Set<number>();
  let lastEmit = now();
  let lastProgress = 0;

  const emit = (w: { startPos: number; startSamples: number }, endPos: number) => {
    const c: Chunk = {
      index: chunks.length,
      startSec: w.startSamples / ref.sampleRate,
      durationSec: (totalSamples - w.startSamples) / ref.sampleRate,
      sizeBytes: endPos - w.startPos,
      blob: blob.slice(w.startPos, endPos, 'audio/mpeg'),
      mimeType: 'audio/mpeg',
      ext: 'mp3',
      cutMs: now() - lastEmit,
    };
    chunks.push(c);
    opts.onChunk?.(c);
    lastEmit = now();
  };

  while (pos + 4 <= end) {
    if (!r.has(pos, 4)) await r.ensure(pos, 4);
    let h = parseHeader(r.at(pos), r.at(pos + 1), r.at(pos + 2), r.at(pos + 3));
    if (!h || !sameStream(h, ref) || pos + h.length > end) {
      if (h && pos + h.length > end) break; // truncated last frame
      const rs = await resync(pos + 1);
      if (!rs) break;
      skipped += rs.pos - pos;
      // Bytes skipped go into the current chunk's slice; decoders ignore them.
      pos = rs.pos;
      h = rs.h;
    }
    while (open.length && totalSamples >= open[0].gridSamples + samplesPerChunk) emit(open.shift()!, pos);
    if (totalSamples >= nextStartSamples) {
      open.push({ startPos: pos, startSamples: totalSamples, gridSamples: nextStartSamples });
      nextStartSamples += samplesPerStep;
    }
    bitrates.add(h.bitrateKbps);
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
  notes.push(bitrates.size > 1 ? `VBR (${bitrates.size} bitrate diversi)` : `CBR ${[...bitrates][0]} kbps`);
  notes.push(`letti ${(r.bytesRead / 1048576).toFixed(1)} MiB in ${r.reads} letture`);
  opts.onProgress?.(1);

  const durationSec = totalSamples / ref.sampleRate;
  const info: SourceInfo = {
    format: 'mp3',
    codec: `MPEG-${ref.version === 3 ? '1' : ref.version === 2 ? '2' : '2.5'} Layer III`,
    sampleRate: ref.sampleRate,
    channels: ref.channels,
    bitrateKbps: Math.round((audioBytes * 8) / durationSec / 1000),
    durationSec,
    notes,
  };
  return { info, chunks, totalMs: now() - t0 };
}
