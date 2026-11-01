module.exports = async () => {
  return {
    displayName: 'E2E Tests',
    roots: ['./'],
    testTimeout: 30000,
    testRegex: '.e2e-spec.ts$',
    transform: {
      '^.+\\.(t|j)s$': '@swc/jest',
    },
    coverageDirectory: '../coverage',
    testEnvironment: 'node',
  };
};
