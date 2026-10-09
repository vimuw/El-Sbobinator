export type ImageAlignment = 'left' | 'center' | 'right';
export type ImageLayout = 'inline' | 'wrap';

export const normalizeImageAlignment = (value: unknown): ImageAlignment =>
  value === 'left' || value === 'right' ? value : 'center';

export const normalizeImageLayout = (value: unknown): ImageLayout => value === 'wrap' ? 'wrap' : 'inline';

export const normalizeImageWidth = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '56'));
  // Width is relative to the text area, and can exceed it after a resize.
  return Number.isFinite(numeric) ? Math.max(20, Math.round(numeric * 100) / 100) : 56;
};

export const normalizeImageOffsetY = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : 0;
};

// Missing ratios retain the intrinsic dimensions of older images.
export const normalizeImageAspectRatio = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

export const imageAssetCss = (ratio: unknown) => {
  const aspectRatio = normalizeImageAspectRatio(ratio);
  return IMAGE_ASSET_CSS + (aspectRatio ? `aspect-ratio:${aspectRatio};object-fit:fill;` : '');
};

// Position is a percentage of the space remaining beside the image, not of the page.
export const normalizeImagePosition = (value: unknown, align: ImageAlignment): number => {
  const fallback = align === 'left' ? 0 : align === 'right' ? 100 : 50;
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, Math.round(numeric * 100) / 100)) : fallback;
};

export const imageWrapperStyle = (width: number, layout: ImageLayout, _align: ImageAlignment, _position: number, offsetX = 0, offsetY = 0) => {
  return {
    width: layout === 'wrap' ? '0px' : `${width}%`,
    height: layout === 'wrap' ? '0px' : 'auto',
    maxWidth: 'none',
    position: 'relative' as const,
    display: 'inline-block',
    verticalAlign: 'baseline',
    userSelect: 'none' as const,
    textAlign: 'center' as const,
    clear: 'none' as const,
    float: 'none' as 'none' | 'left' | 'right',
    margin: layout === 'inline' ? `0 0 0 ${offsetX}px` : '0',
    top: layout === 'inline' ? `${offsetY}px` : undefined,
  };
};

// Portable HTML has no two-sided rectangular exclusion. Keep the image visible
// using a side float; the editor and native Docs clipboard use the exact attrs.
export const imageWrapperCss = (width: number, layout: ImageLayout, align: ImageAlignment, position: number, offsetX = 0, offsetY = 0) => {
  const style = imageWrapperStyle(width, 'inline', align, position, offsetX, layout === 'inline' ? offsetY : 0);
  style.width = `${Math.round(EDITOR_CONTENT_WIDTH_PX * width / 100)}px`;
  if (layout === 'wrap') {
    style.float = position >= 50 ? 'right' : 'left';
    style.margin = position >= 50 ? '4px 0 16px 16px' : '4px 16px 16px 0';
  }
  return Object.entries(style)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}:${value}`)
    .join(';') + (layout === 'wrap' && (offsetX || offsetY) ? `;transform:translate(${offsetX}px,${offsetY}px)` : '') + ';';
};

export const IMAGE_ASSET_CSS = 'display:block;width:100%;max-width:100%;height:auto;margin:0;padding:0;';
import { EDITOR_CONTENT_WIDTH_PX } from './documentFormatting';
