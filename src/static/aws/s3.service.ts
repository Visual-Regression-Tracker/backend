import { PNGWithMetadata } from 'pngjs';
import { Logger } from '@nestjs/common';
import { Static } from '../static.interface';
// import { S3Client } from '@aws-sdk/client-s3';

export class AWSS3Service implements Static {
  private readonly logger: Logger = new Logger(AWSS3Service.name);
  // private readonly AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
  // private readonly AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
  // private readonly AWS_REGION = process.env.AWS_REGION;
  // private readonly AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

  // private s3Client: S3Client;

  constructor() {
    // this.s3Client = new S3Client({
    //     credentials: {
    //         accessKeyId: this.AWS_ACCESS_KEY_ID,
    //         secretAccessKey: this.AWS_SECRET_ACCESS_KEY,
    //     },
    //     region: this.AWS_REGION,
    // });
    this.logger.log('AWS S3 service is being used for file storage.');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string> {
    throw new Error('Method not implemented.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getImage(fileName: string): Promise<PNGWithMetadata> {
    throw new Error('Method not implemented.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deleteImage(imageName: string): Promise<boolean> {
    throw new Error('Method not implemented.');
  }
}
