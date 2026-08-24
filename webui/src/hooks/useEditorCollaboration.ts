import { useEffect, useMemo } from 'react';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { WebrtcProvider } from 'y-webrtc';
import { registerCollabSignalListener } from '../bridge';

export function bytesToBase64(bytes: Uint8Array): string {
  const bin: string[] = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize))));
  }
  return btoa(bin.join(''));
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface CollaborationUser {
  name: string;
  color: string;
}

export function useEditorCollaboration(
  collaborationRoom?: string,
  collaborationUser?: CollaborationUser,
) {
  const collabState = useMemo(() => {
    if (!collaborationRoom) {
      return { ydoc: null, provider: null };
    }
    const doc = new Y.Doc();
    let webrtc: WebrtcProvider | null = null;
    try {
      const roomClean = collaborationRoom.trim().toLowerCase();
      const internalRoom = `elsbob-v1-${roomClean}`;
      webrtc = new WebrtcProvider(internalRoom, doc, {
        signaling: [
          'wss://y-webrtc.fly.dev',
          'wss://y-webrtc-signaling.onrender.com',
        ],
        password: roomClean,
        filterBcConns: false,
        peerOpts: {
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' },
              { urls: 'stun:stun.cloudflare.com:3478' },
            ],
          },
        },
      });
    } catch (err) {
      console.error('Errore inizializzazione WebRTC provider:', err);
    }
    return { ydoc: doc, provider: webrtc };
  }, [collaborationRoom]);

  useEffect(() => {
    if (!collaborationRoom || !collabState.ydoc) return;
    const roomClean = collaborationRoom.trim().toLowerCase();
    const doc = collabState.ydoc;
    const awareness = collabState.provider?.awareness;
    if (awareness) {
      awareness.setLocalStateField('user', collaborationUser || { name: 'Studente', color: '#3b82f6' });
    }

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(`el-collab-${roomClean}`);
        bc.onmessage = (event) => {
          if (event.data?.type === 'yjs-update' && event.data?.update) {
            try {
              const update = base64ToBytes(event.data.update);
              Y.applyUpdate(doc, update, 'local-bc');
            } catch (e) {
              console.error('Error applying BC update:', e);
            }
          } else if (event.data?.type === 'yjs-awareness' && event.data?.update && awareness) {
            try {
              const update = base64ToBytes(event.data.update);
              awarenessProtocol.applyAwarenessUpdate(awareness, update, 'local-bc');
            } catch (e) {
              console.error('Error applying BC awareness:', e);
            }
          } else if (event.data?.type === 'yjs-request-state') {
            const state = Y.encodeStateAsUpdate(doc);
            bc?.postMessage({ type: 'yjs-update', update: bytesToBase64(state) });
            if (awareness) {
              const awState = awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awareness.getStates().keys()));
              bc?.postMessage({ type: 'yjs-awareness', update: bytesToBase64(awState) });
            }
          }
        };
      }
    } catch (_) {}

    const receiveSignalHandler = (room: string, payloadStr: string) => {
      if (room !== roomClean) return;
      try {
        const data = JSON.parse(payloadStr);
        if (data.type === 'yjs-update' && data.update) {
          const update = base64ToBytes(data.update);
          Y.applyUpdate(doc, update, 'pywebview-bridge');
        } else if (data.type === 'yjs-awareness' && data.update && awareness) {
          const update = base64ToBytes(data.update);
          awarenessProtocol.applyAwarenessUpdate(awareness, update, 'pywebview-bridge');
        } else if (data.type === 'yjs-request-state') {
          const state = Y.encodeStateAsUpdate(doc);
          const payload = JSON.stringify({ type: 'yjs-update', update: bytesToBase64(state) });
          window.pywebview?.api?.send_collaboration_signal?.(roomClean, payload);
          if (awareness) {
            const awState = awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awareness.getStates().keys()));
            const awPayload = JSON.stringify({ type: 'yjs-awareness', update: bytesToBase64(awState) });
            window.pywebview?.api?.send_collaboration_signal?.(roomClean, awPayload);
          }
        }
      } catch (e) {
        console.error('Error parsing collab signal:', e);
      }
    };
    const unregisterSignal = registerCollabSignalListener(receiveSignalHandler);

    const handleDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'pywebview-bridge' || origin === 'local-bc') return;
      const b64 = bytesToBase64(update);
      const payload = JSON.stringify({ type: 'yjs-update', update: b64 });
      window.pywebview?.api?.send_collaboration_signal?.(roomClean, payload);
      bc?.postMessage({ type: 'yjs-update', update: b64 });
    };
    doc.on('update', handleDocUpdate);

    const handleAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === 'pywebview-bridge' || origin === 'local-bc' || !awareness) return;
      let changedClients = added.concat(updated).concat(removed);
      if (changedClients.length === 0) changedClients = [awareness.clientID];
      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients);
      const b64 = bytesToBase64(awarenessUpdate);
      const payload = JSON.stringify({ type: 'yjs-awareness', update: b64 });
      window.pywebview?.api?.send_collaboration_signal?.(roomClean, payload);
      bc?.postMessage({ type: 'yjs-awareness', update: b64 });
    };
    awareness?.on('update', handleAwarenessUpdate);

    const reqPayload = JSON.stringify({ type: 'yjs-request-state' });
    window.pywebview?.api?.send_collaboration_signal?.(roomClean, reqPayload);
    bc?.postMessage({ type: 'yjs-request-state' });

    return () => {
      unregisterSignal();
      doc.off('update', handleDocUpdate);
      awareness?.off('update', handleAwarenessUpdate);
      bc?.close();
      collabState.provider?.destroy();
      collabState.ydoc?.destroy();
    };
  }, [collaborationRoom, collabState, collaborationUser]);

  return collabState;
}
