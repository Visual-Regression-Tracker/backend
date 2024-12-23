import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, createWriteStream } from 'fs';
import { PNG, PNGWithMetadata } from 'pngjs';

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { StaticService } from './static-service.interface';
import { CommonFileService } from './common-file-service';

@Injectable()
export class AWSS3Service extends CommonFileService implements StaticService {
  private readonly AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
  private readonly AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
  private readonly AWS_REGION = process.env.AWS_REGION;
  private readonly AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

  private s3Client: S3Client;

  constructor() {
    super();
    this.s3Client = new S3Client({
      credentials: {
        accessKeyId: this.AWS_ACCESS_KEY_ID,
        secretAccessKey: this.AWS_SECRET_ACCESS_KEY,
      },
      region: this.AWS_REGION,
    });
    this.logger = new Logger(AWSS3Service.name);
    this.logger.log('AWS S3 service is being used for file storage.');
    setInterval(() => this.cleanupQueuedFiles(), this.DELETE_INTERVAL);
    this.cleanUpAllFiles();
  }

  async saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string> {
    const { imageName } = this.generateNewImage(type);
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.AWS_S3_BUCKET_NAME,
          Key: imageName,
          ContentType: 'image/png',
          Body: imageBuffer,
        })
      );
      return imageName;
    } catch (ex) {
      throw new Error('Could not save file at AWS S3 : ' + ex);
    }
  }

  async getImage(fileName: string): Promise<PNGWithMetadata> {
    if (!fileName) return null;
    try {
      if (!this.doesFileExistLocally(fileName)) {
        const localFileStream = await this.saveFileFromCloud(fileName);
        await new Promise<void>((resolve, reject) => {
          localFileStream.on('finish', () => {
            this.scheduleLocalFileDeletion(fileName);
            this.checkLocalDiskUsageAndClean();
            resolve();
          });
          localFileStream.on('error', (error) => {
            this.logger.error('Error writing file:', error);
            reject(error);
          });
        });
      }
      return PNG.sync.read(readFileSync(this.getImagePath(fileName)));
    } catch (ex) {
      this.logger.error(`Error from read : Cannot get image: ${fileName}. ${ex}`);
    }
  }

  async saveFileFromCloud(fileName: string) {
    const command = new GetObjectCommand({ Bucket: this.AWS_S3_BUCKET_NAME, Key: fileName });
    const s3Response = await this.s3Client.send(command);
    const fileStream = s3Response.Body as Readable;
    const localFileStream = createWriteStream(this.getImagePath(fileName));
    fileStream.pipe(localFileStream);
    this.logger.log(`File feom AWS S3 saved at ${this.getImagePath(fileName)}`);
    return localFileStream;
  }

  async deleteImage(imageName: string): Promise<boolean> {
    if (!imageName) return false;
    try {
      await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.AWS_S3_BUCKET_NAME, Key: imageName }));
      return true;
    } catch (error) {
      this.logger.log(`Failed to delete file at AWS S3 for image ${imageName}:`, error);
      return false; // Return `false` if an error occurs.
    }
  }
}
