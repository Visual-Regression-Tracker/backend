/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    displayName: 'Ldap',
    roots: ['./'],
    testTimeout: 30000,
    testRegex: '.spec.ts$',
    moduleFileExtensions: ['js', 'json', 'ts'],
    transform: {
      '^.+\\.(t|j)s$': 'ts-jest',
    },
    testEnvironment: 'node',
  };
};
