const DEFAULT_HIGHLIGHT_COLOR = '#fef08a';
const HIGHLIGHT_COLOR_KEY = 'el_sbobinator_last_highlight_color';

export const getLastHighlightColor = (): string => {
  try {
    return localStorage.getItem(HIGHLIGHT_COLOR_KEY) || DEFAULT_HIGHLIGHT_COLOR;
  } catch {
    return DEFAULT_HIGHLIGHT_COLOR;
  }
};

export const setLastHighlightColor = (color: string): void => {
  if (!color || color === '#ffffff') return;
  try {
    localStorage.setItem(HIGHLIGHT_COLOR_KEY, color);
  } catch {
    // Ignore storage quota / restriction errors
  }
};
