import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { resolve } from 'path';
import { writeFileSync, readFileSync, unlink } from 'fs';
import { PNG, PNGWithMetadata } from 'pngjs';

@Injectable()
export class StaticService {
  constructor(private configService: ConfigService) {}

  saveImage(imageName: string, imageBuffer: Buffer) {
    writeFileSync(this.getImagePath(imageName), imageBuffer);
  }

  getImage(imageName: string): PNGWithMetadata {
    return PNG.sync.read(readFileSync(this.getImagePath(imageName)));
  }

  private getImagePath(imageName: string): string {
    return resolve(this.configService.imgConfig.uploadPath, imageName);
  }

  async deleteImage(imageName: string): Promise<boolean> {
    return new Promise((resolvePromise, reject) => {
      unlink(this.getImagePath(imageName), err => {
        if (err) {
          reject(err);
        }
        resolvePromise(true);
      });
    });
  }
}
