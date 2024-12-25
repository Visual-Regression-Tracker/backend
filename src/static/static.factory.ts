import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Static } from './static.interface';
import { HddService } from './hdd/hdd.service';
import { AWSS3Service } from './aws/s3.service';

@Injectable()
export class StaticFactoryService {
  private readonly logger: Logger = new Logger(StaticFactoryService.name);

  constructor(private configService: ConfigService) {}

  getStaticService(): Static {
    const serviceType = this.configService.get<string>('STATIC_SERVICE', 'hdd');
    switch (serviceType) {
      case 's3':
        this.logger.debug('static service type: S3');
        return new AWSS3Service();
      case 'hdd':
      default:
        this.logger.debug('static service type: HDD');
        return new HddService();
    }
  }
}
