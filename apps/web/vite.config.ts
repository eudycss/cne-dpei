/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const workspaceRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Asset central compartido del monorepo (single source of truth)
      '@assets': path.resolve(workspaceRoot, 'assets'),
      // Evita el "dual package hazard": apps/mobile fija react@18.2.0 y apps/web
      // fija react@18.3.1, así que pnpm (node-linker=hoisted) termina con varias
      // copias físicas distintas de "react" repartidas por el árbol. react/react-dom
      // solo están declarados como deps directas en apps/web, así que pnpm los
      // hoistea ahí (no a la raíz) — apuntamos a esa copia para que todo el mundo
      // comparta la misma instancia.
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    fs: {
      // Permitir servir el logo central ubicado fuera de apps/web
      allow: [workspaceRoot],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // apps/mobile fija react@18.2.0 y apps/web fija react@18.3.1: bajo
    // node-linker=hoisted, pnpm anida copias de react en algunas deps
    // (@tanstack/react-query, testing-library, etc.) para satisfacer ambos pines.
    // Sin esto, esas deps quedan externalizadas y no reciben el alias de arriba,
    // cargando una segunda copia de react (dispatcher null, hooks rotos).
    server: {
      deps: { inline: true },
    },
  },
});
