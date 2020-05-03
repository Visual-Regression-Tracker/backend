import { Injectable } from '@nestjs/common';
import { resolve } from 'path';
import { writeFileSync, readFileSync, unlink, mkdir } from 'fs';
import { PNG, PNGWithMetadata } from 'pngjs';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StaticService {
  constructor(private configService: ConfigService) {
    mkdir(this.configService.get('IMG_UPLOAD_FOLDER'), { recursive: true }, (err) => {
      if (err) throw err;
    });
  }

  saveImage(imageName: string, imageBuffer: Buffer) {
    writeFileSync(this.getImagePath(imageName), imageBuffer);
  }

  getImage(imageName: string): PNGWithMetadata {
    return PNG.sync.read(readFileSync(this.getImagePath(imageName)));
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

  private getImagePath(imageName: string): string {
    return resolve(this.configService.get('IMG_UPLOAD_FOLDER'), imageName);
  }
}
