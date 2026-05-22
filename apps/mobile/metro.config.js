// Metro config para monorepo pnpm
// Permite que Metro resuelva paquetes en ../../packages y ../../node_modules
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Vigila todo el monorepo (assets compartidos, packages)
config.watchFolders = [workspaceRoot];

// Resuelve dependencias tanto en el proyecto como en la raíz del monorepo
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
