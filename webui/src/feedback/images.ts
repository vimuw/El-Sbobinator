import { calculateOptimalDimensions } from '../utils';

// Images attached to a feedback: drawn again on a canvas and saved as a new JPEG, so nothing of the
// original file goes with them (EXIF, GPS position, PNG text chunks, the camera's name). The decoder
// applies the photo's orientation first, so a phone picture arrives the right way up.

export const MAX_FEEDBACK_IMAGES = 3;
export const MAX_IMAGE_INPUT_BYTES = 10 * 1024 * 1024;
export const FEEDBACK_IMAGE_MAX_SIDE = 1600;
export const FEEDBACK_IMAGE_QUALITY = 0.8;

export interface FeedbackImage {
  data: Uint8Array;
  filename: string;
  /** Object URL of the re-encoded JPEG, for the thumbnail: revoke it when the image goes. */
  previewUrl: string;
}

export class FeedbackImageError extends Error {}

export function feedbackImageSize(width: number, height: number): { width: number; height: number } {
  return calculateOptimalDimensions(width, height, FEEDBACK_IMAGE_MAX_SIDE, FEEDBACK_IMAGE_MAX_SIDE);
}

export async function encodeFeedbackImage(file: File, index: number): Promise<FeedbackImage> {
  if (!file.type.startsWith('image/')) throw new FeedbackImageError(`"${file.name}" non è un'immagine.`);
  if (file.size > MAX_IMAGE_INPUT_BYTES) throw new FeedbackImageError(`"${file.name}" supera 10 MB.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new FeedbackImageError(`Non riesco a leggere "${file.name}".`);
  }
  try {
    const { width, height } = feedbackImageSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new FeedbackImageError(`Non riesco a preparare "${file.name}".`);
    // JPEG has no transparency: a screenshot's clear areas become white, not black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', FEEDBACK_IMAGE_QUALITY));
    if (!blob) throw new FeedbackImageError(`Non riesco a preparare "${file.name}".`);
    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      filename: `immagine-${index + 1}.jpg`,
      previewUrl: URL.createObjectURL(blob),
    };
  } finally {
    bitmap.close();
  }
}
