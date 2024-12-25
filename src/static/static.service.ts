import { Injectable, Logger } from '@nestjs/common';
import { PNGWithMetadata } from 'pngjs';
import { StaticFactoryService } from './static.factory';
import { Static } from './static.interface';

@Injectable()
export class StaticService {
  private readonly logger: Logger = new Logger(StaticService.name);
  private readonly staticService: Static;

  constructor(private staticFactoryService: StaticFactoryService) {
    this.staticService = this.staticFactoryService.getStaticService();
  }

  async saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string> {
    return this.staticService.saveImage(type, imageBuffer);
  }

  async getImage(imageName: string): Promise<PNGWithMetadata> {
    return this.staticService.getImage(imageName);
  }

  async deleteImage(imageName: string): Promise<boolean> {
    return this.staticService.deleteImage(imageName);
  }
}
