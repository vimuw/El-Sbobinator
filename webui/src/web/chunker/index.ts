import { chunkMp3 } from './mp3';
import { chunkMp4 } from './mp4';
import type { ChunkOptions, ChunkResult, SourceFormat } from './types';

export * from './types';
export { chunkMp3 } from './mp3';
export { chunkMp4 } from './mp4';

/** Sniffs the container from the first bytes (not from the file name). */
export async function detectFormat(blob: Blob): Promise<SourceFormat | null> {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (b.length >= 8 && String.fromCharCode(b[4], b[5], b[6], b[7]) === 'ftyp') return 'mp4-aac';
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'mp3'; // ID3
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe6) === 0xe2) return 'mp3'; // sync + Layer III
  return null;
}

export async function chunkAudio(blob: Blob, opts: ChunkOptions = {}): Promise<ChunkResult> {
  const format = await detectFormat(blob);
  if (format === 'mp3') return chunkMp3(blob, opts);
  if (format === 'mp4-aac') return chunkMp4(blob, opts);
  throw new Error('Formato non riconosciuto: servono MP3 o M4A/MP4 (AAC)');
}
