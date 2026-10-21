import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// `pnpm test` en la raíz corre web, api y mobile a la vez: con la CPU saturada
// el primer render pasa del 1 s por defecto de findBy*/waitFor y el test falla sin bug.
configure({ asyncUtilTimeout: 5000 });

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
