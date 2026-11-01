import { BadRequestException, Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import { StaticFactoryService } from './static.factory';
import { assertPngWithinPixelLimit, isPngBuffer } from './utils';
import { Static } from './static.interface';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

@Injectable()
export class StaticService {
  private readonly staticService: Static;

  constructor(private staticFactoryService: StaticFactoryService) {
    this.staticService = this.staticFactoryService.getStaticService();
  }

  async saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string> {
    if (!isPngBuffer(imageBuffer)) {
      throw new BadRequestException('Cannot parse image as PNG file');
    }
    if (type === 'screenshot') {
      assertPngWithinPixelLimit(imageBuffer);
    }
    return this.staticService.saveImage(type, imageBuffer);
  }

  async getImageBuffer(imageName: string | null): Promise<Buffer | null> {
    return this.staticService.getImageBuffer(imageName);
  }

  async getImageStream(imageName: string): Promise<Readable | null> {
    return this.staticService.getImageStream(imageName);
  }

  async copyImage(type: 'screenshot' | 'diff' | 'baseline', sourceImageName: string): Promise<string> {
    return this.staticService.copyImage(type, sourceImageName);
  }

  async deleteImage(imageName: string | null): Promise<boolean | undefined> {
    return this.staticService.deleteImage(imageName);
  }

  async deleteImages(names: Iterable<string | null | undefined>, concurrency = 16): Promise<void> {
    const present = [...names].filter((name): name is string => !!name);
    await mapWithConcurrency(present, concurrency, (name) => this.deleteImage(name));
  }

  async getImageUrl(imageName: string): Promise<string> {
    return this.staticService.getImageUrl(imageName);
  }
}
