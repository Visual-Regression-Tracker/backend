import { PNG, PNGWithMetadata } from 'pngjs';
import { Logger } from '@nestjs/common';
import { Static } from '../static.interface';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class AWSS3Service implements Static {
  private readonly logger: Logger = new Logger(AWSS3Service.name);
  private readonly AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
  private readonly AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
  private readonly AWS_REGION = process.env.AWS_REGION;
  private readonly AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

  private s3Client: S3Client;

  constructor() {
    this.s3Client = new S3Client({
      credentials: {
        accessKeyId: this.AWS_ACCESS_KEY_ID,
        secretAccessKey: this.AWS_SECRET_ACCESS_KEY,
      },
      region: this.AWS_REGION,
    });
    this.logger.log('AWS S3 service is being used for file storage.');
  }

  async saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string> {
    const imageName = `${Date.now()}.${type}.png`;
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
      const command = new GetObjectCommand({ Bucket: this.AWS_S3_BUCKET_NAME, Key: fileName });
      const s3Response = await this.s3Client.send(command);
      const stream = s3Response.Body as Readable;
      return PNG.sync.read(Buffer.concat(await stream.toArray()));
    } catch (ex) {
      this.logger.error(`Error from read : Cannot get image: ${fileName}. ${ex}`);
    }
  }

  async getImageUrl(imageName: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: `${this.AWS_S3_BUCKET_NAME}`,
      Key: imageName,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
  }

  async deleteImage(imageName: string): Promise<boolean> {
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
