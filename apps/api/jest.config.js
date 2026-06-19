module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  transformIgnorePatterns: ['/node_modules/'],
};
