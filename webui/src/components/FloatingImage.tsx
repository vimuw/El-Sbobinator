import React, { useRef } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';

export type ImageAlignment = 'center';

const clampWidth = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '56'));
  if (!Number.isFinite(numeric)) return 56;
  return Math.min(100, Math.max(20, Math.round(numeric)));
};

const buildWrapperReactStyle = (width: number): React.CSSProperties => ({
  width: `${width}%`,
  maxWidth: '100%',
  position: 'relative',
  userSelect: 'none',
  margin: '14px auto',
  display: 'block',
  clear: 'both',
});

const buildWrapperStyle = (width: number) =>
  `width:${width}%;max-width:100%;position:relative;float:none;margin:14px auto;display:block;clear:both;`;

const buildImageStyle = () => 'display:block;width:100%;height:auto;border-radius:10px;';

const extractImageAttrs = (element: HTMLElement) => {
  const img = element.tagName.toLowerCase() === 'img' ? (element as HTMLImageElement) : element.querySelector('img');
  if (!img) {
    return false;
  }
  const figcaption = element.querySelector('figcaption');

  return {
    src: img.getAttribute('src') || '',
    alt: img.getAttribute('alt') || '',
    title: img.getAttribute('title') || '',
    width: clampWidth(element.getAttribute('data-width') || element.style.width || img.style.width || '56'),
    align: 'center',
    caption: figcaption ? figcaption.textContent || '' : element.getAttribute('data-caption') || '',
  };
};

function FloatingImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const width = clampWidth(node.attrs.width);
  const caption: string = String(node.attrs.caption || '');

  // Resize handler for 8 handles
  const startResizeHandle = (
    event: React.PointerEvent<HTMLDivElement>,
    handle: 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br'
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = width;
    const editorRoot = anchorRef.current?.closest('.tiptap-editor') as HTMLElement | null;

    let contentWidth = 320;
    if (editorRoot) {
      const style = window.getComputedStyle(editorRoot);
      const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(style.paddingRight) || 0;
      contentWidth = Math.max(editorRoot.clientWidth - paddingLeft - paddingRight, 320);
    }

    const imgEl = anchorRef.current?.querySelector('img');
    const aspectRatio = imgEl && imgEl.clientHeight > 0 ? imgEl.clientWidth / imgEl.clientHeight : 16 / 9;

    const move = (moveEvent: PointerEvent) => {
      let deltaPx = 0;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      if (handle === 'mr' || handle === 'tr' || handle === 'br') {
        deltaPx = 2 * dx;
      } else if (handle === 'ml' || handle === 'tl' || handle === 'bl') {
        deltaPx = -2 * dx;
      } else if (handle === 'bc') {
        deltaPx = 2 * dy * aspectRatio;
      } else if (handle === 'tc') {
        deltaPx = -2 * dy * aspectRatio;
      }

      const deltaPercent = (deltaPx / contentWidth) * 100;
      updateAttributes({ width: clampWidth(startWidth + deltaPercent) });
    };

    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  return (
    <NodeViewWrapper
      as="div"
      ref={anchorRef}
      className={`editor-image-node group ${selected ? 'is-selected' : ''}`}
      data-editor-image="true"
      data-width={width}
      data-align="center"
      data-caption={caption}
      style={buildWrapperReactStyle(width)}
    >
      {/* Asset Wrapper with Google Docs Blue Border */}
      <span className="editor-image-asset-wrapper relative block rounded-xl transition-all overflow-hidden" data-drag-handle>
        <img
          src={String(node.attrs.src || '')}
          alt={String(node.attrs.alt || '')}
          title={String(node.attrs.title || '')}
          draggable={false}
          className="editor-image-asset cursor-grab active:cursor-grabbing block w-full h-auto rounded-xl"
        />
      </span>

      {/* 8 Google Docs Blue Resize Handles */}
      {selected && (
        <span className="gdocs-handles-container" contentEditable={false}>
          <div className="gdocs-handle gdocs-handle-tl" onPointerDown={e => startResizeHandle(e, 'tl')} />
          <div className="gdocs-handle gdocs-handle-tc" onPointerDown={e => startResizeHandle(e, 'tc')} />
          <div className="gdocs-handle gdocs-handle-tr" onPointerDown={e => startResizeHandle(e, 'tr')} />
          <div className="gdocs-handle gdocs-handle-ml" onPointerDown={e => startResizeHandle(e, 'ml')} />
          <div className="gdocs-handle gdocs-handle-mr" onPointerDown={e => startResizeHandle(e, 'mr')} />
          <div className="gdocs-handle gdocs-handle-bl" onPointerDown={e => startResizeHandle(e, 'bl')} />
          <div className="gdocs-handle gdocs-handle-bc" onPointerDown={e => startResizeHandle(e, 'bc')} />
          <div className="gdocs-handle gdocs-handle-br" onPointerDown={e => startResizeHandle(e, 'br')} />
        </span>
      )}
    </NodeViewWrapper>
  );
}

export const FloatingImage = Node.create({
  name: 'floatingImage',
  group: 'block',
  inline: false,
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      title: { default: '' },
      width: {
        default: 56,
        parseHTML: element => clampWidth((element as HTMLElement).getAttribute('data-width') || (element as HTMLElement).style.width),
      },
      align: {
        default: 'center',
        parseHTML: () => 'center',
      },
      caption: {
        default: '',
        parseHTML: element => {
          const figcap = (element as HTMLElement).querySelector('figcaption');
          return figcap ? figcap.textContent || '' : (element as HTMLElement).getAttribute('data-caption') || '';
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-editor-image]',
        getAttrs: element => extractImageAttrs(element as HTMLElement),
      },
      {
        tag: 'div[data-editor-image]',
        getAttrs: element => extractImageAttrs(element as HTMLElement),
      },
      {
        tag: 'img[src]',
        getAttrs: element => extractImageAttrs(element as HTMLElement),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const width = clampWidth(HTMLAttributes.width);
    const caption: string = HTMLAttributes.caption || '';

    const children: any[] = [
      [
        'img',
        {
          src: HTMLAttributes.src,
          alt: HTMLAttributes.alt || '',
          title: HTMLAttributes.title || '',
          style: buildImageStyle(),
        },
      ],
    ];

    if (caption) {
      children.push(['figcaption', { class: 'editor-image-caption' }, caption]);
    }

    return [
      'div',
      mergeAttributes({
        'data-editor-image': 'true',
        'data-width': String(width),
        'data-align': 'center',
        'data-caption': caption,
        style: buildWrapperStyle(width),
      }),
      ...children,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FloatingImageView);
  },
});
