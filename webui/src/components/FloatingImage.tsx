import { reportClientError } from '../diagnostics';
/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useRef } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { optimizeDataUrlImage } from '../utils';
import { imageWrapperStyle, imageWrapperCss, imageAssetCss, normalizeImageAspectRatio, normalizeImageAlignment, normalizeImageLayout, normalizeImagePosition, normalizeImageOffsetY, normalizeImageWidth } from '../imageLayout';
import { createImageWrapPlugin } from '../imageWrap';
import { startImageDrag } from '../imageDrag';
import { startImageResize, type ImageResizeHandle } from '../imageResize';
import './FloatingImage.css';
import { EDITOR_CONTENT_WIDTH_PX } from '../documentFormatting';

export type { ImageAlignment } from '../imageLayout';

export { EDITOR_CONTENT_WIDTH_PX } from '../documentFormatting';

export const clampWidth = normalizeImageWidth;

export const calculateImagePixelWidth = (widthPercent: unknown) =>
  Math.round((EDITOR_CONTENT_WIDTH_PX * clampWidth(widthPercent)) / 100);

const extractImageAttrs = (element: HTMLElement) => {
  const img = element.tagName.toLowerCase() === 'img' ? (element as HTMLImageElement) : element.querySelector('img');
  if (!img) {
    return false;
  }
  const figcaption = element.querySelector('figcaption, .editor-image-caption');

  let widthVal = element.getAttribute('data-width') || img.getAttribute('data-width') || '';
  if (!widthVal) {
    const elementStyleWidth = element.style.width;
    const imgStyleWidth = img.style.width;
    const imgWidthAttr = img.getAttribute('width');
    if (elementStyleWidth && elementStyleWidth.endsWith('%')) {
      widthVal = elementStyleWidth;
    } else if (imgStyleWidth && imgStyleWidth.endsWith('%')) {
      widthVal = imgStyleWidth;
    } else if (imgWidthAttr && Number.isFinite(Number(imgWidthAttr))) {
      const px = Number(imgWidthAttr);
      widthVal = String(Math.round((px / EDITOR_CONTENT_WIDTH_PX) * 100));
    } else if (elementStyleWidth || imgStyleWidth) {
      widthVal = elementStyleWidth || imgStyleWidth;
    }
  }

  const layout = normalizeImageLayout(element.getAttribute('data-layout') || (element.style.float === 'left' || element.style.float === 'right' ? 'wrap' : 'inline'));
  const align = normalizeImageAlignment(element.getAttribute('data-align') || element.getAttribute('align') || element.style.float || img.getAttribute('align'));
  return {
    src: img.getAttribute('src') || '',
    alt: img.getAttribute('alt') || '',
    title: img.getAttribute('title') || '',
    width: clampWidth(widthVal || '56'),
    align,
    layout,
    position: normalizeImagePosition(element.getAttribute('data-position'), align),
    offsetY: normalizeImageOffsetY(element.getAttribute('data-offset-y')),
    offsetX: normalizeImageOffsetY(element.getAttribute('data-offset-x')),
    aspectRatio: normalizeImageAspectRatio(element.getAttribute('data-aspect-ratio')),
    caption: figcaption ? figcaption.textContent || '' : element.getAttribute('data-caption') || '',
  };
};

function ImageLayoutIcon({ wrap = false }: { wrap?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M1 2h14M1 14h14" />
      {wrap ? <><rect x="5.5" y="5" width="5" height="6" /><path d="M1 5h3M1 8h3M1 11h3M12 5h3M12 8h3M12 11h3" /></> : <><rect x="1.5" y="5" width="6" height="6" /><path d="M9 11h6" /></>}
    </svg>
  );
}

