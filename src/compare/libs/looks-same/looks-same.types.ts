import { BlurAmplitudeConfig } from '../blur-amplitude.config';

export interface LooksSameConfig extends BlurAmplitudeConfig {
  /**
   * strict comparsion
   */
  strict?: boolean;
  /**
   * ΔE value that will be treated as error in non-strict mode
   */
  tolerance?: number;
  /**
   * makes the search algorithm of the antialiasing less strict
   */
  antialiasingTolerance?: number;
  /**
   * Ability to ignore antialiasing
   */
  ignoreAntialiasing?: boolean;
  /**
   * Ability to ignore text caret
   */
  ignoreCaret?: boolean;
  allowDiffDimensions?: boolean;
}

/**
 * coordinate bounds
 */
export interface CoordBounds {
  /**
   * X-coordinate of upper left corner
   */
  left: number;
  /**
   * Y-coordinate of upper left corner
   */
  top: number;
  /**
   * X-coordinate of bottom right corner
   */
  right: number;
  /**
   * Y-coordinate of bottom right corner
   */
  bottom: number;
}
