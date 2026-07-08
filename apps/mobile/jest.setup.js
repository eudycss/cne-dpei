// @react-native-async-storage/async-storage 3.x ya no trae un mock incluido
// (antes vivía en jest/async-storage-mock.js). Uno propio en memoria basta
// para lo que usan nuestros tests (getItem/setItem/removeItem/clear).
jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    getItem: jest.fn((key) => Promise.resolve(store[key] ?? null)),
    setItem: jest.fn((key, value) => {
      store[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key) => {
      delete store[key];
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      store = {};
      return Promise.resolve();
    }),
  };
});
