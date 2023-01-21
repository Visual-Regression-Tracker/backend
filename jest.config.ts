/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    projects: ['./test/jest.config.ts', './src/jest.config.ts'],
    roots: ['./'],
    testTimeout: 30000,
  };
};
