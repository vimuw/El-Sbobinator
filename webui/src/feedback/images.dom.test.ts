import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEEDBACK_IMAGE_MAX_SIDE, FEEDBACK_IMAGE_QUALITY, FeedbackImageError, encodeFeedbackImage, feedbackImageSize } from './images';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('feedback images', () => {
  it('shrinks large screenshots to the longest side, keeping the ratio', () => {
    expect(feedbackImageSize(3200, 1800)).toEqual({ width: FEEDBACK_IMAGE_MAX_SIDE, height: 900 });
    expect(feedbackImageSize(1170, 2532)).toEqual({ width: 739, height: FEEDBACK_IMAGE_MAX_SIDE });
    expect(feedbackImageSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('refuses files that are not images or are too large, before reading them', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    await expect(encodeFeedbackImage(new File(['x'], 'note.pdf', { type: 'application/pdf' }), 0)).rejects.toBeInstanceOf(FeedbackImageError);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'foto.jpg', { type: 'image/jpeg' });
    await expect(encodeFeedbackImage(big, 0)).rejects.toThrow('supera 10 MB');
    expect(decode).not.toHaveBeenCalled();
  });

  it('draws the image again as a new JPEG, the right way up, without the original file', async () => {
    const bitmap = { width: 3000, height: 2000, close: vi.fn() };
    const decode = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', decode);
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback, type?: string, quality?: number) => {
      expect([type, quality]).toEqual(['image/jpeg', FEEDBACK_IMAGE_QUALITY]);
      callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }));
    });
    const canvas = { width: 0, height: 0, getContext: () => ({ fillRect: vi.fn(), drawImage, fillStyle: '' }), toBlob };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'canvas' ? canvas : createElement(tag))) as typeof document.createElement);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    // A photo whose original bytes would carry its EXIF and GPS position.
    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x45, 0x78, 0x69, 0x66])], 'IMG_0001.HEIC', { type: 'image/heic' });

    const image = await encodeFeedbackImage(photo, 1);

    expect(decode).toHaveBeenCalledWith(photo, { imageOrientation: 'from-image' });
    expect([canvas.width, canvas.height]).toEqual([1600, 1067]);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 1067);
    expect(Array.from(image.data)).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    expect(image.filename).toBe('immagine-2.jpg');
    expect(image.previewUrl).toBe('blob:preview');
    expect(bitmap.close).toHaveBeenCalled();
  });
});
