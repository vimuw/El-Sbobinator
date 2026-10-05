import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function FolderCardTitle({ name, onNavigate }: { name: string; onNavigate: () => void }) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();
  const [truncated, setTruncated] = useState(false);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      setTruncated(title.scrollHeight > title.clientHeight || title.scrollWidth > title.clientWidth);
      setPosition(null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(title);
    void document.fonts?.ready.then(measure);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [name]);

  useEffect(() => {
    if (!position) return;
    const dismiss = () => setPosition(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [position]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const show = () => {
    cancelClose();
    if (!truncated || !titleRef.current) return;
    const rect = titleRef.current.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    setPosition({
      width,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      ...(window.innerHeight - rect.bottom >= 160
        ? { top: rect.bottom + 6 }
        : { bottom: window.innerHeight - rect.top + 6 }),
    });
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (document.activeElement !== titleRef.current) setPosition(null);
    }, 120);
  };

  return (
    <>
      <span
        ref={titleRef}
        className="folder-card-title flex-1 min-w-0 text-sm font-semibold"
        style={{ color: 'var(--text-primary)' }}
        tabIndex={truncated ? 0 : undefined}
        aria-describedby={position ? tooltipId : undefined}
        onMouseEnter={show}
        onMouseLeave={scheduleClose}
        onFocus={show}
        onBlur={scheduleClose}
        onPointerDown={() => setPosition(null)}
        onKeyDown={event => {
          if (event.key === ' ') setPosition(null);
          if (event.key === 'Enter') {
            event.stopPropagation();
            onNavigate();
          }
        }}
      >
        {name}
      </span>
      {position && createPortal(
        <span
          id={tooltipId}
          role="tooltip"
          className="folder-name-tooltip"
          style={position}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
        >
          {name}
        </span>,
        document.body,
      )}
    </>
  );
}
