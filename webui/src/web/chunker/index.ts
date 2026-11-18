import { BlobReader } from './blobReader';
import { chunkAdts, isAdtsSync, parseAdtsHeader, sameAdtsStream } from './adts';
import { chunkMp3, parseHeader, sameStream, skipId3v2 } from './mp3';
import { chunkMp4 } from './mp4';
import { UnsupportedFormatError, type ChunkOptions, type ChunkResult, type SourceFormat } from './types';

export * from './types';
export { chunkAdts } from './adts';
export { chunkMp3 } from './mp3';
export { chunkMp4 } from './mp4';

/** How far past the ID3v2 tags the detector looks for the first audio frame. */
const SNIFF_BYTES = 64 * 1024;

/**
 * First audio frame in [from, from + SNIFF_BYTES), confirmed by the frame that follows it
 * (as the chunkers do), so padding or stray bytes after the tags don't decide the format.
 */
async function sniffFrame(r: BlobReader, from: number): Promise<'mp3' | 'adts-aac' | null> {
  const end = Math.min(r.size, from + SNIFF_BYTES);
  const bytesAt = async (p: number, n: number) => ((await r.ensure(p, n)) === n ? r.bytes(p, n) : null);
  for (let p = from; p < end; p++) {
    if (!r.has(p, 1)) await r.ensure(p, 1);
    if (r.at(p) !== 0xff) continue;
    const b = await bytesAt(p, 7);
    const adts = b && parseAdtsHeader(b);
    if (adts) {
      const n = await bytesAt(p + adts.length, 7);
      const next = n && parseAdtsHeader(n);
      if (!n || (next && sameAdtsStream(adts, next))) return 'adts-aac';
    }
    const m = (await bytesAt(p, 4)) ?? [];
    const mp3 = m.length === 4 ? parseHeader(m[0], m[1], m[2], m[3]) : null;
    if (mp3) {
      const n = await bytesAt(p + mp3.length, 4);
      const next = n && parseHeader(n[0], n[1], n[2], n[3]);
      if (!n || (next && sameStream(mp3, next))) return 'mp3';
    }
  }
  return null;
}

/** Sniffs the container from the first bytes (not from the file name). */
export async function detectFormat(blob: Blob): Promise<SourceFormat | null> {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (b.length >= 8 && String.fromCharCode(b[4], b[5], b[6], b[7]) === 'ftyp') return 'mp4-aac';
  if (b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    // ID3v2 sits in front of MP3 and of raw AAC alike: look at the first frame past every
    // stacked tag. With none in sight, keep MP3 (its chunker searches the whole file).
    const r = new BlobReader(blob, SNIFF_BYTES);
    return (await sniffFrame(r, await skipId3v2(r, 0))) ?? 'mp3';
  }
  if (b.length >= 2 && isAdtsSync(b[0], b[1])) return 'adts-aac';
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe6) === 0xe2) return 'mp3'; // sync + Layer III
  return null;
}

export async function chunkAudio(blob: Blob, opts: ChunkOptions = {}): Promise<ChunkResult> {
  const format = await detectFormat(blob);
  if (format === 'mp3') return chunkMp3(blob, opts);
  if (format === 'mp4-aac') return chunkMp4(blob, opts);
  if (format === 'adts-aac') return chunkAdts(blob, opts);
  throw new UnsupportedFormatError('Formato non riconosciuto: il contenuto non è audio MP3 né AAC in M4A/MP4');
}
