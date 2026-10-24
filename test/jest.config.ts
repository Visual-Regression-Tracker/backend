/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    displayName: 'E2E Tests',
    roots: ['./'],
    testTimeout: 30000,
    testRegex: '.e2e-spec.ts$',
    transform: {
      '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.jest.json' }],
    },
    coverageDirectory: '../coverage',
    testEnvironment: 'node',
  };
};
