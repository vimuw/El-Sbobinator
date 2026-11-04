import { describe, expect, it, vi } from 'vitest';
import { readAndOptimizeImageAsDataUrl, optimizeDataUrlImage, convertWebpImagesInHtml, prepareHtmlForClipboardSync, jpegOrientation, stripJpegMetadata } from './utils';
import { EDITOR_CONTENT_WIDTH_PX } from './documentFormatting';

const figureWidth = Math.round(EDITOR_CONTENT_WIDTH_PX * 35 / 100);

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

  it('keeps a PNG screenshot byte-for-byte instead of recompressing it as JPEG', async () => {
    const mockRawResult = 'data:image/png;base64,originalrawdata';
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
      naturalWidth = 2732;
      naturalHeight = 2048;
      width = 2732;
      height = 2048;
      onload: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      }
    }
    (globalThis as unknown as { Image: unknown }).Image = MockImage;

    const canvasSpy = vi.spyOn(document, 'createElement');

    try {
      const file = new File(['pngdata'], 'screenshot.png', { type: 'image/png' });
      const res = await readAndOptimizeImageAsDataUrl(file);
      expect(res).toBe(mockRawResult);
      expect(canvasSpy).not.toHaveBeenCalledWith('canvas');
    } finally {
      (globalThis as unknown as { FileReader: unknown }).FileReader = originalFileReader;
      (globalThis as unknown as { Image: unknown }).Image = originalImage;
      vi.restoreAllMocks();
    }
  });

  it('keeps rawDataUrl when JPEG image is already within bounds and small', async () => {
    const mockRawResult = 'data:image/jpeg;base64,/9j/2wBDAAgGBgcGBQgHBwcJCQgK';
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

  const withImage = async (size: [number, number], run: (canvases: Array<{ width: number; height: number; formats: string[]; qualities: unknown[] }>) => Promise<void>, alpha = 255) => {
    const originalImage = (globalThis as unknown as { Image: unknown }).Image;
    class MockImage {
      naturalWidth = size[0];
      naturalHeight = size[1];
      width = size[0];
      height = size[1];
      onload: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    (globalThis as unknown as { Image: unknown }).Image = MockImage;
    const canvases: Array<{ width: number; height: number; formats: string[]; qualities: unknown[] }> = [];
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName);
      const canvas = {
        width: 0, height: 0, formats: [] as string[], qualities: [] as unknown[],
        getContext: () => ({
          fillRect: vi.fn(),
          drawImage: vi.fn(),
          getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, alpha]) }),
        }),
        toDataURL(format: string, quality: unknown) {
          canvas.formats.push(format);
          canvas.qualities.push(quality);
          return `data:${format};base64,reencoded`;
        },
      };
      canvases.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    });
    try {
      await run(canvases);
    } finally {
      (globalThis as unknown as { Image: unknown }).Image = originalImage;
      vi.restoreAllMocks();
    }
  };

  it('keeps a large PNG screenshot untouched below the Docs pixel limit', async () => {
    const largePng = 'data:image/png;base64,' + 'A'.repeat(300_000);
    await withImage([3840, 2160], async canvases => {
      expect(await optimizeDataUrlImage(largePng)).toBe(largePng);
      expect(canvases).toHaveLength(0);
    });
  });

  it('shrinks a PNG above 25 megapixels to the Docs limit, still as PNG', async () => {
    await withImage([8000, 6000], async canvases => {
      expect(await optimizeDataUrlImage('data:image/png;base64,huge')).toBe('data:image/png;base64,reencoded');
      const [canvas] = canvases;
      expect(canvas.width * canvas.height).toBeLessThanOrEqual(25_000_000);
      expect(canvas.width / canvas.height).toBeCloseTo(8000 / 6000, 2);
      expect(canvas.formats).toEqual(['image/png']);
    });
  });

  it('keeps an upright phone photo within 4096 px as its original JPEG data, without Exif', async () => {
    const photo = phonePhoto();
    await withImage([4032, 3024], async canvases => {
      const kept = jpegBytes(await optimizeDataUrlImage(toJpegDataUrl(photo.bytes)));
      expect(canvases).toHaveLength(0);
      expect(kept).toEqual([0xff, 0xd8, ...photo.jfif, ...photo.icc, ...photo.adobe, ...photo.dqt, ...photo.scan]);
    });
  });

  it('drops the GPS position of an inserted phone photo but keeps its image data', async () => {
    const photo = phonePhoto();
    expect(jpegOrientation(toJpegDataUrl(photo.bytes))).toBe(1);
    await withImage([4032, 3024], async canvases => {
      const file = new File([new Uint8Array(photo.bytes)], 'IMG_0001.jpg', { type: 'image/jpeg' });
      const kept = jpegBytes(await readAndOptimizeImageAsDataUrl(file));
      expect(canvases).toHaveLength(0);
      expect(String.fromCharCode(...kept)).not.toMatch(/Exif|xap|Pixel 9/);
      const sos = kept.findIndex((byte, i) => byte === 0xff && kept[i + 1] === 0xda);
      expect(kept.slice(sos)).toEqual(photo.scan);
    });
  });

  it('redraws a JPEG whose header cannot be read instead of keeping unknown metadata', async () => {
    await withImage([800, 600], async canvases => {
      expect(await optimizeDataUrlImage('data:image/jpeg;base64,tinyjpeg')).toBe('data:image/jpeg;base64,reencoded');
      expect(canvases[0].formats).toEqual(['image/jpeg']);
    });
  });

  it('reduces a larger photo to 4096 px as high-quality JPEG', async () => {
    await withImage([5712, 4284], async canvases => {
      expect(await optimizeDataUrlImage('data:image/jpeg;base64,/9j/2wBD')).toBe('data:image/jpeg;base64,reencoded');
      expect(canvases[0]).toMatchObject({ width: 4096, height: 3072, formats: ['image/jpeg'], qualities: [0.92] });
    });
  });

  it('redraws a JPEG rotated by EXIF upright', async () => {
    const rotated = `data:image/jpeg;base64,${btoa(String.fromCharCode(...exifJpegHeader(6)))}`;
    expect(jpegOrientation(rotated)).toBe(6);
    await withImage([3024, 4032], async canvases => {
      expect(await optimizeDataUrlImage(rotated)).toBe('data:image/jpeg;base64,reencoded');
      expect(canvases[0]).toMatchObject({ width: 3024, height: 4032 });
    });
  });

  it('converts a transparent WebP to PNG so the transparency survives', async () => {
    await withImage([800, 600], async canvases => {
      expect(await optimizeDataUrlImage('data:image/webp;base64,logo')).toBe('data:image/png;base64,reencoded');
      expect(canvases.at(-1)!.formats).toEqual(['image/png']);
    }, 0);
  });
});

