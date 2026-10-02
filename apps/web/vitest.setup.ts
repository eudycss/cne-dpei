import '@testing-library/jest-dom/vitest';

// APIs del navegador que jsdom no trae y que usan motion y los componentes de
// React Bits (components/micro). Sin movimiento reducido por defecto.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

if (!('ResizeObserver' in window)) {
  class ResizeObserverFalso {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverFalso;
}
