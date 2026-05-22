import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const workspaceRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Asset central compartido del monorepo (single source of truth)
      '@assets': path.resolve(workspaceRoot, 'assets'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    fs: {
      // Permitir servir el logo central ubicado fuera de apps/web
      allow: [workspaceRoot],
    },
  },
});
