import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { useEditorCollaboration, bytesToBase64 } from './useEditorCollaboration';

class MockBroadcastChannel {
  name: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  static instances: MockBroadcastChannel[] = [];

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage = vi.fn((data: unknown) => {
    MockBroadcastChannel.instances.forEach(instance => {
      if (instance !== this && instance.name === this.name && instance.onmessage) {
        instance.onmessage({ data } as MessageEvent);
      }
    });
  });

  close = vi.fn(() => {
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter(i => i !== this);
  });
}

const mockDestroy = vi.fn();

vi.mock('y-webrtc', () => {
  class MockWebrtcProvider {
    awareness: awarenessProtocol.Awareness;
    destroy = mockDestroy;
    constructor(_room: string, doc: Y.Doc) {
      this.awareness = new awarenessProtocol.Awareness(doc);
    }
  }
  return {
    WebrtcProvider: MockWebrtcProvider,
  };
});

describe('useEditorCollaboration Hook', () => {
  const originalBC = global.BroadcastChannel;

  beforeEach(() => {
    mockDestroy.mockClear();
    MockBroadcastChannel.instances = [];
    // @ts-expect-error Mocking global BroadcastChannel
    global.BroadcastChannel = MockBroadcastChannel;
    window.pywebview = {
      api: {
        send_collaboration_signal: vi.fn(),
      } as unknown as typeof window.pywebview.api,
    };
  });

  afterEach(() => {
    global.BroadcastChannel = originalBC;
    delete (window as unknown as { pywebview?: unknown }).pywebview;
    delete (window as unknown as { __elSbobinatorCollabListeners?: unknown }).__elSbobinatorCollabListeners;
    delete (window as unknown as { __elSbobinatorReceiveCollabSignal?: unknown }).__elSbobinatorReceiveCollabSignal;
  });

  it('returns null doc and provider when collaborationRoom is absent', () => {
    const { result } = renderHook(() => useEditorCollaboration(undefined));
    expect(result.current.ydoc).toBeNull();
    expect(result.current.provider).toBeNull();
  });

  it('initializes Y.Doc, WebRTC provider, and BroadcastChannel when room is provided', () => {
    const { result, unmount } = renderHook(() =>
      useEditorCollaboration('Room123', { name: 'Alice', color: '#ff0000' }),
    );

    expect(result.current.ydoc).toBeInstanceOf(Y.Doc);
    expect(result.current.provider).not.toBeNull();
    expect(MockBroadcastChannel.instances.length).toBe(1);
    expect(MockBroadcastChannel.instances[0].name).toBe('el-collab-room123');

    // Awareness user state set
    const awareness = result.current.provider?.awareness;
    expect(awareness?.getLocalState()?.user).toEqual({ name: 'Alice', color: '#ff0000' });

    // Initial signal sent
    expect(window.pywebview?.api?.send_collaboration_signal).toHaveBeenCalledWith(
      'room123',
      JSON.stringify({ type: 'yjs-request-state' }),
    );

    unmount();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('handles incoming bridge collaboration signals (yjs-update, yjs-awareness, yjs-request-state)', () => {
    const { result } = renderHook(() =>
      useEditorCollaboration('room123', { name: 'Bob', color: '#00ff00' }),
    );

    const doc = result.current.ydoc!;
    const awareness = result.current.provider!.awareness;

    // Simulate remote doc update via bridge
    const remoteDoc = new Y.Doc();
    const xmlText = remoteDoc.getText('test');
    xmlText.insert(0, 'Hello from remote');
    const updateBytes = Y.encodeStateAsUpdate(remoteDoc);
    const updatePayload = JSON.stringify({
      type: 'yjs-update',
      update: bytesToBase64(updateBytes),
    });

    const receiveFn = (window as unknown as { __elSbobinatorReceiveCollabSignal: (r: string, p: string) => void })
      .__elSbobinatorReceiveCollabSignal;
    expect(receiveFn).toBeDefined();

    act(() => {
      // Ignored for different room
      receiveFn('other-room', updatePayload);
    });
    expect(doc.getText('test').toString()).toBe('');

    act(() => {
      // Applied for correct room
      receiveFn('room123', updatePayload);
    });
    expect(doc.getText('test').toString()).toBe('Hello from remote');

    // Simulate incoming awareness update
    const remoteAwareness = new awarenessProtocol.Awareness(remoteDoc);
    remoteAwareness.setLocalStateField('user', { name: 'Charlie', color: '#0000ff' });
    const awUpdate = awarenessProtocol.encodeAwarenessUpdate(remoteAwareness, [remoteAwareness.clientID]);
    const awPayload = JSON.stringify({
      type: 'yjs-awareness',
      update: bytesToBase64(awUpdate),
    });

    act(() => {
      receiveFn('room123', awPayload);
    });
    expect(awareness.getStates().get(remoteAwareness.clientID)).toEqual({
      user: { name: 'Charlie', color: '#0000ff' },
    });

    // Simulate incoming request-state
    const reqPayload = JSON.stringify({ type: 'yjs-request-state' });
    act(() => {
      receiveFn('room123', reqPayload);
    });

    expect(window.pywebview?.api?.send_collaboration_signal).toHaveBeenCalledWith(
      'room123',
      expect.stringContaining('yjs-update'),
    );
  });

  it('broadcasts local doc and awareness updates to bridge and BroadcastChannel', () => {
    const { result } = renderHook(() =>
      useEditorCollaboration('room123', { name: 'Dan', color: '#123456' }),
    );

    const doc = result.current.ydoc!;
    const awareness = result.current.provider!.awareness;
    const bc = MockBroadcastChannel.instances[0];

    act(() => {
      doc.getText('test').insert(0, 'Local edit');
    });

    expect(window.pywebview?.api?.send_collaboration_signal).toHaveBeenCalledWith(
      'room123',
      expect.stringContaining('yjs-update'),
    );
    expect(bc.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'yjs-update' }),
    );

    act(() => {
      awareness.setLocalStateField('user', { name: 'Dan Updated', color: '#654321' });
    });

    expect(window.pywebview?.api?.send_collaboration_signal).toHaveBeenCalledWith(
      'room123',
      expect.stringContaining('yjs-awareness'),
    );
    expect(bc.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'yjs-awareness' }),
    );
  });

  it('handles BroadcastChannel onmessage events for updates and state requests', () => {
    const { result } = renderHook(() =>
      useEditorCollaboration('room123', { name: 'Eve', color: '#abcdef' }),
    );

    const doc = result.current.ydoc!;
    const awareness = result.current.provider!.awareness;
    const bc = MockBroadcastChannel.instances[0];

    const remoteDoc = new Y.Doc();
    remoteDoc.getText('test').insert(0, 'BC text');
    const updateBytes = Y.encodeStateAsUpdate(remoteDoc);

    act(() => {
      bc.onmessage?.({
        data: { type: 'yjs-update', update: bytesToBase64(updateBytes) },
      } as MessageEvent);
    });
    expect(doc.getText('test').toString()).toBe('BC text');

    const remoteAwareness = new awarenessProtocol.Awareness(remoteDoc);
    remoteAwareness.setLocalStateField('user', { name: 'Frank', color: '#999999' });
    const awUpdate = awarenessProtocol.encodeAwarenessUpdate(remoteAwareness, [remoteAwareness.clientID]);

    act(() => {
      bc.onmessage?.({
        data: { type: 'yjs-awareness', update: bytesToBase64(awUpdate) },
      } as MessageEvent);
    });
    expect(awareness.getStates().get(remoteAwareness.clientID)).toEqual({
      user: { name: 'Frank', color: '#999999' },
    });

    act(() => {
      bc.onmessage?.({
        data: { type: 'yjs-request-state' },
      } as MessageEvent);
    });
    expect(bc.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'yjs-update' }),
    );
  });
});
