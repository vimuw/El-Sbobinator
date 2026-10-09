import { describe, expect, it, vi } from 'vitest';
import { readAndOptimizeImageAsDataUrl, optimizeDataUrlImage, convertWebpImagesInHtml, prepareHtmlForClipboardSync } from './utils';

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

  it('optimizes standard image files to JPEG with white background for compatibility', async () => {
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

    const fillRectMock = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            fillStyle: '',
            fillRect: fillRectMock,
            drawImage: vi.fn(),
          }),
          toDataURL: (format: string) => {
            if (format === 'image/jpeg') return mockJpegResult;
            return 'data:image/jpeg;base64,fallback';
          },
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });

    try {
      const file = new File(['pngdata'], 'photo.png', { type: 'image/png' });
      const res = await readAndOptimizeImageAsDataUrl(file);
      expect(res).toBe(mockJpegResult);
      expect(fillRectMock).toHaveBeenCalled();
    } finally {
      (globalThis as unknown as { FileReader: unknown }).FileReader = originalFileReader;
      (globalThis as unknown as { Image: unknown }).Image = originalImage;
      vi.restoreAllMocks();
    }
  });

  it('keeps rawDataUrl when JPEG image is already within bounds and small', async () => {
    const mockRawResult = 'data:image/jpeg;base64,tinyjpeg';
    const mockLargerJpegResult = 'data:image/jpeg;base64,largercompresseddataforverytinyinput';
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
            fillRect: vi.fn(),
            drawImage: vi.fn(),
          }),
          toDataURL: () => mockLargerJpegResult,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });

    try {
      const file = new File(['jpegdata'], 'tiny.jpg', { type: 'image/jpeg' });
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

  it('converts WebP data URLs to JPEG for clipboard compatibility', async () => {
    const inputWebp = 'data:image/webp;base64,smallwebp';
    const mockJpegResult = 'data:image/jpeg;base64,convertedjpeg';
    const originalImage = (globalThis as unknown as { Image: unknown }).Image;

    class MockImage {
      naturalWidth = 800;
      naturalHeight = 600;
      width = 800;
      height = 600;
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
            fillRect: vi.fn(),
            drawImage: vi.fn(),
          }),
          toDataURL: () => mockJpegResult,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });

    try {
      const res = await optimizeDataUrlImage(inputWebp);
      expect(res).toBe(mockJpegResult);
    } finally {
      (globalThis as unknown as { Image: unknown }).Image = originalImage;
      vi.restoreAllMocks();
    }
  });

  it('optimizes large uncompressed PNG data URLs to JPEG', async () => {
    const largePng = 'data:image/png;base64,' + 'A'.repeat(300_000);
    const mockJpegResult = 'data:image/jpeg;base64,compressedjpeg';
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
            fillRect: vi.fn(),
            drawImage: vi.fn(),
          }),
          toDataURL: () => mockJpegResult,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });

    try {
      const res = await optimizeDataUrlImage(largePng);
      expect(res).toBe(mockJpegResult);
    } finally {
      (globalThis as unknown as { Image: unknown }).Image = originalImage;
      vi.restoreAllMocks();
    }
  });
});

describe('prepareHtmlForClipboard / convertWebpImagesInHtml', () => {
  it('declares both display dimensions without resampling a loaded caption image', () => {
    const root = document.createElement('div');
    root.innerHTML = '<img src="data:image/jpeg;base64,original-pixels">';
    Object.defineProperties(root.querySelector('img')!, { naturalWidth: { value: 240 }, naturalHeight: { value: 160 } });
    const source = '<span data-editor-image data-layout="wrap" data-align="right" data-width="35" data-caption="Figura"><img src="data:image/jpeg;base64,original-pixels"></span>';
    const result = new DOMParser().parseFromString(prepareHtmlForClipboardSync(source, root), 'text/html');
    expect(result.querySelector('img')!.getAttribute('width')).toBe('222');
    expect(result.querySelector('img')!.getAttribute('height')).toBe('148');
    expect(result.querySelector('img')!.getAttribute('src')).toBe(root.querySelector('img')!.getAttribute('src'));
    expect(result.querySelector('[data-editor-image]')!.hasAttribute('data-aspect-ratio')).toBe(false);
    const explicit = new DOMParser().parseFromString(prepareHtmlForClipboardSync(source.replace('data-width="35"', 'data-width="35" data-aspect-ratio="2"'), root), 'text/html');
    expect(explicit.querySelector('img')!.getAttribute('height')).toBe('111');
    const unloaded = new DOMParser().parseFromString(prepareHtmlForClipboardSync(source), 'text/html');
    expect(unloaded.querySelector('img')!.hasAttribute('height')).toBe(false);
  });
  it('includes portable paragraph styles even if no images are present', async () => {
    const html = '<p>Test text without images</p>';
    const result = new DOMParser().parseFromString(await convertWebpImagesInHtml(html), 'text/html');
    expect(result.querySelector('p')?.textContent).toBe('Test text without images');
    expect(result.querySelector('p')?.style.fontSize).toBe('11pt');
    expect(result.querySelector('p')?.style.lineHeight).toBe('1.38');
  });

  it.each(['image/jpeg', 'image/png', 'image/webp'])('preserves %s source pixels and transparency in HTML while declaring display dimensions', async format => {
    const src = `data:${format};base64,original-pixels`;
    const html = `<span data-editor-image data-layout="inline" data-width="35"><img src="${src}"></span>`;
    const canvas = vi.spyOn(document, 'createElement');
    const result = new DOMParser().parseFromString(await convertWebpImagesInHtml(html), 'text/html');
    expect(result.querySelector('img')!.getAttribute('src')).toBe(src);
    expect(result.querySelector('img')!.getAttribute('width')).toBe('222');
    expect(canvas.mock.calls.some(([tag]) => tag === 'canvas')).toBe(false);
    canvas.mockRestore();
  });
});
