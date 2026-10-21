// Incremental reader over a Blob/File: keeps one window of bytes in memory and
// refills it with Blob.slice(). Never reads the whole file into one buffer.

export class BlobReader {
  readonly size: number;
  private buf = new Uint8Array(0);
  private base = 0; // file offset of buf[0]
  bytesRead = 0;
  reads = 0;

  constructor(private blob: Blob, private windowSize = 4 * 1024 * 1024) {
    this.size = blob.size;
  }

  /**
   * Makes sure bytes [pos, pos+n) are buffered (or as many as exist before EOF).
   * Returns the number of bytes available from pos, capped at n.
   */
  async ensure(pos: number, n: number): Promise<number> {
    const end = Math.min(pos + n, this.size);
    if (pos >= this.base && end <= this.base + this.buf.length) return end - pos;
    const start = pos;
    const readEnd = Math.min(this.size, Math.max(end, start + this.windowSize));
    const ab = await this.blob.slice(start, readEnd).arrayBuffer();
    this.buf = new Uint8Array(ab);
    this.base = start;
    this.bytesRead += ab.byteLength;
    this.reads++;
    return end - pos;
  }

  /** True if [pos, pos+n) is already buffered (lets hot loops skip an await). */
  has(pos: number, n: number): boolean {
    return pos >= this.base && pos + n <= this.base + this.buf.length;
  }

  /** Byte at absolute offset; caller must have called ensure() covering it. */
  at(pos: number): number {
    return this.buf[pos - this.base];
  }

  /** View of [pos, pos+n); caller must have called ensure(). */
  bytes(pos: number, n: number): Uint8Array {
    const o = pos - this.base;
    return this.buf.subarray(o, o + n);
  }
}
