module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: './tsconfig.test.json'
    }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@axync/extract-json|boxen|picocolors|ansi-align|camelcase|chalk|cli-boxes|string-width|strip-ansi|widest-line|wrap-ansi)/)'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  clearMocks: true,
  restoreMocks: true,
  maxWorkers: 1, // Run tests sequentially to avoid interference
};