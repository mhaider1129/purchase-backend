module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/__tests__/jest.setup.js'],
  clearMocks: true,
  restoreMocks: true,
};