function FloatingImageView({ node, updateAttributes, selected, getPos, editor }: NodeViewProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { resizeCleanupRef.current?.(); dragCleanupRef.current?.(); }, []);
  const width = clampWidth(node.attrs.width);
  const layout = normalizeImageLayout(node.attrs.layout);
  const align = normalizeImageAlignment(node.attrs.align);
  const position = normalizeImagePosition(node.attrs.position, align);
  const aspectRatio = normalizeImageAspectRatio(node.attrs.aspectRatio);
  const caption: string = String(node.attrs.caption || '');
  const src = String(node.attrs.src || '');

  useEffect(() => {
    if (
      src.startsWith('data:image/') &&
      !src.startsWith('data:image/svg+xml') &&
      !src.startsWith('data:image/gif') &&
      (src.startsWith('data:image/webp') || !src.startsWith('data:image/jpeg') || src.length > 500_000)
    ) {
      let isMounted = true;
      void optimizeDataUrlImage(src, { format: 'image/jpeg' }).then(optimizedSrc => {
        if (isMounted && optimizedSrc && optimizedSrc !== src) {
          updateAttributes({ src: optimizedSrc });
        }
      });
      return () => {
        isMounted = false;
      };
    }
  }, [src, updateAttributes]);

  const selectImageNode = (e: React.SyntheticEvent) => {
    if ((e.target as HTMLElement)?.closest('.editor-image-resize-handle, .editor-image-toolbar')) return;
    if (typeof getPos === 'function') {
      const pos = getPos();
      if (typeof pos === 'number' && pos >= 0) {
        const { selection } = editor?.state || {};
        if (!(selection instanceof NodeSelection && selection.from === pos)) {
          editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
          editor.view.focus();
        }
      }
    }
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('.editor-image-resize-handle, .editor-image-toolbar')) return;
    selectImageNode(event);
    const pos = getPos();
    if (layout === 'wrap' && event.button === 0 && typeof pos === 'number' && anchorRef.current) {
      event.preventDefault();
      event.stopPropagation();
      dragCleanupRef.current?.();
      dragCleanupRef.current = startImageDrag(editor.view, pos, anchorRef.current, event.nativeEvent);
    }
  };

  const changeImage = (attrs: Record<string, unknown>, separateUndo = false) => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const current = editor.state.doc.nodeAt(pos);
    if (!current) return;
    const tr = separateUndo ? closeHistory(editor.state.tr) : editor.state.tr;
    tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs });
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    editor.view.dispatch(tr);
  };

  const startResizeHandle = (event: React.PointerEvent<HTMLDivElement>, handle: ImageResizeHandle) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeCleanupRef.current?.();
    const pos = getPos();
    if (typeof pos !== 'number' || !anchorRef.current) return;
    resizeCleanupRef.current = startImageResize(editor.view, pos, anchorRef.current, event.currentTarget, event.nativeEvent, handle);
  };

  return (
    <NodeViewWrapper
      as="span"
      ref={anchorRef}
      className={`editor-image-node group ${selected ? 'is-selected' : ''}`}
      data-editor-image="true"
      data-width={width}
      data-align={align}
      data-layout={layout}
      data-position={position}
      data-offset-y={normalizeImageOffsetY(node.attrs.offsetY)}
      data-offset-x={normalizeImageOffsetY(node.attrs.offsetX)}
      data-aspect-ratio={aspectRatio ?? undefined}
      align={align}
      data-caption={caption}
      style={imageWrapperStyle(width, layout, align, position, normalizeImageOffsetY(node.attrs.offsetX), normalizeImageOffsetY(node.attrs.offsetY))}
      onClick={selectImageNode}
      onPointerDown={handlePointerDown}
    >
      <span className="editor-image-surface" style={layout === 'wrap' ? { position: 'absolute', width: `${calculateImagePixelWidth(width)}px` } : { position: 'relative', display: 'block', left: 0, top: 0 }}>
      {/* Image Selection Border */}
      <span className="editor-image-asset-wrapper relative block" data-drag-handle={layout === 'inline' ? '' : undefined}>
        <img
          src={String(node.attrs.src || '')}
          alt={String(node.attrs.alt || '')}
          title={String(node.attrs.title || '')}
          draggable={false}
          className="editor-image-asset cursor-grab active:cursor-grabbing block w-full h-auto"
          style={aspectRatio ? { aspectRatio, objectFit: 'fill' } : undefined}
        />

      {/* 8 Image Resize Handles */}
      {selected && (
        <span className="editor-image-resize-handles" contentEditable={false}>
          <div className="editor-image-resize-handle editor-image-resize-handle-tl" onPointerDown={e => startResizeHandle(e, 'tl')} />
          <div className="editor-image-resize-handle editor-image-resize-handle-tc" onPointerDown={e => startResizeHandle(e, 'tc')} />
          <div className="editor-image-resize-handle editor-image-resize-handle-tr" onPointerDown={e => startResizeHandle(e, 'tr')} />
          <div className="editor-image-resize-handle editor-image-resize-handle-ml" onPointerDown={e => startResizeHandle(e, 'ml')} />
          <div className="editor-image-resize-handle editor-image-resize-handle-mr" onPointerDown={e => startResizeHandle(e, 'mr')} />
          <div className="editor-image-resize-handle editor-image-resize-handle-bl" onPointerDown={e => startResizeHandle(e, 'bl')} />
          <div className="editor-image-resize-handle editor-image-resize-handle-bc" onPointerDown={e => startResizeHandle(e, 'bc')} />
          <div className="editor-image-resize-handle editor-image-resize-handle-br" onPointerDown={e => startResizeHandle(e, 'br')} />
        </span>
      )}
      </span>
      {caption && <span className="editor-image-caption" contentEditable={false}>{caption}</span>}
      {selected && (
        <div className="editor-image-toolbar" contentEditable={false} role="toolbar" aria-label="Disposizione immagine" onMouseDown={event => event.preventDefault()}>
          <button type="button" className={`editor-image-toolbar-button ${layout === 'inline' ? 'active' : ''}`} aria-pressed={layout === 'inline'} title="In-line" aria-label="In-line" onClick={() => changeImage({ layout: 'inline', offsetX: 0, offsetY: 0 }, true)}>
            <ImageLayoutIcon /><span>In-line</span>
          </button>
          <button type="button" className={`editor-image-toolbar-button ${layout === 'wrap' ? 'active' : ''}`} aria-pressed={layout === 'wrap'} title="Wrap" aria-label="Wrap" onClick={() => changeImage({ layout: 'wrap', offsetX: 0, offsetY: 0 }, true)}>
            <ImageLayoutIcon wrap /><span>Wrap</span>
          </button>
        </div>
      )}
      </span>
    </NodeViewWrapper>
  );
}

