import { Readable } from 'stream';

export type ImageType = 'screenshot' | 'diff' | 'baseline';

export interface Static {
  saveImage(type: ImageType, imageBuffer: Buffer): Promise<string>;
  getImageBuffer(fileName: string | null): Promise<Buffer | null>;
  getImageStream(fileName: string): Promise<Readable | null>;
  copyImage(type: ImageType, sourceImageName: string): Promise<string>;
  deleteImage(imageName: string | null): Promise<boolean | undefined>;
  getImageUrl(imageName: string): Promise<string>;
}
