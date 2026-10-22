module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  transformIgnorePatterns: ['/node_modules/'],
  // `pnpm test` en la raíz corre api, web y mobile a la vez: con la CPU saturada,
  // los tests que generan PDF/Excel o levantan el hilo SQL pasan de los 5 s por defecto.
  testTimeout: 20000,
};
