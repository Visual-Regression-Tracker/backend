import { Readable } from 'stream';

export interface Static {
  saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string>;
  getImageBuffer(fileName: string | null): Promise<Buffer | null>;
  getImageStream(fileName: string): Promise<Readable | null>;
  copyImage(type: 'screenshot' | 'diff' | 'baseline', sourceImageName: string): Promise<string>;
  deleteImage(imageName: string | null): Promise<boolean | undefined>;
  getImageUrl(imageName: string): Promise<string>;
}