export const FloatingImage = Node.create({
  name: 'floatingImage',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: element => {
          const attrs = extractImageAttrs(element as HTMLElement);
          return attrs ? attrs.src : (element as HTMLElement).getAttribute('src') || '';
        },
      },
      alt: {
        default: '',
        parseHTML: element => {
          const attrs = extractImageAttrs(element as HTMLElement);
          return attrs ? attrs.alt : (element as HTMLElement).getAttribute('alt') || '';
        },
      },
      title: {
        default: '',
        parseHTML: element => {
          const attrs = extractImageAttrs(element as HTMLElement);
          return attrs ? attrs.title : (element as HTMLElement).getAttribute('title') || '';
        },
      },
      width: {
        default: 56,
        parseHTML: element => {
          const attrs = extractImageAttrs(element as HTMLElement);
          return attrs ? attrs.width : 56;
        },
      },
      align: {
        default: 'center',
        parseHTML: element => { const attrs = extractImageAttrs(element as HTMLElement); return attrs ? attrs.align : 'center'; },
      },
      layout: {
        default: 'inline',
        parseHTML: element => { const attrs = extractImageAttrs(element as HTMLElement); return attrs ? attrs.layout : 'inline'; },
      },
      position: {
        default: null,
        parseHTML: element => { const attrs = extractImageAttrs(element as HTMLElement); return attrs ? attrs.position : 50; },
      },
      offsetY: {
        default: 0,
        parseHTML: element => { const attrs = extractImageAttrs(element as HTMLElement); return attrs ? attrs.offsetY : 0; },
      },
      offsetX: {
        default: 0,
        parseHTML: element => { const attrs = extractImageAttrs(element as HTMLElement); return attrs ? attrs.offsetX : 0; },
      },
      aspectRatio: {
        default: null,
        parseHTML: element => { const attrs = extractImageAttrs(element as HTMLElement); return attrs ? attrs.aspectRatio : null; },
      },
      caption: {
        default: '',
        parseHTML: element => {
          const attrs = extractImageAttrs(element as HTMLElement);
          return attrs ? attrs.caption : '';
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'span[data-editor-image]', priority: 100, getAttrs: element => extractImageAttrs(element as HTMLElement) },
      { tag: 'figure[data-editor-image]', getAttrs: element => extractImageAttrs(element as HTMLElement) },
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
    const layout = normalizeImageLayout(HTMLAttributes.layout);
    const align = normalizeImageAlignment(HTMLAttributes.align);
    const position = normalizeImagePosition(HTMLAttributes.position, align);
    const caption: string = HTMLAttributes.caption || '';
    const pixelWidth = calculateImagePixelWidth(width);
    const aspectRatio = normalizeImageAspectRatio(HTMLAttributes.aspectRatio);

    const children: Array<[string, Record<string, string>] | [string, Record<string, string>, string]> = [
      [
        'img',
        {
          src: HTMLAttributes.src,
          alt: HTMLAttributes.alt || '',
          title: HTMLAttributes.title || '',
          width: String(pixelWidth),
          ...(aspectRatio ? { height: String(Math.round(pixelWidth / aspectRatio)) } : {}),
          style: imageAssetCss(HTMLAttributes.aspectRatio),
        },
      ],
    ];

    if (caption) {
      children.push(['span', { class: 'editor-image-caption', style: 'display:block;margin-top:8px;font-size:12px;line-height:1.4;' }, caption]);
    }

    return [
      'span',
      mergeAttributes({
        'data-editor-image': 'true',
        'data-width': String(width),
        'data-align': align,
        'data-layout': layout,
        'data-position': String(position),
        'data-offset-y': String(normalizeImageOffsetY(HTMLAttributes.offsetY)),
        'data-offset-x': String(normalizeImageOffsetY(HTMLAttributes.offsetX)),
        ...(normalizeImageAspectRatio(HTMLAttributes.aspectRatio) ? { 'data-aspect-ratio': String(normalizeImageAspectRatio(HTMLAttributes.aspectRatio)) } : {}),
        'data-caption': caption,
        align,
        style: imageWrapperCss(width, layout, align, position, normalizeImageOffsetY(HTMLAttributes.offsetX), normalizeImageOffsetY(HTMLAttributes.offsetY)),
      }),
      ['span', { class: 'editor-image-surface', style: 'display:block;position:relative;' }, ...children],
    ];
  },

  addProseMirrorPlugins() {
    return [
      createImageWrapPlugin(),
      new Plugin({
        key: new PluginKey('floatingImageClick'),
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;
              if (!target) return false;

              if (target.closest('.editor-image-resize-handle') || target.closest('.editor-image-toolbar')) {
                return false;
              }

              const imageNodeEl = target.closest('.editor-image-node') as HTMLElement | null;
              if (!imageNodeEl) return false;

              try {
                let pos: number | null = null;
                try {
                  pos = view.posAtDOM(imageNodeEl, 0);
                } catch (_) {}

                if (pos === null || pos === undefined || pos < 0) {
                  const coordsPos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                  if (coordsPos) pos = coordsPos.pos;
                }

                if (typeof pos === 'number' && pos >= 0 && pos < view.state.doc.content.size) {
                  let targetPos = pos;
                  let node = view.state.doc.nodeAt(targetPos);
                  if (node?.type.name !== 'floatingImage' && targetPos > 0) {
                    const prevNode = view.state.doc.nodeAt(targetPos - 1);
                    if (prevNode?.type.name === 'floatingImage') {
                      targetPos = targetPos - 1;
                      node = prevNode;
                    }
                  }

                  if (node && node.type.name === 'floatingImage') {
                    const { selection } = view.state;
                    if (!(selection instanceof NodeSelection && selection.from === targetPos)) {
                      const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, targetPos));
                      view.dispatch(tr);
                    }
                    view.focus();
                    // Let the browser start a native drag from the image handle.
                    // Returning true here makes ProseMirror prevent the mousedown default.
                    return false;
                  }
                }
              } catch (e) {
                reportClientError('Error selecting image node on mousedown:', e);
              }
              return false;
            },
          },
          handleClickOn(view, _pos, node, nodePos, _event, _direct) {
            if (node.type.name === 'floatingImage') {
              const { selection } = view.state;
              if (!(selection instanceof NodeSelection && selection.from === nodePos)) {
                view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)));
              }
              view.focus();
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FloatingImageView);
  },
});
