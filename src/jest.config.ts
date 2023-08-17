/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    displayName: 'Unit Tests',
    roots: ['./'],
    moduleFileExtensions: ['js', 'json', 'ts'],
    transform: {
      '^.+\\.(t|j)s$': 'ts-jest',
    },
    coverageDirectory: '../coverage',
    testEnvironment: 'node',
  };
};
