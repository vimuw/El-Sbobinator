// Coordination between the tabs of this site through the Web Locks API, whose locks every tab of
// the origin sees: one Drive round at a time (two tabs would create the same file twice), and the
// sbobine open in any tab's editor, which another tab's round must not overwrite. Without the API
// (older browsers) each tab coordinates only with itself, as before. A BroadcastChannel tells the
// tab whose editor has a sbobina open that another tab's round held a Drive change back for it, and
// the tabs with a token that an editor closed in a tab without one, so they bring the change in.

const SYNC_LOCK = 'el-sbobinator-drive-sync';
const EDITOR_LOCK = 'el-sbobinator-editor:';
const CHANNEL = 'el-sbobinator-tabs';
const CHANGED_ELSEWHERE = 'document-changed-elsewhere';
const EDITOR_CLOSED = 'editor-closed';

/** The part of BroadcastChannel the tabs use (tests pass fake ones shared by their "tabs"). */
export type TabChannel = Pick<BroadcastChannel, 'postMessage' | 'addEventListener' | 'removeEventListener'>;

export interface TabLocks {
  /** Runs `run` while no other tab runs one (a Drive round, the emptying of the Drive folder). */
  exclusive<T>(run: () => Promise<T>): Promise<T>;
  /** Marks the sbobina as open in this tab's editor until the returned function is called. */
  holdEditor(sessionDir: string): () => void;
  /** Whether the editor of any tab has the sbobina open. */
  editorOpen(sessionDir: string): Promise<boolean>;
  /** Tells the other tabs that a change from Drive to this sbobina waits for their editor to close. */
  tellEditors(sessionDir: string): void;
  /** Calls `listener` for each tellEditors() of another tab; returns the cleanup. */
  onEditorsTold(listener: (sessionDir: string) => void): () => void;
  /** Tells the other tabs that this tab's editor closed while this tab runs no rounds (no token). */
  tellEditorClosed(): void;
  /** Calls `listener` for each tellEditorClosed() of another tab; returns the cleanup. */
  onEditorClosed(listener: () => void): () => void;
}

type TabMessage = { kind: typeof CHANGED_ELSEWHERE; session_dir: string } | { kind: typeof EDITOR_CLOSED; session_dir?: never };

function openBroadcastChannel(): TabChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
  } catch {
    return null;
  }
}

export function createTabLocks(
  locks: LockManager | null | undefined = globalThis.navigator?.locks,
  openChannel: () => TabChannel | null = openBroadcastChannel,
): TabLocks {
  // Opened on first use, and only with Web Locks: without them no tab sees another's editor.
  let channel: TabChannel | null | undefined;
  const tabs = () => (channel === undefined ? (channel = locks ? openChannel() : null) : channel);

  return {
    exclusive: run => (locks ? locks.request(SYNC_LOCK, () => run()) : run()),

    holdEditor(sessionDir) {
      if (!locks) return () => {};
      let release = () => {};
      const held = new Promise<void>(resolve => { release = resolve; });
      // Shared: the same sbobina may be open in two tabs.
      void locks.request(`${EDITOR_LOCK}${sessionDir}`, { mode: 'shared' }, () => held).catch(() => undefined);
      return release;
    },

    async editorOpen(sessionDir) {
      if (!locks) return false;
      const name = `${EDITOR_LOCK}${sessionDir}`;
      try {
        const { held = [], pending = [] } = await locks.query();
        return [...held, ...pending].some(lock => lock.name === name);
      } catch {
        return false;
      }
    },

    tellEditors: sessionDir => post({ kind: CHANGED_ELSEWHERE, session_dir: sessionDir }),
    onEditorsTold: listener => listen(data => {
      if (data.kind === CHANGED_ELSEWHERE && typeof data.session_dir === 'string') listener(data.session_dir);
    }),
    tellEditorClosed: () => post({ kind: EDITOR_CLOSED }),
    onEditorClosed: listener => listen(data => {
      if (data.kind === EDITOR_CLOSED) listener();
    }),
  };

  function post(message: TabMessage) {
    try {
      tabs()?.postMessage(message);
    } catch {
      // Channel closed: the message is lost, the change still waits on Drive for the next round.
    }
  }

  function listen(handle: (data: Partial<Record<keyof TabMessage, unknown>>) => void): () => void {
    const channel = tabs();
    if (!channel) return () => {};
    const onMessage = (event: Event) => {
      const data = (event as MessageEvent).data as Partial<Record<keyof TabMessage, unknown>> | null;
      if (data && typeof data === 'object') handle(data);
    };
    channel.addEventListener('message', onMessage);
    return () => channel.removeEventListener('message', onMessage);
  }
}
