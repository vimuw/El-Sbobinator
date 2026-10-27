// The web build answers on more than one address, and each one keeps its own archive in the
// browser. The official one is CANONICAL_WEB_URL; on an old address that still holds sbobine the
// app stays put and shows a notice (web/canonicalOrigin.ts decides, MovedAddressBanner shows it).
export const CANONICAL_WEB_HOST = 'elsbobinator.com';
export const CANONICAL_WEB_URL = `https://${CANONICAL_WEB_HOST}`;

let movedAddressNotice = false;

export function setMovedAddressNotice(value: boolean): void {
  movedAddressNotice = value;
}

export function hasMovedAddressNotice(): boolean {
  return movedAddressNotice;
}
