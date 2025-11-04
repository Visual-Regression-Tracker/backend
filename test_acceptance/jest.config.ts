import { createDefaultPreset } from 'ts-jest';

/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    displayName: 'Acceptance',
    roots: ['./'],
    testTimeout: 30000,
    testRegex: '.spec.ts$',
    moduleFileExtensions: ['js', 'json', 'ts'],
    transform: {
      ...createDefaultPreset().transform,
    },
    transformIgnorePatterns: ['node_modules/(?!(pixelmatch)/)'],
    testEnvironment: 'node',
  };
};
