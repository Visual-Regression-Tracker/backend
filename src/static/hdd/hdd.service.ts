import { Logger } from '@nestjs/common';
import path from 'path';
import { promises as fs, mkdirSync, existsSync } from 'fs';
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
    const root = path.resolve(HDD_IMAGE_PATH);
    const imagePath = path.resolve(root, imageName);
    // image names reach here straight from the request, so a traversal value
    // would otherwise read any file the process can see
    // only a leading parent-directory step means the name climbs out: a file
    // whose name merely starts with dots stays inside
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

  async saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string> {
    const { imageName, imagePath } = this.generateNewImage(type);
    await fs.writeFile(imagePath, new Uint8Array(imageBuffer.buffer, imageBuffer.byteOffset, imageBuffer.byteLength));
    return imageName;
  }

  async getImage(imageName: string): Promise<PNGWithMetadata> {
    const imageBuffer = await this.getImageBuffer(imageName);
    if (!imageBuffer) return;
    try {
      return PNG.sync.read(imageBuffer);
    } catch (ex) {
      this.logger.error(`Cannot decode image: ${imageName}. ${ex}`);
    }
  }

  async getImageBuffer(imageName: string): Promise<Buffer | null> {
    if (!imageName) return null;
    try {
      return await fs.readFile(this.getImagePath(imageName));
    } catch (ex) {
      this.logger.error(`Cannot get image: ${imageName}. ${ex}`);
      // an absent file is the only case that means "no image"; a permission or
      // I/O failure has to stay an error rather than read as a missing image
      if (ex?.code === 'ENOENT') {
        return null;
      }
      throw ex;
    }
  }

  async copyImage(type: 'screenshot' | 'diff' | 'baseline', sourceImageName: string): Promise<string> {
    const { imageName, imagePath } = this.generateNewImage(type);
    await fs.copyFile(this.getImagePath(sourceImageName), imagePath);
    return imageName;
  }

  async deleteImage(imageName: string): Promise<boolean> {
    if (!imageName) return;
    try {
      await fs.unlink(this.getImagePath(imageName));
    } catch (err) {
      this.logger.error(err);
    }
    return true;
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
