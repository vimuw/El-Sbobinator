import { createLucideIcon } from 'lucide-react';

// The sidebar's Google Drive clouds that lucide has no matching drawing for. They reuse CloudCheck's
// cloud, open at the bottom, so all five states read as one set: lucide's CloudAlert draws a rounder
// right side, and CloudSync's turning arrows blur at 18px (a rotation never lands on whole pixels).
// The mark inside wears `sidebar-drive-mark`, which the stylesheet colours or moves.

export const CLOUD_CHECK_OUTLINE = 'M5.516 16.07A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 3.501 7.327';
const MARK = 'sidebar-drive-mark';

/** Linked but in trouble (a new login needed, or a failed round): a "!" under the cloud. */
export const CloudWarning = createLucideIcon('cloud-warning', [
  ['path', { d: 'M12 12v4', className: MARK, key: 'mark' }],
  ['path', { d: 'M12 20h.01', className: MARK, key: 'dot' }],
  ['path', { d: CLOUD_CHECK_OUTLINE, key: 'cloud' }],
]);

/** A round in progress: an arrow rising into the cloud, moved straight up so it stays sharp. */
export const CloudTransfer = createLucideIcon('cloud-transfer', [
  ['path', { d: 'M12 13v8', className: MARK, key: 'shaft' }],
  ['path', { d: 'm8.5 16.5 3.5-3.5 3.5 3.5', className: MARK, key: 'head' }],
  ['path', { d: CLOUD_CHECK_OUTLINE, key: 'cloud' }],
]);
