import { describe, expect, it } from 'vitest';
import { ZipFormatError, crc32, createZip, readZip } from './zipArchive';

/** A one-entry ZIP whose entry is deflated and declares `size` bytes once inflated (CRC left out). */
async function deflatedZip(name: string, raw: Uint8Array<ArrayBuffer>, size: number): Promise<Blob> {
  const data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const nameBytes = new TextEncoder().encode(name);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(8, 8, true);
  local.setUint32(18, data.length, true);
  local.setUint32(22, size, true);
  local.setUint16(26, nameBytes.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(10, 8, true);
  central.setUint32(20, data.length, true);
  central.setUint32(24, size, true);
  central.setUint16(28, nameBytes.length, true);
  const centralOffset = 30 + nameBytes.length + data.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + nameBytes.length, true);
  end.setUint32(16, centralOffset, true);
  return new Blob([local.buffer, nameBytes, data, central.buffer, nameBytes, end.buffer]);
}

// Made by Python's zipfile with ZIP_DEFLATED: a folder entry and a deflated text, as another tool
// would re-zip a backup.
const DEFLATED_ZIP = 'UEsDBBQAAAAIAAB8Vl0AAAAAAgAAAAAAAAAJAAAAY2FydGVsbGEvAwBQSwMEFAAAAAgAAHxWXYsONCQfAAAAfgAAAAkAAAB0ZXN0by50eHRzzkzMV0jGJHQUipPykzLzEhUOr1AoLM1UVHCmgUoAUEsBAhQAFAAAAAgAAHxWXQAAAAACAAAAAAAAAAkAAAAAAAAAAAAQAP1BAAAAAGNhcnRlbGxhL1BLAQIUABQAAAAIAAB8Vl2LDjQkHwAAAH4AAAAJAAAAAAAAAAAAAACAASkAAAB0ZXN0by50eHRQSwUGAAAAAAIAAgBuAAAAbwAAAAAA';

describe('zip archive', () => {
  it('computes the standard CRC-32', async () => {
    expect(await crc32(new Blob(['123456789']))).toBe(0xcbf43926);
    expect(await crc32(new Blob([]))).toBe(0);
  });

  it('round-trips stored entries with UTF-8 names and binary data', async () => {
    const audio = new Uint8Array(70_000).map((_, index) => (index * 31) % 256);
    const progress: number[] = [];
    const zip = await createZip([
      { name: 'indice.json', data: new Blob(['{"città":"Bologna"}']) },
      { name: 'audio/001-Lezione è.m4a', data: new Blob([audio]), lastModified: Date.UTC(2026, 9, 22, 10, 0, 0) },
    ], done => progress.push(done));

    expect(zip.type).toBe('application/zip');
    expect(progress.at(-1)).toBe(audio.length + new Blob(['{"città":"Bologna"}']).size);
    const entries = await readZip(zip);
    expect([...entries.keys()]).toEqual(['indice.json', 'audio/001-Lezione è.m4a']);
    expect(await (await entries.get('indice.json')!.blob()).text()).toBe('{"città":"Bologna"}');
    const back = new Uint8Array(await (await entries.get('audio/001-Lezione è.m4a')!.blob()).arrayBuffer());
    expect(back).toEqual(audio);
    expect(entries.get('audio/001-Lezione è.m4a')!.size).toBe(audio.length);
  });

  it('writes CRCs other tools accept', async () => {
    const zip = await createZip([{ name: 'a.txt', data: new Blob(['123456789']) }]);
    const view = new DataView(await zip.arrayBuffer());
    expect(view.getUint32(14, true)).toBe(0xcbf43926);
  });

  it('reads deflated entries and skips folders', async () => {
    const bytes = Uint8Array.from(atob(DEFLATED_ZIP), char => char.charCodeAt(0));
    const entries = await readZip(new Blob([bytes]));
    expect([...entries.keys()]).toEqual(['testo.txt']);
    expect(await (await entries.get('testo.txt')!.blob()).text()).toBe('Ciao ciao ciao ciao ciao, sbobina è qui! '.repeat(3));
  });

  it('refuses deflated entries that inflate past their declared or a plausible size', async () => {
    const zeros = new Uint8Array(32 * 1024 * 1024);
    const bomb = await readZip(await deflatedZip('manifest.json', zeros, zeros.length));
    await expect(bomb.get('manifest.json')!.blob()).rejects.toThrow('troppo grande una volta decompressa');
    const text = new TextEncoder().encode('sbobina '.repeat(1000));
    const lying = await readZip(await deflatedZip('manifest.json', text, 100));
    await expect(lying.get('manifest.json')!.blob()).rejects.toBeInstanceOf(ZipFormatError);
    const honest = await readZip(await deflatedZip('manifest.json', text, text.length));
    expect((await (await honest.get('manifest.json')!.blob()).arrayBuffer()).byteLength).toBe(text.length);
  });

  it('rejects files that are not a complete zip', async () => {
    await expect(readZip(new Blob(['non è uno zip']))).rejects.toBeInstanceOf(ZipFormatError);
    const zip = await createZip([{ name: 'a.txt', data: new Blob(['testo']) }]);
    await expect(readZip(zip.slice(0, zip.size - 10))).rejects.toBeInstanceOf(ZipFormatError);
  });
});
