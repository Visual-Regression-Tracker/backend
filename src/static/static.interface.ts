import { PNGWithMetadata } from 'pngjs';

export interface Static {
  saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string>;
  getImage(fileName: string): Promise<PNGWithMetadata>;
  deleteImage(imageName: string): Promise<boolean>;
}
