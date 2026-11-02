import { describe, expect, it } from 'vitest';
import { createFakeChannels, createFakeLocks } from './fakeDrive';
import { createTabLocks } from './tabLocks';

describe('tab locks', () => {
  it('runs one round at a time across the tabs of the site', async () => {
    const locks = createFakeLocks();
    const [first, second] = [createTabLocks(locks), createTabLocks(locks)];
    const steps: string[] = [];
    let finish!: () => void;
    const running = first.exclusive(async () => {
      steps.push('primo inizia');
      await new Promise<void>(resolve => { finish = resolve; });
      steps.push('primo finisce');
      return 1;
    });
    const waiting = second.exclusive(async () => {
      steps.push('secondo');
      return 2;
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(steps).toEqual(['primo inizia']);
    finish();
    expect(await Promise.all([running, waiting])).toEqual([1, 2]);
    expect(steps).toEqual(['primo inizia', 'primo finisce', 'secondo']);
  });

  it('shows the sbobina open in one tab\'s editor to the other tabs until it is released', async () => {
    const locks = createFakeLocks();
    const [editor, other] = [createTabLocks(locks), createTabLocks(locks)];
    const release = editor.holdEditor('web-session://a');
    const alsoHere = other.holdEditor('web-session://a');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await other.editorOpen('web-session://a')).toBe(true);
    expect(await other.editorOpen('web-session://b')).toBe(false);
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    // Still open in the second tab.
    expect(await editor.editorOpen('web-session://a')).toBe(true);
    alsoHere();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await editor.editorOpen('web-session://a')).toBe(false);
  });

  it('tells the other tabs, not itself, of a change held back for their editor', async () => {
    const [locks, channels] = [createFakeLocks(), createFakeChannels()];
    const [round, editor] = [createTabLocks(locks, channels), createTabLocks(locks, channels)];
    const [toRound, toEditor] = [[] as string[], [] as string[]];
    round.onEditorsTold(dir => toRound.push(dir));
    const stop = editor.onEditorsTold(dir => toEditor.push(dir));
    round.tellEditors('web-session://a');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(toEditor).toEqual(['web-session://a']);
    expect(toRound).toEqual([]);
    stop();
    round.tellEditors('web-session://b');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(toEditor).toEqual(['web-session://a']);
  });

  it('tells the other tabs, not itself, that an editor closed', async () => {
    const [locks, channels] = [createFakeLocks(), createFakeChannels()];
    const [closing, withToken] = [createTabLocks(locks, channels), createTabLocks(locks, channels)];
    const heard = { closing: 0, withToken: 0, told: [] as string[] };
    closing.onEditorClosed(() => { heard.closing += 1; });
    withToken.onEditorClosed(() => { heard.withToken += 1; });
    // The other kind of message does not count as a closed editor, nor the reverse.
    withToken.onEditorsTold(dir => heard.told.push(dir));
    closing.tellEditorClosed();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(heard).toEqual({ closing: 0, withToken: 1, told: [] });
  });

  it('lets each tab work alone where the browser has no Web Locks', async () => {
    const alone = createTabLocks(null, () => { throw new Error('no channel without Web Locks'); });
    alone.holdEditor('web-session://a')();
    expect(await alone.editorOpen('web-session://a')).toBe(false);
    expect(await alone.exclusive(async () => 'fatto')).toBe('fatto');
    alone.tellEditors('web-session://a');
    alone.onEditorsTold(() => undefined)();
    alone.tellEditorClosed();
    alone.onEditorClosed(() => undefined)();
  });
});
