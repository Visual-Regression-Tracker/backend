/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    projects: [
      './src/jest.config.ts', 
      './test/jest.config.ts', 
      './test_acceptance/jest.config.ts'
    ],
    roots: ['./'],
    testTimeout: 30000,
  };
};
