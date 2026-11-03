import React from 'react';

// Popovers keep this far from the window edges.
export const PANEL_EDGE_GAP_PX = 8;

/** The left edge that keeps a panel `panelWidth` wide inside the window; a wider one starts at the gap. */
export const fitPanelLeft = (left: number, panelWidth: number, viewportWidth: number) =>
  Math.max(PANEL_EDGE_GAP_PX, Math.min(left, viewportWidth - panelWidth - PANEL_EDGE_GAP_PX));

/**
 * Where a portaled toolbar popover sits: under its button and aligned with its left edge, then,
 * once mounted and measured, moved left if it would run off the window. The phone row scrolls
 * sideways, so its colour, alignment and font buttons can sit at the right edge.
 */
export const useAnchoredPanel = (isOpen: boolean, panelRef: React.RefObject<HTMLElement | null>) => {
  const [panelPos, setPanelPos] = React.useState({ top: 0, left: 0 });

  const placeUnder = (anchor: Element) => {
    const rect = anchor.getBoundingClientRect();
    setPanelPos({ top: rect.bottom + 6, left: rect.left });
  };

  React.useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!isOpen || !panel) return;
    // Measured at the window's left edge: near the right one a fixed panel shrinks to the room
    // left. offsetWidth, unlike the bounding box, ignores the opening animation's scale.
    const placedLeft = panel.style.left;
    panel.style.left = '0px';
    const width = panel.offsetWidth;
    panel.style.left = placedLeft;
    const left = fitPanelLeft(panelPos.left, width, window.innerWidth);
    if (left !== panelPos.left) setPanelPos(prev => ({ ...prev, left }));
  }, [isOpen, panelPos.left, panelRef]);

  return { panelPos, placeUnder };
};
