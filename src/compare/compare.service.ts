import { ImageComparison } from '.prisma/client';
import { Injectable } from '@nestjs/common';
import { PixelmatchService } from './libs/pixelmatch.service';
import { ImageComparator } from './libs/image-comparator.interface';

@Injectable()
export class CompareService {
  constructor(private pixelmatchService: PixelmatchService) {}

  getComparator(imageComparison: ImageComparison): ImageComparator {
    switch (imageComparison) {
      case ImageComparison.pixelmatch: {
        return this.pixelmatchService;
      }
      default: {
        return this.pixelmatchService;
      }
    }
  }
}
