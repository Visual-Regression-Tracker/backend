import { PNG, PNGWithMetadata } from 'pngjs';
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

// How long one pre-signed URL is reused before a new one is minted. Also the
// lifetime S3 is asked to advertise on the object itself.
export const URL_WINDOW_SECONDS = 3600;

export class AWSS3Service implements Static {
  private readonly logger: Logger = new Logger(AWSS3Service.name);
  private readonly AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

  private s3Client: S3Client;

  constructor() {
    // S3-compatible storage — MinIO, Ceph, Garage — is normally addressed
    // path-style (host/bucket/key), while AWS uses virtual-host style
    // (bucket.host/key) and the SDK assumes that. It has no environment
    // variable for the switch, so without this a self-hosted deployment cannot
    // point VRT at its own storage, and neither can anyone standing up a
    // production-shaped stack locally. The endpoint itself the SDK does read
    // from AWS_ENDPOINT_URL.
    const forcePathStyle = process.env.AWS_S3_FORCE_PATH_STYLE === 'true';
    this.s3Client = new S3Client(forcePathStyle ? { forcePathStyle } : {});
    this.logger.log(
      `AWS S3 service is being used for file storage${forcePathStyle ? ' (path-style addressing)' : ''}.`
    );
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

  async getImage(fileName: string): Promise<PNGWithMetadata> {
    if (!fileName) return null;
    try {
      // the comparison pipeline treats an unreadable image as a missing
      // baseline, so storage failures stay contained here
      const imageBuffer = await this.getImageBuffer(fileName);
      if (!imageBuffer) return undefined;
      return PNG.sync.read(imageBuffer);
    } catch (ex) {
      this.logger.error(`Error from read : Cannot get image: ${fileName}. ${ex}`);
    }
  }

  async getImageBuffer(fileName: string): Promise<Buffer | null> {
    if (!fileName) return null;
    try {
      const command = new GetObjectCommand({ Bucket: this.AWS_S3_BUCKET_NAME, Key: fileName });
      const s3Response = await this.s3Client.send(command);
      const stream = s3Response.Body as Readable;
      return Buffer.concat(await stream.toArray());
    } catch (ex) {
      this.logger.error(`Error from read : Cannot get image: ${fileName}. ${ex}`);
      // only a missing object means "no image"; credentials, throttling and
      // network failures have to stay errors instead of reading as absence
      if (ex?.name === 'NoSuchKey' || ex?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw ex;
    }
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

  /**
   * A pre-signed URL for the object, stable for the length of a window.
   *
   * A browser caches by URL. Signing from the current instant gave every
   * request a different URL, so the bytes it had just downloaded could never be
   * reused: reopening a screen, or stepping back one, paid for the whole image
   * again. Signing from the start of a fixed window instead makes every request
   * inside that window produce the very same URL, which a cache can hit.
   *
   * The signature is given twice the window to live, so a URL handed out at the
   * last second of one window is still good for a whole window afterwards.
   *
   * `ResponseCacheControl` makes S3 answer with a cache header of its own —
   * without it a stable URL still leaves the browser guessing, since the bucket
   * sets none. An image name is unique per upload and its bytes never change,
   * so the only thing bounding the lifetime is the signature.
   */
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
