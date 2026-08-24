import { describe, expect, it } from 'vitest';
import { bytesToBase64, base64ToBytes } from './useEditorCollaboration';

describe('useEditorCollaboration bytes conversion', () => {
  it('encodes and decodes Uint8Array cleanly', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 128, 0]);
    const b64 = bytesToBase64(original);
    const roundtrip = base64ToBytes(b64);
    expect(Array.from(roundtrip)).toEqual(Array.from(original));
  });

  it('handles empty byte array', () => {
    const original = new Uint8Array([]);
    const b64 = bytesToBase64(original);
    const roundtrip = base64ToBytes(b64);
    expect(Array.from(roundtrip)).toEqual([]);
  });
});
