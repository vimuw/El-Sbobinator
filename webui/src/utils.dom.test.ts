import { describe, expect, it, vi } from 'vitest';
import { readAndOptimizeImageAsDataUrl, optimizeDataUrlImage } from './utils';

describe('readAndOptimizeImageAsDataUrl (browser / jsdom environment)', () => {
  it('preserves SVG files without raster optimization', async () => {
    const mockSvgResult = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    const originalFileReader = (globalThis as unknown as { FileReader: unknown }).FileReader;

    (globalThis as unknown as { FileReader: unknown }).FileReader = class {
      result = mockSvgResult;
      onload: (() => void) | null = null;
      readAsDataURL() {
        if (this.onload) this.onload();
      }
    };

    try {
      const file = new File(['<svg></svg>'], 'image.svg', { type: 'image/svg+xml' });
      const res = await readAndOptimizeImageAsDataUrl(file);
      expect(res).toBe(mockSvgResult);
    } finally {
      (globalThis as unknown as { FileReader: unknown }).FileReader = originalFileReader;
    }
  });

  it('preserves GIF files without raster optimization', async () => {
    const mockGifResult = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const originalFileReader = (globalThis as unknown as { FileReader: unknown }).FileReader;

    (globalThis as unknown as { FileReader: unknown }).FileReader = class {
      result = mockGifResult;
      onload: (() => void) | null = null;
      readAsDataURL() {
        if (this.onload) this.onload();
      }
    };

    try {
      const file = new File(['gifdata'], 'image.gif', { type: 'image/gif' });
      const res = await readAndOptimizeImageAsDataUrl(file);
      expect(res).toBe(mockGifResult);
    } finally {
      (globalThis as unknown as { FileReader: unknown }).FileReader = originalFileReader;
    }
  });

  it('optimizes standard image files using canvas when available', async () => {
    const mockRawResult = 'data:image/png;base64,originalrawdata';
    const mockWebpResult = 'data:image/webp;base64,compressedwebpdata';
    const originalFileReader = (globalThis as unknown as { FileReader: unknown }).FileReader;
    const originalImage = (globalThis as unknown as { Image: unknown }).Image;

    (globalThis as unknown as { FileReader: unknown }).FileReader = class {
      result = mockRawResult;
      onload: (() => void) | null = null;
      readAsDataURL() {
        if (this.onload) this.onload();
      }
    };

    class MockImage {
      naturalWidth = 3200;
      naturalHeight = 2400;
      width = 3200;
      height = 2400;
      onload: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      }
    }
    (globalThis as unknown as { Image: unknown }).Image = MockImage;

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: vi.fn(),
          }),
          toDataURL: (format: string) => {
            if (format === 'image/webp') return mockWebpResult;
            return 'data:image/jpeg;base64,fallback';
          },
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });

    try {
      const file = new File(['pngdata'], 'photo.png', { type: 'image/png' });
      const res = await readAndOptimizeImageAsDataUrl(file);
      expect(res).toBe(mockWebpResult);
    } finally {
      (globalThis as unknown as { FileReader: unknown }).FileReader = originalFileReader;
      (globalThis as unknown as { Image: unknown }).Image = originalImage;
      vi.restoreAllMocks();
    }
  });

  it('falls back to JPEG when WebP export returns non-webp data', async () => {
    const mockRawResult = 'data:image/png;base64,originalrawdata';
    const mockJpegResult = 'data:image/jpeg;base64,compressedjpegdata';
    const originalFileReader = (globalThis as unknown as { FileReader: unknown }).FileReader;
    const originalImage = (globalThis as unknown as { Image: unknown }).Image;

    (globalThis as unknown as { FileReader: unknown }).FileReader = class {
      result = mockRawResult;
      onload: (() => void) | null = null;
      readAsDataURL() {
        if (this.onload) this.onload();
      }
    };

    class MockImage {
      naturalWidth = 2000;
      naturalHeight = 1000;
      width = 2000;
      height = 1000;
      onload: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      }
    }
    (globalThis as unknown as { Image: unknown }).Image = MockImage;

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: vi.fn(),
          }),
          toDataURL: (format: string) => {
            if (format === 'image/webp') return 'data:image/png;base64,unsupported';
            if (format === 'image/jpeg') return mockJpegResult;
            return 'data:image/png;base64,stub';
          },
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });

    try {
      const file = new File(['pngdata'], 'photo.png', { type: 'image/png' });
      const res = await readAndOptimizeImageAsDataUrl(file);
      expect(res).toBe(mockJpegResult);
    } finally {
      (globalThis as unknown as { FileReader: unknown }).FileReader = originalFileReader;
      (globalThis as unknown as { Image: unknown }).Image = originalImage;
      vi.restoreAllMocks();
    }
  });

  it('keeps rawDataUrl when image is already within bounds and smaller than canvas output', async () => {
    const mockRawResult = 'data:image/png;base64,tiny';
    const mockLargerWebpResult = 'data:image/webp;base64,largercompresseddataforverytinyinput';
    const originalFileReader = (globalThis as unknown as { FileReader: unknown }).FileReader;
    const originalImage = (globalThis as unknown as { Image: unknown }).Image;

    (globalThis as unknown as { FileReader: unknown }).FileReader = class {
      result = mockRawResult;
      onload: (() => void) | null = null;
      readAsDataURL() {
        if (this.onload) this.onload();
      }
    };

    class MockImage {
      naturalWidth = 200;
      naturalHeight = 100;
      width = 200;
      height = 100;
      onload: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      }
    }
    (globalThis as unknown as { Image: unknown }).Image = MockImage;

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: vi.fn(),
          }),
          toDataURL: () => mockLargerWebpResult,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });

    try {
      const file = new File(['pngdata'], 'tiny.png', { type: 'image/png' });
      const res = await readAndOptimizeImageAsDataUrl(file);
      expect(res).toBe(mockRawResult);
    } finally {
      (globalThis as unknown as { FileReader: unknown }).FileReader = originalFileReader;
      (globalThis as unknown as { Image: unknown }).Image = originalImage;
      vi.restoreAllMocks();
    }
  });

  it('rejects on FileReader error', async () => {
    const mockError = new Error('read error');
    const originalFileReader = (globalThis as unknown as { FileReader: unknown }).FileReader;

    (globalThis as unknown as { FileReader: unknown }).FileReader = class {
      error = mockError;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        if (this.onerror) this.onerror();
      }
    };

    try {
      const file = new File(['data'], 'photo.png', { type: 'image/png' });
      await expect(readAndOptimizeImageAsDataUrl(file)).rejects.toThrow('read error');
    } finally {
      (globalThis as unknown as { FileReader: unknown }).FileReader = originalFileReader;
    }
  });
});

