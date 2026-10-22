// Minimal ZIP for the web backup: entries are stored uncompressed (audio is already compressed and
// the text is small next to it), so the file is assembled from Blob parts without copying the audio
// into memory. Reading accepts stored and deflated entries (a backup re-zipped by another tool) and
// hands entries back as Blob slices of the picked file. No ZIP64: a backup stays under 4 GB.

export interface ZipInput {
  name: string;
  data: Blob;
  lastModified?: number;
}

export interface ZipEntry {
  name: string;
  size: number;
  blob(): Promise<Blob>;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_NAMES = 0x0800;
const MAX_ZIP_BYTES = 0xffffffff;
const CRC_CHUNK_BYTES = 4 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function updateCrc(crc: number, bytes: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c;
}

/** CRC-32 of a Blob, read in slices so a long lecture never sits in memory at once. */
export async function crc32(blob: Blob, onBytes?: (bytes: number) => void): Promise<number> {
  let crc = 0xffffffff;
  for (let start = 0; start < blob.size; start += CRC_CHUNK_BYTES) {
    const slice = blob.slice(start, Math.min(blob.size, start + CRC_CHUNK_BYTES));
    crc = updateCrc(crc, new Uint8Array(await slice.arrayBuffer()));
    onBytes?.(slice.size);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(timestamp: number): { time: number; date: number } {
  const date = new Date(timestamp);
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Builds a ZIP of stored entries. onProgress gets the bytes checksummed so far and the total, the
 * only slow step (every byte is read once).
 */
export async function createZip(inputs: ZipInput[], onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const encoder = new TextEncoder();
  const total = inputs.reduce((sum, input) => sum + input.data.size, 0);
  let done = 0;
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const input of inputs) {
    const name = encoder.encode(input.name) as Uint8Array<ArrayBuffer>;
    const crc = await crc32(input.data, bytes => {
      done += bytes;
      onProgress?.(done, total);
    });
    const { time, date } = dosDateTime(input.lastModified ?? Date.now());
    const size = input.data.size;
    if (offset + 30 + name.length + size > MAX_ZIP_BYTES) {
      throw new Error('Backup troppo grande (oltre 4 GB): scaricalo senza gli audio.');
    }

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL_HEADER, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, input.data);

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, CENTRAL_HEADER, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, UTF8_NAMES, true);
    header.setUint16(10, 0, true);
    header.setUint16(12, time, true);
    header.setUint16(14, date, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, size, true);
    header.setUint32(24, size, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);
    const record = new Uint8Array(46 + name.length);
    record.set(new Uint8Array(header.buffer), 0);
    record.set(name, 46);
    central.push(record);
    offset += 30 + name.length + size;
  }
  const centralSize = central.reduce((sum, record) => sum + record.length, 0);
  if (inputs.length > 0xffff || offset + centralSize + 22 > MAX_ZIP_BYTES) {
    throw new Error('Backup troppo grande (oltre 4 GB): scaricalo senza gli audio.');
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
  end.setUint16(8, inputs.length, true);
  end.setUint16(10, inputs.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

export class ZipFormatError extends Error {}

async function bytesOf(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

/** Entries of a ZIP file, by name. Throws ZipFormatError for a file that is not a readable ZIP. */
export async function readZip(file: Blob): Promise<Map<string, ZipEntry>> {
  // The end record sits in the last 22 bytes plus an optional comment of up to 64 KB.
  const tailStart = Math.max(0, file.size - 22 - 0xffff);
  const tail = await bytesOf(file, tailStart, file.size);
  let endAt = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) throw new ZipFormatError('Il file non è un backup di El Sbobinator o è incompleto (download interrotto?).');
  const count = tail.getUint16(endAt + 10, true);
  const centralSize = tail.getUint32(endAt + 12, true);
  const centralOffset = tail.getUint32(endAt + 16, true);
  if (centralOffset === 0xffffffff || centralOffset + centralSize > file.size) {
    throw new ZipFormatError('Il file non è un backup di El Sbobinator o è incompleto (download interrotto?).');
  }
  const directory = await bytesOf(file, centralOffset, centralOffset + centralSize);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > directory.byteLength || directory.getUint32(at, true) !== CENTRAL_HEADER) {
      throw new ZipFormatError('Indice del file ZIP danneggiato.');
    }
    const method = directory.getUint16(at + 10, true);
    const compressedSize = directory.getUint32(at + 20, true);
    const size = directory.getUint32(at + 24, true);
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    const localOffset = directory.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(directory.buffer, directory.byteOffset + at + 46, nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    entries.set(name, {
      name,
      size,
      async blob() {
        const local = await bytesOf(file, localOffset, localOffset + 30);
        if (local.byteLength < 30 || local.getUint32(0, true) !== LOCAL_HEADER) throw new ZipFormatError(`Voce ${name} danneggiata nel file ZIP.`);
        const start = localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
        const data = file.slice(start, start + compressedSize);
        if (data.size !== compressedSize) throw new ZipFormatError(`Voce ${name} incompleta nel file ZIP.`);
        if (method === 0) return data;
        if (method === 8 && typeof DecompressionStream === 'function') {
          return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        }
        throw new ZipFormatError(`Voce ${name} compressa in un formato non supportato.`);
      },
    });
  }
  return entries;
}
