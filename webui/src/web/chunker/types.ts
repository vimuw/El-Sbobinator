// Shared types for the chunking module. No DOM or Node APIs here: the same
// code runs in the audio Web Worker (browser) and in Node (unit tests).

export type SourceFormat = 'mp3' | 'mp4-aac';

export interface Chunk {
  index: number;
  /** Start time in the source, seconds. */
  startSec: number;
  durationSec: number;
  sizeBytes: number;
  blob: Blob;
  mimeType: string;
  ext: string;
  /** Wall time spent producing this chunk (ms), from the end of the previous chunk. */
  cutMs: number;
}

export interface SourceInfo {
  format: SourceFormat;
  codec: string;
  sampleRate: number;
  channels: number;
  /** Average bitrate, kbps. */
  bitrateKbps: number;
  durationSec: number;
  /** MP3 only: details found while scanning. */
  notes: string[];
}

export interface ChunkOptions {
  /** Target chunk length in seconds. Default 900 (15 min), like the desktop app. */
  chunkSec?: number;
  /**
   * Distance between chunk starts, seconds. Default = chunkSec (no overlap).
   * The desktop app uses chunkSec 900 and stepSec 840 (60 s overlap): chunk k
   * covers [k*step, k*step + chunk], one chunk per step start inside the audio.
   */
  stepSec?: number;
  /** MP4 only: output container. Default 'adts' (.aac, audio/aac). */
  mp4Output?: 'adts' | 'm4a';
  /** Called as each chunk is ready (streaming: chunk 1 can be used before the rest is cut). */
  onChunk?: (chunk: Chunk) => void;
  /** Progress 0..1 based on source bytes / time consumed. */
  onProgress?: (fraction: number) => void;
}

export interface ChunkResult {
  info: SourceInfo;
  chunks: Chunk[];
  totalMs: number;
}

export const DEFAULT_CHUNK_SEC = 15 * 60;

export function now(): number {
  return globalThis.performance ? globalThis.performance.now() : Date.now();
}
