import { Logger } from '@nestjs/common';
import path from 'path';
import { writeFileSync, readFileSync, unlink, mkdirSync, existsSync } from 'fs';
import { PNG, PNGWithMetadata } from 'pngjs';
import { Static } from '../static.interface';
import { HDD_IMAGE_PATH } from './constants';
import { generateNewImageName } from '../utils';

export class HddService implements Static {
  private readonly logger: Logger = new Logger(HddService.name);

  generateNewImage(type: 'screenshot' | 'diff' | 'baseline'): { imageName: string; imagePath: string } {
    const imageName = generateNewImageName(type);
    return {
      imageName,
      imagePath: this.getImagePath(imageName),
    };
  }

  getImagePath(imageName: string): string {
    this.ensureDirectoryExistence(HDD_IMAGE_PATH);
    return path.resolve(HDD_IMAGE_PATH, imageName);
  }

  getImageUrl(imageName: string): Promise<string> {
    return Promise.resolve('/' + imageName);
  }

  async saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string> {
    try {
      new PNG().parse(imageBuffer);
    } catch {
      throw new Error('Cannot parse image as PNG file');
    }

    const { imageName, imagePath } = this.generateNewImage(type);
    writeFileSync(imagePath, new Uint8Array(imageBuffer.buffer, imageBuffer.byteOffset, imageBuffer.byteLength));
    return imageName;
  }

  async getImage(imageName: string): Promise<PNGWithMetadata> {
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
