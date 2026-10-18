// Docs has no embedded player: a video is a link, with a floating preview for
// YouTube. These helpers keep the editor, saved HTML and clipboard aligned.

const YOUTUBE_HOST = /(?:^|\.)(?:youtube(?:-nocookie)?\.com|youtu\.be)$/;
const VIDEO_ID = /^[\w-]{6,}$/;
const VIMEO_HOST = /(?:^|\.)vimeo\.com$/;

/** Return the YouTube video id of a watch, short, embed or youtu.be address. */
export const youtubeVideoId = (href: string): string | null => {
  try {
    const url = new URL(href);
    if (!['http:', 'https:'].includes(url.protocol) || !YOUTUBE_HOST.test(url.hostname)) return null;
    const id = url.hostname.endsWith('youtu.be')
      ? url.pathname.slice(1)
      : url.searchParams.get('v') ?? /^\/(?:embed|shorts|live)\/([^/?#]+)/.exec(url.pathname)?.[1] ?? '';
    return VIDEO_ID.test(id) ? id : null;
  } catch {
    return null;
  }
};

/**
 * Embeds become their public watch page. Local or data sources have no portable
 * link. Other embedded pages (ads, maps, social posts) are not videos and are
 * dropped, while a remote video file keeps its own address.
 */
export const videoLink = (src: string, isVideoFile = false): string | null => {
  try {
    const url = new URL(src, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === window.location.origin) return null;
    const youtubeId = youtubeVideoId(url.href);
    if (youtubeId) return /^\/embed\//.test(url.pathname) ? `https://www.youtube.com/watch?v=${youtubeId}` : url.href;
    const vimeoId = VIMEO_HOST.test(url.hostname) ? /^\/(?:video\/)?(\d+)/.exec(url.pathname)?.[1] : undefined;
    if (vimeoId) return url.hostname === 'player.vimeo.com' ? `https://vimeo.com/${vimeoId}` : url.href;
    return isVideoFile ? url.href : null;
  } catch {
    return null;
  }
};

/** Privacy-enhanced player address used only by the editor's preview window. */
export const youtubePreviewSrc = (id: string): string => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;

/** Open a document link in the system browser, as Ctrl+click and Apri do in Docs. */
export const openDocumentLink = (href: string): void => {
  void window.pywebview?.api?.open_link?.(href);
};
