import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createCheckpointStore } from './checkpointStore';
import { defaultSettings } from './pipeline/run';
import { fileIdentity, newSession, sameFile } from './pipeline/session';

describe('checkpoint store', () => {
  it('saves a session and finds it again from the reselected file', async () => {
    const store = createCheckpointStore(new IDBFactory());
    const audio = new Blob([new Uint8Array(3 << 20).fill(7)]);
    const identity = await fileIdentity(audio, 'Lezione.m4a');
    expect(identity.headHash).toMatch(/^[0-9a-f]{64}$/);

    const older = newSession('old', identity, defaultSettings('gemini-2.5-flash'), 1);
    const state = newSession('new', identity, defaultSettings('gemini-2.5-flash'), 2);
    state.chunkTexts = ['primo blocco'];
    await store.save(older);
    await store.save(state);

    const again = await fileIdentity(new Blob([new Uint8Array(3 << 20).fill(7)]), 'Lezione.m4a');
    expect(sameFile(again, identity)).toBe(true);
    const found = await store.findByFile(again);
    expect(found?.id).toBe('new');
    expect(found?.chunkTexts).toEqual(['primo blocco']);
    expect(found).not.toHaveProperty('fileKey');
  });

  it('does not match a different file with the same name and size', async () => {
    const store = createCheckpointStore(new IDBFactory());
    const identity = await fileIdentity(new Blob([new Uint8Array(1024).fill(1)]), 'a.mp3');
    await store.save(newSession('s', identity, defaultSettings('gemini-3.6-flash')));
    const other = await fileIdentity(new Blob([new Uint8Array(1024).fill(2)]), 'a.mp3');
    expect(await store.findByFile(other)).toBeNull();
    expect((await store.get('s'))?.file).toEqual(identity);
    await store.delete('s');
    expect(await store.get('s')).toBeNull();
  });
});
