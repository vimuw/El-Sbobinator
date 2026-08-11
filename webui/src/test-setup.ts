global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

Object.defineProperty(window, 'scrollTo', {
  value: () => {},
  writable: true,
});

if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
