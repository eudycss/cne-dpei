#!/usr/bin/env node
// Sincroniza el .env raiz -> apps/api/.env antes de levantar la API.
// NestJS solo lee .env desde su propio cwd (apps/api), por lo que ambos
// archivos deben mantenerse identicos. Ver troubleshooting de CORS en
// CLAUDE.md: la causa mas comun es que estos dos archivos queden desincronizados.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, '.env');
const target = path.join(root, 'apps', 'api', '.env');

if (!fs.existsSync(source)) {
  console.error(
    `\n[sync-env] No existe ${path.relative(root, source)}.\n` +
      `Copia el ejemplo primero:\n  cp .env.example .env\n`,
  );
  process.exit(1);
}

const sourceContent = fs.readFileSync(source, 'utf8');
const targetContent = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

if (sourceContent === targetContent) {
  console.log('[sync-env] apps/api/.env ya está sincronizado con .env');
} else {
  fs.copyFileSync(source, target);
  console.log(`[sync-env] .env -> ${path.relative(root, target)} sincronizado`);
}
