import { describe, expect, it, vi } from 'vitest';
import { createWorkerAudioSource, type AudioWorkerLike } from './audioPort';
import { blobToBase64, createAudioTasks, type AudioReply, type AudioRequest } from './audioTasks';

const FRAME = (() => {
  const frame = new Uint8Array(417).fill(0x22);
  frame.set([0xff, 0xfb, 0x90, 0xc4]);
  return frame;
})();
const mp3 = (frames: number) => new Blob(Array.from({ length: frames }, () => FRAME), { type: 'audio/mpeg' });

// Runs the worker's tasks in-process, with the same message protocol.
function inProcessWorker(tasks: ReturnType<typeof createAudioTasks>): AudioWorkerLike {
  const worker: AudioWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (request: AudioRequest) => {
      void tasks.handle(request).then(reply => worker.onmessage?.({ data: reply } as MessageEvent<AudioReply>));
    },
    terminate: vi.fn(),
  };
  return worker;
}

describe('audio worker tasks', () => {
  it('encodes base64 in slices', async () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 256);
    expect(await blobToBase64(new Blob([bytes]))).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('cuts the file and sends Opus when the browser can encode it', async () => {
    const encode = vi.fn(async () => ({ ok: true as const, blob: new Blob(['opus'], { type: 'audio/ogg' }), ms: 12 }));
    const source = createWorkerAudioSource(mp3(1149), inProcessWorker(createAudioTasks({ canEncode: async () => true, encode })));
    const cut = await source.cut(10, 8);
    expect(cut.plan.map(chunk => Math.round(chunk.startSec))).toEqual([0, 8, 16, 24]);
    expect(cut.description).toBe('MP3 44100 Hz mono ~128 kbps');
    const prepared = await source.prepare(1);
    expect(prepared).toMatchObject({ mimeType: 'audio/ogg', codec: 'opus', encodeMs: 12 });
    expect(encode).toHaveBeenCalledOnce();
    // A chunk is handed out once; the page keeps it until its request succeeds.
    await expect(source.prepare(1)).rejects.toThrow(/non disponibile/);
    expect(await source.toBase64(new Blob(['ciao']))).toBe(btoa('ciao'));
  });

  it('falls back to the original chunk without Opus support or when encoding fails', async () => {
    const encode = vi.fn(async () => ({ ok: false as const, error: 'decoder' }));
    const unsupported = createWorkerAudioSource(mp3(400), inProcessWorker(createAudioTasks({ canEncode: async () => false, encode })));
    await unsupported.cut(900, 840);
    expect(await unsupported.prepare(0)).toMatchObject({ mimeType: 'audio/mpeg', codec: 'original', note: expect.stringContaining('Opus') });
    expect(encode).not.toHaveBeenCalled();

    const failing = createWorkerAudioSource(mp3(400), inProcessWorker(createAudioTasks({ canEncode: async () => true, encode })));
    await failing.cut(900, 840);
    expect(await failing.prepare(0)).toMatchObject({ codec: 'original', note: expect.stringContaining('decoder') });
  });

  it('rejects pending requests when the worker fails or is closed', async () => {
    const worker: AudioWorkerLike = { onmessage: null, onerror: null, postMessage: () => {}, terminate: vi.fn() };
    const source = createWorkerAudioSource(mp3(10), worker);
    const cut = source.cut(900, 840);
    worker.onerror?.({ message: 'boom' } as ErrorEvent);
    await expect(cut).rejects.toThrow('Errore nel worker audio: boom');
    const prepare = source.prepare(0);
    source.dispose();
    await expect(prepare).rejects.toThrow('Worker audio chiuso.');
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('reports a file that is not audio', async () => {
    const source = createWorkerAudioSource(new Blob([new Uint8Array(100)]), inProcessWorker(createAudioTasks({ canEncode: async () => false, encode: vi.fn() })));
    await expect(source.cut(900, 840)).rejects.toThrow(/Formato non riconosciuto/);
  });
});
