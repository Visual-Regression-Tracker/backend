export interface LooksSameConfig {
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

export type LookSameResult = {
  /**
   * true if images are equal, false - otherwise
   */
  equal?: boolean;
  /**
   * diff bounds for not equal images
   */
  diffBounds?: CoordBounds;
  /**
   * diff clusters for not equal images
   */
  diffClusters?: CoordBounds[];
  /**
   * number of pixels considered different
   */
  differentPixels: number;
  /**
   * number of pixels compared
   */
  totalPixels: number;
  /**
   * generated diff image when createDiffImage is enabled
   */
  diffImage: {
    createBuffer(extension: 'png' | 'raw'): Promise<Buffer>;
  } | null;
};
