import React from 'react';
import { createPortal } from 'react-dom';
import { usePopoverPresence } from '../../../hooks/usePopoverPresence';
import { type Editor as TiptapEditor } from '@tiptap/core';
import { ChevronDown } from 'lucide-react';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import { useAnchoredPanel } from './anchoredPanel';
import {
  FONT_FAMILIES, FONT_SIZES, HEADING_OPTIONS, ZOOM_OPTIONS, currentFontFamily, currentFontSize,
  currentHeading, setFontFamily, setFontSize, setHeading,
} from './formatOptions';

export const FontFamilySelect = ({ editor }: { editor: TiptapEditor }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const presence = usePopoverPresence(isOpen);
  const { panelPos, placeUnder } = useAnchoredPanel(isOpen, panelRef);

  const { value: currentFamily, label: currentLabel } = currentFontFamily(editor);

  const toggleOpen = () => {
    if (!isOpen && buttonRef.current) placeUnder(buttonRef.current);
    setIsOpen(prev => !prev);
  };

  useEscapeToClose(isOpen, () => setIsOpen(false));

  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('mousedown', handler, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('mousedown', handler, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll, true);
    };
  }, [isOpen]);

  const selectFamily = (value: string) => {
    setIsOpen(false);
    setFontFamily(editor.chain().focus(), value).run();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className={`editor-button font-family-dropdown-btn${isOpen ? ' is-active' : ''}`}
        title="Carattere"
      >
        <span className="text-xs font-medium truncate flex-1 text-left">{currentLabel}</span>
        <ChevronDown size={10} style={{ opacity: 0.6, marginLeft: 2, flexShrink: 0 }} />
      </button>
      {presence.shown && createPortal(
        <div
          ref={panelRef}
          className={`kebab-panel editor-dropdown-panel font-family-dropdown-panel${presence.closing ? ' popover-closing' : ''}`}
          inert={presence.closing}
          style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 'var(--z-popover)', minWidth: '170px' }}
        >
          {FONT_FAMILIES.map(f => {
            const isActive = currentFamily === f.value;
            return (
              <button
                key={f.label}
                type="button"
                className={`kebab-item editor-dropdown-item${isActive ? ' is-active' : ''}`}
                style={{ fontFamily: f.cssFamily }}
                onClick={() => selectFamily(f.value)}
              >
                <span>{f.label}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
};

export const FontSizeSelect = ({ editor }: { editor: TiptapEditor }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const presence = usePopoverPresence(isOpen);
  const { panelPos, placeUnder } = useAnchoredPanel(isOpen, panelRef);

  const currentSize = currentFontSize(editor);

  const toggleOpen = () => {
    if (!isOpen && buttonRef.current) placeUnder(buttonRef.current);
    setIsOpen(prev => !prev);
  };

  useEscapeToClose(isOpen, () => setIsOpen(false));

  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('mousedown', handler, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('mousedown', handler, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll, true);
    };
  }, [isOpen]);

  const selectSize = (size: string) => {
    setIsOpen(false);
    if (size) {
      setFontSize(editor.chain().focus(), size).run();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className={`editor-button font-size-dropdown-btn${isOpen ? ' is-active' : ''}`}
        title="Dimensione carattere"
      >
        <span className="text-xs font-medium flex-1 text-center">{currentSize}</span>
        <ChevronDown size={10} style={{ opacity: 0.6, marginLeft: 2, flexShrink: 0 }} />
      </button>
      {presence.shown && createPortal(
        <div
          ref={panelRef}
          className={`kebab-panel editor-dropdown-panel font-size-dropdown-panel${presence.closing ? ' popover-closing' : ''}`}
          inert={presence.closing}
          style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 'var(--z-popover)', minWidth: '64px', maxHeight: '220px', overflowY: 'auto' }}
        >
          {FONT_SIZES.map(s => {
            const isActive = currentSize === s;
            return (
              <button
                key={s}
                type="button"
                className={`kebab-item editor-dropdown-item${isActive ? ' is-active' : ''}`}
                style={{ justifyContent: 'center', padding: '5px 8px', fontSize: 'var(--text-label)' }}
                onClick={() => selectSize(s)}
              >
                <span>{s}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
};

export const HeadingSelect = ({ editor }: { editor: TiptapEditor }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const presence = usePopoverPresence(isOpen);
  const { panelPos, placeUnder } = useAnchoredPanel(isOpen, panelRef);

  const current = currentHeading(editor);

  const toggleOpen = () => {
    if (!isOpen && buttonRef.current) placeUnder(buttonRef.current);
    setIsOpen(prev => !prev);
  };

  useEscapeToClose(isOpen, () => setIsOpen(false));

  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('mousedown', handler, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('mousedown', handler, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll, true);
    };
  }, [isOpen]);

  const selectHeading = (option: typeof HEADING_OPTIONS[number]) => {
    setIsOpen(false);
    setHeading(editor.chain().focus(), option.level).run();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className={`editor-button heading-dropdown-btn${isOpen ? ' is-active' : ''}`}
        title="Stile paragrafo"
      >
        <span className="text-xs font-medium truncate flex-1 text-left">{current.label}</span>
        <ChevronDown size={10} style={{ opacity: 0.6, marginLeft: 2, flexShrink: 0 }} />
      </button>
      {presence.shown && createPortal(
        <div
          ref={panelRef}
          className={`kebab-panel editor-dropdown-panel heading-dropdown-panel${presence.closing ? ' popover-closing' : ''}`}
          inert={presence.closing}
          style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 'var(--z-popover)', minWidth: '150px' }}
        >
          {HEADING_OPTIONS.map(opt => {
            const isActive = current.value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                className={`kebab-item editor-dropdown-item${isActive ? ' is-active' : ''}`}
                onClick={() => selectHeading(opt)}
              >
                <span className={
                  opt.level === 1 ? 'font-bold text-base' :
                  opt.level === 2 ? 'font-bold text-sm' :
                  opt.level === 3 ? 'font-semibold text-sm' :
                  opt.level === 4 ? 'font-semibold text-xs' :
                  opt.level === 5 ? 'font-medium text-xs' :
                  'text-sm'
                }>
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
};

export const ZoomSelect = ({
  zoomLevel = 100,
  onZoomChange,
}: {
  zoomLevel?: number;
  onZoomChange?: (level: number) => void;
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const presence = usePopoverPresence(isOpen);
  const { panelPos, placeUnder } = useAnchoredPanel(isOpen, panelRef);

  const toggleOpen = () => {
    if (!isOpen && buttonRef.current) placeUnder(buttonRef.current);
    setIsOpen(prev => !prev);
  };

  useEscapeToClose(isOpen, () => setIsOpen(false));

  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('mousedown', handler, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('mousedown', handler, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll, true);
    };
  }, [isOpen]);

  const selectZoom = (level: number) => {
    setIsOpen(false);
    onZoomChange?.(level);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className={`editor-button zoom-dropdown-btn${isOpen ? ' is-active' : ''}`}
        title="Livello di zoom"
      >
        <span className="text-xs font-medium flex-1 text-center">{zoomLevel}%</span>
        <ChevronDown size={10} style={{ opacity: 0.6, marginLeft: 2, flexShrink: 0 }} />
      </button>
      {presence.shown && createPortal(
        <div
          ref={panelRef}
          className={`kebab-panel editor-dropdown-panel zoom-dropdown-panel${presence.closing ? ' popover-closing' : ''}`}
          inert={presence.closing}
          style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 'var(--z-popover)', minWidth: '72px', maxHeight: '240px', overflowY: 'auto' }}
        >
          {ZOOM_OPTIONS.map(lvl => {
            const isActive = zoomLevel === lvl;
            return (
              <button
                key={lvl}
                type="button"
                className={`kebab-item editor-dropdown-item${isActive ? ' is-active' : ''}`}
                style={{ justifyContent: 'center', padding: '5px 8px', fontSize: 'var(--text-label)' }}
                onClick={() => selectZoom(lvl)}
              >
                <span>{lvl}%</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
};