describe('optimizeDataUrlImage (browser / jsdom environment)', () => {
  it('returns original string when not a data:image/ URL', async () => {
    expect(await optimizeDataUrlImage('')).toBe('');
    expect(await optimizeDataUrlImage('https://example.com/image.png')).toBe('https://example.com/image.png');
  });

  it('preserves SVG and GIF data URLs', async () => {
    const svgUrl = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    const gifUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    expect(await optimizeDataUrlImage(svgUrl)).toBe(svgUrl);
    expect(await optimizeDataUrlImage(gifUrl)).toBe(gifUrl);
  });

  it('preserves reasonably-sized WebP data URLs', async () => {
    const smallWebp = 'data:image/webp;base64,smallwebp';
    expect(await optimizeDataUrlImage(smallWebp)).toBe(smallWebp);
  });

  it('optimizes large uncompressed PNG data URLs', async () => {
    const largePng = 'data:image/png;base64,' + 'A'.repeat(300_000);
    const mockWebpResult = 'data:image/webp;base64,compressed';
    const originalImage = (globalThis as unknown as { Image: unknown }).Image;

    class MockImage {
      naturalWidth = 3840;
      naturalHeight = 2160;
      width = 3840;
      height = 2160;
      onload: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      }
    }
    (globalThis as unknown as { Image: unknown }).Image = MockImage;

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: vi.fn(),
          }),
          toDataURL: () => mockWebpResult,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });

    try {
      const res = await optimizeDataUrlImage(largePng);
      expect(res).toBe(mockWebpResult);
    } finally {
      (globalThis as unknown as { Image: unknown }).Image = originalImage;
      vi.restoreAllMocks();
    }
  });
});
