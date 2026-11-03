module.exports = async () => {
  return {
    displayName: 'Rendering noise',
    roots: ['./'],
    testTimeout: 60000,
    testRegex: '.spec.ts$',
    moduleFileExtensions: ['js', 'json', 'ts'],
    transform: {
      '^.+\\.(t|j)s$': '@swc/jest',
    },
    testEnvironment: 'node',
  };
};
