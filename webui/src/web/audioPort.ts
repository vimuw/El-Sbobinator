import type { AudioReply, AudioRequest } from './audioTasks';
import type { AudioSource, CutResult, PreparedAudio } from './pipeline/run';

export type AudioWorkerLike = {
  postMessage(message: AudioRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<AudioReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

type RequestWithoutId = AudioRequest extends infer R ? (R extends AudioRequest ? Omit<R, 'id'> : never) : never;

export function createAudioWorker(): AudioWorkerLike {
  return new Worker(new URL('./audioWorker.ts', import.meta.url), { type: 'module', name: 'audio' }) as unknown as AudioWorkerLike;
}

/** The pipeline's AudioSource for one file, backed by the audio worker. */
export function createWorkerAudioSource(file: Blob, worker: AudioWorkerLike = createAudioWorker()): AudioSource & { dispose(): void } {
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const failAll = (error: Error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  worker.onmessage = event => {
    const reply = event.data;
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    if (reply.type === 'error') waiter.reject(new Error(reply.message));
    else waiter.resolve(reply.result);
  };
  worker.onerror = event => failAll(new Error(`Errore nel worker audio: ${event.message || 'sconosciuto'}`));

  const ask = (request: RequestWithoutId) => new Promise<unknown>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...request, id } as AudioRequest);
  });

  return {
    cut: (chunkSec, stepSec) => ask({ type: 'cut', file, chunkSec, stepSec }) as Promise<CutResult>,
    prepare: index => ask({ type: 'prepare', index }) as Promise<PreparedAudio>,
    toBase64: blob => ask({ type: 'base64', blob }) as Promise<string>,
    dispose: () => {
      failAll(new Error('Worker audio chiuso.'));
      worker.terminate();
    },
  };
}
