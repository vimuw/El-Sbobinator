// Re-encodes one chunk to Ogg/Opus 24 kbps mono with WebCodecs (AudioDecoder → AudioEncoder,
// driven by mediabunny's Conversion). 15 minutes become ~2.5 MiB, under Gemini's inline limit.
// Support is detected, never assumed: without it the pipeline uploads the original chunk.

import {
  ADTS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  MP3,
  MP4,
  OggOutputFormat,
  Output,
  Quality,
  canEncodeAudio,
} from 'mediabunny';
import { now } from './types';

export const OPUS_BITRATE = 24000;
export const OPUS_MIME = 'audio/ogg';

export async function canEncodeOpus(): Promise<boolean> {
  if (typeof (globalThis as { AudioEncoder?: unknown }).AudioEncoder !== 'function') return false;
  try {
    return await canEncodeAudio('opus', { numberOfChannels: 1, sampleRate: 48000, bitrate: OPUS_BITRATE });
  } catch {
    return false;
  }
}

export type OpusResult = { ok: true; blob: Blob; ms: number } | { ok: false; error: string };

export async function encodeOpus(chunk: Blob): Promise<OpusResult> {
  const input = new Input({ source: new BlobSource(chunk), formats: [MP3, ADTS, MP4] });
  try {
    const target = new BufferTarget();
    const output = new Output({ format: new OggOutputFormat(), target });
    const conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
      audio: { codec: 'opus', numberOfChannels: 1, sampleRate: 48000, quality: new Quality({ bitrate: OPUS_BITRATE }), forceTranscode: true },
    });
    if (!conversion.isValid) {
      return { ok: false, error: `conversione non valida: ${conversion.discardedTracks.map(track => track.reason).join(', ')}` };
    }
    const started = now();
    await conversion.execute();
    return { ok: true, blob: new Blob([target.buffer!], { type: OPUS_MIME }), ms: now() - started };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    input.dispose();
  }
}
