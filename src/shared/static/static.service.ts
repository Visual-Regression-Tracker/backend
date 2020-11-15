import { Injectable } from '@nestjs/common';
import path from 'path';
import { writeFileSync, readFileSync, unlink, mkdirSync, existsSync } from 'fs';
import { PNG, PNGWithMetadata } from 'pngjs';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StaticService {
  constructor(private configService: ConfigService) {}

  saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): string {
    const imageName = `${Date.now()}.${type}.png`;
    writeFileSync(this.getImagePath(imageName), imageBuffer);
    return imageName;
  }

  getImage(imageName: string): PNGWithMetadata {
    if (!imageName) return;
    let image: PNGWithMetadata;
    try {
      image = PNG.sync.read(readFileSync(this.getImagePath(imageName)));
    } catch (ex) {
      console.log(`Cannot image: ${imageName}. ${ex}`);
    }
    return image;
  }

  async deleteImage(imageName: string): Promise<boolean> {
    if (!imageName) return;
    return new Promise((resolvePromise, reject) => {
      unlink(this.getImagePath(imageName), (err) => {
        if (err) {
          reject(err);
        }
        resolvePromise(true);
      });
    });
  }

  private getImagePath(imageName: string): string {
    const dir = this.configService.get('IMG_UPLOAD_FOLDER');
    this.ensureDirectoryExistence(dir);
    return path.resolve(dir, imageName);
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
