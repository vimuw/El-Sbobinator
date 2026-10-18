import React from 'react';
import { ImagePlus, Radical, SquarePlay } from 'lucide-react';

export const InsertImageButton = ({ onOpenImagePicker }: { onOpenImagePicker: () => void }) => {
  return (
    <button
      type="button"
      onClick={onOpenImagePicker}
      className="editor-button"
      title="Inserisci immagine"
    >
      <ImagePlus className="h-4 w-4" />
    </button>
  );
};

export const InsertMathButton = ({ onOpenMath }: { onOpenMath: () => void }) => {
  return (
    <button
      type="button"
      onClick={onOpenMath}
      className="editor-button"
      title="Inserisci formula matematica (LaTeX)"
    >
      <Radical className="h-4 w-4" />
    </button>
  );
};

// Docs keeps a video as a link; the editor previews YouTube links from its card.
export const InsertYoutubeButton = ({ onOpenLink }: { onOpenLink: () => void }) => {
  return (
    <button
      type="button"
      onClick={onOpenLink}
      className="editor-button"
      title="Inserisci link a un video YouTube"
    >
      <SquarePlay className="h-4 w-4" />
    </button>
  );
};
