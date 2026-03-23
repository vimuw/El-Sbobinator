import React, { useRef } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { AlignLeft, AlignRight, TextCursorInput, Trash2 } from 'lucide-react';

type ImageLayout = 'inline' | 'left' | 'right';

const clampWidth = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '56'));
  if (!Number.isFinite(numeric)) return 56;
  return Math.min(100, Math.max(28, Math.round(numeric)));
};

const normalizeLayout = (value: unknown): ImageLayout => {
  return value === 'left' || value === 'right' ? value : 'inline';
};

const buildWrapperReactStyle = (layout: ImageLayout, width: number): React.CSSProperties => {
  const common: React.CSSProperties = {
    width: `${width}%`,
    maxWidth: '100%',
    position: 'relative',
  };

  if (layout === 'left') {
    return {
      ...common,
      float: 'left',
      margin: '12px 1rem 14px 0',
    };
  }

  if (layout === 'right') {
    return {
      ...common,
      float: 'right',
      margin: '12px 0 14px 1rem',
    };
  }

  return {
    ...common,
    display: 'block',
    clear: 'both',
    margin: '12px auto 18px',
  };
};

const buildWrapperStyle = (layout: ImageLayout, width: number) => {
  const widthRule = `width:${width}%;max-width:100%;position:relative;`;

  if (layout === 'left') {
    return `${widthRule}float:left;margin:12px 1rem 14px 0;`;
  }

  if (layout === 'right') {
    return `${widthRule}float:right;margin:12px 0 14px 1rem;`;
  }

  return `${widthRule}display:block;clear:both;margin:12px auto 18px;`;
};

const buildImageStyle = () => 'display:block;width:100%;height:auto;border-radius:18px;';

const extractImageAttrs = (element: HTMLElement) => {
  const img = element.tagName.toLowerCase() === 'img' ? (element as HTMLImageElement) : element.querySelector('img');
  if (!img) {
    return false;
  }

  return {
    src: img.getAttribute('src') || '',
    alt: img.getAttribute('alt') || '',
    title: img.getAttribute('title') || '',
    width: clampWidth(element.getAttribute('data-width') || img.style.width || element.style.width || '56'),
    layout: normalizeLayout(
      element.getAttribute('data-layout')
        || element.getAttribute('data-align')
        || (img.style.float === 'left' ? 'left' : img.style.float === 'right' ? 'right' : 'inline'),
    ),
  };
};

function FloatingImageView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const width = clampWidth(node.attrs.width);
  const layout = normalizeLayout(node.attrs.layout);

  const setLayout = (nextLayout: ImageLayout) => {
    updateAttributes({ layout: nextLayout });
  };

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = width;
    const editorRoot = anchorRef.current?.closest('.tiptap-editor') as HTMLElement | null;
    const availableWidth = Math.max(editorRoot?.clientWidth || 0, 320);

    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      updateAttributes({ width: clampWidth(startWidth + (delta / availableWidth) * 100) });
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
      className={`editor-image-node ${selected ? 'is-selected' : ''} is-${layout}`}
      data-editor-image="true"
      data-layout={layout}
      data-width={width}
      style={buildWrapperReactStyle(layout, width)}
    >
      <img
        src={String(node.attrs.src || '')}
        alt={String(node.attrs.alt || '')}
        title={String(node.attrs.title || '')}
        className="editor-image-asset"
        draggable="false"
      />
      <div className="editor-image-controls" contentEditable={false}>
        <div className="editor-image-toolbar">
          <button type="button" className={`editor-image-action ${layout === 'inline' ? 'is-active' : ''}`} onClick={() => setLayout('inline')} aria-label="Immagine in linea">
            <TextCursorInput className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={`editor-image-action ${layout === 'left' ? 'is-active' : ''}`} onClick={() => setLayout('left')} aria-label="Immagine a sinistra con testo">
            <AlignLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={`editor-image-action ${layout === 'right' ? 'is-active' : ''}`} onClick={() => setLayout('right')} aria-label="Immagine a destra con testo">
            <AlignRight className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="editor-image-action danger" onClick={deleteNode} aria-label="Rimuovi immagine">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          className="editor-image-resize"
          onPointerDown={startResize}
          aria-label="Ridimensiona immagine"
        />
      </div>
    </NodeViewWrapper>
  );
}

export const FloatingImage = Node.create({
  name: 'floatingImage',
  group: 'block',
  atom: true,
  draggable: false,
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
      layout: {
        default: 'inline',
        parseHTML: element => normalizeLayout((element as HTMLElement).getAttribute('data-layout') || (element as HTMLElement).getAttribute('data-align')),
      },
    };
  },

  parseHTML() {
    return [
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
    const layout = normalizeLayout(HTMLAttributes.layout);

    return [
      'div',
      mergeAttributes({
        'data-editor-image': 'true',
        'data-layout': layout,
        'data-width': String(width),
        style: buildWrapperStyle(layout, width),
      }),
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
  },

  addNodeView() {
    return ReactNodeViewRenderer(FloatingImageView);
  },
});
