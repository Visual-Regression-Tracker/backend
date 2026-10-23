import { PNGWithMetadata } from 'pngjs';

export interface Static {
  saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string>;
  getImage(fileName: string): Promise<PNGWithMetadata>;
  getImageBuffer(fileName: string): Promise<Buffer | null>;
  copyImage(type: 'screenshot' | 'diff' | 'baseline', sourceImageName: string): Promise<string>;
  deleteImage(imageName: string): Promise<boolean>;
  getImageUrl(imageName: string): Promise<string>;
}
