import { Injectable, Logger } from '@nestjs/common';
import { writeFileSync, readFileSync, unlink } from 'fs';
import { PNG, PNGWithMetadata } from 'pngjs';

import { StaticService } from './static-service.interface';
import { CommonFileService } from './common-file-service';

@Injectable()
export class HardDiskService extends CommonFileService implements StaticService {
  constructor() {
    super();
    this.logger = new Logger(HardDiskService.name);
    this.logger.log('Local file system is used for file storage.');
  }

  saveFileFromCloud(fileName: string) {
    throw new Error(`Download of file ${fileName} is not applicable for local files.`);
  }

  async saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string> {
    try {
      new PNG().parse(imageBuffer);
    } catch (ex) {
      throw new Error('Cannot parse image as PNG file: ' + ex);
    }

    const { imageName, imagePath } = this.generateNewImage(type);
    writeFileSync(imagePath, imageBuffer);
    return imageName;
  }

  async getImage(fileName: string): Promise<PNGWithMetadata> {
    if (!fileName) return null;
    try {
      return PNG.sync.read(readFileSync(this.getImagePath(fileName)));
    } catch (ex) {
      this.logger.error(`Error from read : Cannot get image: ${fileName}. ${ex}`);
    }
  }

  async deleteImage(imageName: string): Promise<boolean> {
    if (!imageName) return false;
    return new Promise((resolvePromise) => {
      unlink(this.getImagePath(imageName), (err) => {
        if (err) {
          this.logger.error(err);
          resolvePromise(false);
        }
        resolvePromise(true);
      });
    });
  }
}
