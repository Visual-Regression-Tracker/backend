import { Logger } from '@nestjs/common';
import { Static } from '../static.interface';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { generateNewImageName } from '../utils';
import { positiveNumber } from '../../utils/env';

export const URL_WINDOW_SECONDS = 3600;

const msFromEnv = (name: string, fallback: number): number => positiveNumber(process.env[name], fallback);

export class AWSS3Service implements Static {
  private readonly logger: Logger = new Logger(AWSS3Service.name);
  private readonly AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

  private s3Client: S3Client;

  constructor() {
    this.s3Client = new S3Client({
      requestHandler: {
        connectionTimeout: msFromEnv('S3_CONNECTION_TIMEOUT_MS', 5_000),
        requestTimeout: msFromEnv('S3_REQUEST_TIMEOUT_MS', 60_000),
        throwOnRequestTimeout: true,
      },
    });
    this.logger.log('AWS S3 service is being used for file storage.');
  }

  async saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string> {
    const imageName = generateNewImageName(type);
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

  async getImageBuffer(fileName: string | null): Promise<Buffer | null> {
    if (!fileName) return null;
    try {
      const command = new GetObjectCommand({ Bucket: this.AWS_S3_BUCKET_NAME, Key: fileName });
      const s3Response = await this.s3Client.send(command);
      const stream = s3Response.Body as Readable;
      return Buffer.concat(await stream.toArray());
    } catch (ex) {
      this.logger.error(`Error from read : Cannot get image: ${fileName}. ${ex}`);
      if (this.isNotFound(ex)) {
        return null;
      }
      throw ex;
    }
  }

  async getImageStream(fileName: string): Promise<Readable | null> {
    try {
      const { Body } = await this.s3Client.send(
        new GetObjectCommand({ Bucket: this.AWS_S3_BUCKET_NAME, Key: fileName })
      );
      return (Body as Readable | undefined) ?? null;
    } catch (ex) {
      if (this.isNotFound(ex)) return null;
      throw ex;
    }
  }

  private isNotFound(ex: unknown): boolean {
    const error = ex as { name?: string; $metadata?: { httpStatusCode?: number } } | undefined;
    return error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
  }

  async copyImage(type: 'screenshot' | 'diff' | 'baseline', sourceImageName: string): Promise<string> {
    const imageName = generateNewImageName(type);
    try {
      await this.s3Client.send(
        new CopyObjectCommand({
          Bucket: this.AWS_S3_BUCKET_NAME,
          CopySource: `${this.AWS_S3_BUCKET_NAME}/${sourceImageName}`,
          Key: imageName,
        })
      );
      return imageName;
    } catch (ex) {
      throw new Error('Could not copy file at AWS S3 : ' + ex);
    }
  }

  async getImageUrl(imageName: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: `${this.AWS_S3_BUCKET_NAME}`,
      Key: imageName,
      ResponseCacheControl: `private, max-age=${URL_WINDOW_SECONDS}`,
    });
    const windowMs = URL_WINDOW_SECONDS * 1000;
    return getSignedUrl(this.s3Client, command, {
      expiresIn: URL_WINDOW_SECONDS * 2,
      signingDate: new Date(Math.floor(Date.now() / windowMs) * windowMs),
    });
  }

  async deleteImage(imageName: string | null): Promise<boolean> {
    if (!imageName) return false;
    try {
      await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.AWS_S3_BUCKET_NAME, Key: imageName }));
      return true;
    } catch (error) {
      this.logger.log(`Failed to delete file at AWS S3 for image ${imageName}:`, error);
      return false;
    }
  }
}
