import { Module } from '@nestjs/common';
import { CompareService } from './compare.service';
import { LookSameService } from './libs/looks-same/looks-same.service';
import { OdiffService } from './libs/odiff/odiff.service';
import { PixelmatchService } from './libs/pixelmatch/pixelmatch.service';
import { AWSS3Service } from 'src/shared/static/aws-s3.servce.';
import { HardDiskService } from 'src/shared/static/hard-disk.service';
import { STATIC_SERVICE, StaticService } from 'src/shared/static/static-service.interface';

@Module({
  providers: [
    {
      provide: STATIC_SERVICE,
      useFactory: (): StaticService => {
        const isAWSDefined = process.env.USE_AWS_S3_BUCKET?.trim().toLowerCase() === 'true';
        return isAWSDefined ? new AWSS3Service() : new HardDiskService();
      },
    },
    CompareService,
    PixelmatchService,
    LookSameService,
    OdiffService,
  ],
  exports: [CompareService],
})
export class CompareModule {}
