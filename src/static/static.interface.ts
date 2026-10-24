import { PNGWithMetadata } from 'pngjs';

export interface Static {
  saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string>;
  getImage(fileName: string | null): Promise<PNGWithMetadata | null | undefined>;
  getImageBuffer(fileName: string | null): Promise<Buffer | null>;
  copyImage(type: 'screenshot' | 'diff' | 'baseline', sourceImageName: string): Promise<string>;
  deleteImage(imageName: string | null): Promise<boolean | undefined>;
  getImageUrl(imageName: string): Promise<string>;
}