function exifJpegHeader(orientation: number): number[] {
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  return [0xff, 0xd8, 0xff, 0xe1, 0, app1.length + 2, ...app1, 0xff, 0xda, 0, 2];
}

const ascii = (text: string) => Array.from(text, c => c.charCodeAt(0));
const jpegSegment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const toJpegDataUrl = (bytes: number[]) => `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`;
const jpegBytes = (dataUrl: string) => {
  expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  return Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
};

/** An upright phone JPEG with JFIF, Exif (with GPS), XMP, ICC, Adobe and comment segments. */
function phonePhoto() {
  const ifd0 = [0, 2, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 1, 0, 0, 0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 38, 0, 0, 0, 0];
  const gpsIfd = [0, 1, 0, 1, 0, 2, 0, 0, 0, 2, 0x4e, 0, 0, 0, 0, 0, 0, 0];
  const jfif = jpegSegment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const exif = jpegSegment(0xe1, [...ascii('Exif\0\0'), 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, ...ifd0, ...gpsIfd]);
  const xmp = jpegSegment(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'));
  const icc = jpegSegment(0xe2, [...ascii('ICC_PROFILE\0'), 1, 1, 0, 0, 0, 0]);
  const adobe = jpegSegment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1]);
  const comment = jpegSegment(0xfe, ascii('Pixel 9'));
  const dqt = jpegSegment(0xdb, [0, ...Array<number>(64).fill(1)]);
  const scan = [...jpegSegment(0xda, [1, 1, 0, 0, 0x3f, 0]), 0x12, 0xff, 0x00, 0xe1, 0x56, 0xff, 0xd9];
  const bytes = [0xff, 0xd8, ...jfif, ...exif, ...xmp, ...icc, ...adobe, ...comment, ...dqt, ...scan];
  return { bytes, jfif, icc, adobe, dqt, scan };
}

describe('stripJpegMetadata', () => {
  it('returns a JPEG without metadata unchanged and refuses unreadable headers', () => {
    const plain = 'data:image/jpeg;base64,/9j/2wBDAAgGBgcGBQgHBwcJCQgK';
    expect(stripJpegMetadata(plain)).toBe(plain);
    expect(stripJpegMetadata('data:image/jpeg;base64,tinyjpeg')).toBeNull();
    expect(stripJpegMetadata('data:image/jpeg;base64,!!')).toBeNull();
    expect(stripJpegMetadata('data:image/jpeg,%FF%D8')).toBeNull();
  });
});

describe('jpegOrientation', () => {
  it('treats a JPEG without Exif, or malformed data, as upright', () => {
    expect(jpegOrientation('data:image/jpeg;base64,/9j/2wBDAAgGBgcGBQgHBwcJCQgK')).toBe(1);
    expect(jpegOrientation('data:image/jpeg;base64,!!')).toBe(1);
    expect(jpegOrientation(`data:image/jpeg;base64,${btoa(String.fromCharCode(...exifJpegHeader(1)))}`)).toBe(1);
  });
});

describe('prepareHtmlForClipboard / convertWebpImagesInHtml', () => {
  it('declares both display dimensions without resampling a loaded caption image', () => {
    const root = document.createElement('div');
    root.innerHTML = '<img src="data:image/jpeg;base64,original-pixels">';
    Object.defineProperties(root.querySelector('img')!, { naturalWidth: { value: 240 }, naturalHeight: { value: 160 } });
    const source = '<span data-editor-image data-layout="wrap" data-align="right" data-width="35" data-caption="Figura"><img src="data:image/jpeg;base64,original-pixels"></span>';
    const result = new DOMParser().parseFromString(prepareHtmlForClipboardSync(source, root), 'text/html');
    expect(result.querySelector('img')!.getAttribute('width')).toBe(String(figureWidth));
    expect(result.querySelector('img')!.getAttribute('height')).toBe(String(Math.round(figureWidth / 1.5)));
    expect(result.querySelector('img')!.getAttribute('src')).toBe(root.querySelector('img')!.getAttribute('src'));
    expect(result.querySelector('[data-editor-image]')!.hasAttribute('data-aspect-ratio')).toBe(false);
    const explicit = new DOMParser().parseFromString(prepareHtmlForClipboardSync(source.replace('data-width="35"', 'data-width="35" data-aspect-ratio="2"'), root), 'text/html');
    expect(explicit.querySelector('img')!.getAttribute('height')).toBe(String(Math.round(figureWidth / 2)));
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
    expect(result.querySelector('img')!.getAttribute('width')).toBe(String(figureWidth));
    expect(canvas.mock.calls.some(([tag]) => tag === 'canvas')).toBe(false);
    canvas.mockRestore();
  });
});
