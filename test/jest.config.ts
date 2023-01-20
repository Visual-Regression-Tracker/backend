/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    name: 'e2e',
    displayName: 'E2E Tests',
    roots: ['./'],
    testTimeout: 30000,
    testRegex: '.e2e-spec.ts$',
    moduleFileExtensions: ['js', 'json', 'ts'],
    transform: {
      '^.+\\.(t|j)s$': 'ts-jest',
    },
    coverageDirectory: '../coverage',
    testEnvironment: 'node',
  };
};
