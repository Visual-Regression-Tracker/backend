module.exports = async () => {
  return {
    displayName: 'Acceptance',
    roots: ['./'],
    testTimeout: 30000,
    testRegex: '.spec.ts$',
    moduleFileExtensions: ['js', 'json', 'ts'],
    transform: {
      '^.+\\.(t|j)s$': '@swc/jest',
    },
    testEnvironment: 'node',
  };
};
