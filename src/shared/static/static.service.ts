import { Injectable, Logger } from '@nestjs/common';
import path from 'path';
import { writeFileSync, readFileSync, unlink, mkdirSync, existsSync } from 'fs';
import { PNG, PNGWithMetadata } from 'pngjs';

export const IMAGE_PATH = 'imageUploads/';

@Injectable()
export class StaticService {
  private readonly logger: Logger = new Logger(StaticService.name);

  generateNewImage(type: 'screenshot' | 'diff' | 'baseline'): { imageName: string; imagePath: string } {
    const imageName = `${Date.now()}.${type}.png`;
    return {
      imageName,
      imagePath: this.getImagePath(imageName),
    };
  }

  getImagePath(imageName: string): string {
    this.ensureDirectoryExistence(IMAGE_PATH);
    return path.resolve(IMAGE_PATH, imageName);
  }

  saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): string {
    try {
      new PNG().parse(imageBuffer);
    } catch (ex) {
      throw new Error('Cannot parse image as PNG file');
    }

    const { imageName, imagePath } = this.generateNewImage(type);
    writeFileSync(imagePath, imageBuffer);
    return imageName;
  }

  getImage(imageName: string): PNGWithMetadata {
    if (!imageName) return;
    try {
      return PNG.sync.read(readFileSync(this.getImagePath(imageName)));
    } catch (ex) {
      this.logger.error(`Cannot get image: ${imageName}. ${ex}`);
    }
  }

  async deleteImage(imageName: string): Promise<boolean> {
    if (!imageName) return;
    return new Promise((resolvePromise) => {
      unlink(this.getImagePath(imageName), (err) => {
        if (err) {
          this.logger.error(err);
        }
        resolvePromise(true);
      });
    });
  }

  private ensureDirectoryExistence(dir: string) {
    const filePath = path.resolve(dir);
    if (existsSync(filePath)) {
      return true;
    } else {
      mkdirSync(dir, { recursive: true });
      this.ensureDirectoryExistence(dir);
    }
  }
}
