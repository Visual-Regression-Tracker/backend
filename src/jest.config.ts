/** @returns {Promise<import('jest').Config>} */
import { createDefaultPreset } from 'ts-jest';

/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    displayName: 'Unit Tests',
    roots: ['./'],
    moduleFileExtensions: ['js', 'json', 'ts'],
    transform: {
      ...createDefaultPreset().transform,
    },
    transformIgnorePatterns: ['node_modules/(?!(pixelmatch)/)'],
    coverageDirectory: '../coverage',
    testEnvironment: 'node',
  };
};
