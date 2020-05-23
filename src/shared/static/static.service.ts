import { Injectable } from '@nestjs/common';
import path from 'path';
import { writeFileSync, readFileSync, unlink, mkdirSync, existsSync } from 'fs';
import { PNG, PNGWithMetadata } from 'pngjs';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StaticService {
  constructor(private configService: ConfigService) {
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
    const dir = this.configService.get('IMG_UPLOAD_FOLDER')
    this.ensureDirectoryExistence(dir)
    return path.resolve(dir, imageName);
  }

  private ensureDirectoryExistence(dir: string) {
    const filePath = path.resolve(dir)
    if (existsSync(filePath)) {
      return true;
    } else {
      mkdirSync(dir, { recursive: true });
      this.ensureDirectoryExistence(dir)
    }
  }
}
