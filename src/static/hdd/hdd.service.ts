import { Injectable, Logger } from '@nestjs/common';
import path from 'path';
import { promises as fs, mkdirSync } from 'fs';
import { Readable } from 'stream';
import { ImageType, Static } from '../static.interface';
import { HDD_IMAGE_PATH } from './constants';
import { generateNewImageName } from '../utils';

@Injectable()
export class HddService implements Static {
  private readonly logger: Logger = new Logger(HddService.name);
  private directoryReady = false;

  generateNewImage(type: ImageType): { imageName: string; imagePath: string } {
    const imageName = generateNewImageName(type);
    return {
      imageName,
      imagePath: this.getImagePath(imageName),
    };
  }

  getImagePath(imageName: string): string {
    if (!this.directoryReady) {
      mkdirSync(HDD_IMAGE_PATH, { recursive: true });
      this.directoryReady = true;
    }
    const root = path.resolve(HDD_IMAGE_PATH);
    const imagePath = path.resolve(root, imageName);
    const relativeToRoot = path.relative(root, imagePath);
    const climbsOut =
      relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot);
    if (!relativeToRoot || climbsOut) {
      throw new Error(`Image name outside of the image directory: ${imageName}`);
    }
    return imagePath;
  }

  getImageUrl(imageName: string): Promise<string> {
    return Promise.resolve('/' + imageName);
  }

  async saveImage(type: ImageType, imageBuffer: Buffer): Promise<string> {
    const { imageName, imagePath } = this.generateNewImage(type);
    await fs.writeFile(imagePath, imageBuffer);
    return imageName;
  }

  async getImageBuffer(imageName: string | null): Promise<Buffer | null> {
    if (!imageName) return null;
    try {
      return await fs.readFile(this.getImagePath(imageName));
    } catch (ex) {
      this.logger.error(`Cannot get image: ${imageName}. ${ex}`);
      if ((ex as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        return null;
      }
      throw ex;
    }
  }

  async getImageStream(imageName: string): Promise<Readable | null> {
    const imagePath = this.getImagePath(imageName);
    try {
      return (await fs.open(imagePath, 'r')).createReadStream();
    } catch (ex) {
      if ((ex as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return null;
      throw ex;
    }
  }

  async copyImage(type: ImageType, sourceImageName: string): Promise<string> {
    const { imageName, imagePath } = this.generateNewImage(type);
    await fs.copyFile(this.getImagePath(sourceImageName), imagePath);
    return imageName;
  }

  async deleteImage(imageName: string | null): Promise<boolean | undefined> {
    if (!imageName) return;
    try {
      await fs.unlink(this.getImagePath(imageName));
    } catch (err) {
      this.logger.error(err);
    }
    return true;
  }
}
