import { Injectable, Logger } from '@nestjs/common';
import path from 'path';
import {
  writeFileSync,
  readFileSync,
  unlink,
  mkdirSync,
  existsSync,
  createWriteStream,
  unlinkSync,
  statSync,
  readdir,
} from 'fs';
import { PNG, PNGWithMetadata } from 'pngjs';

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

export const IMAGE_PATH = 'imageUploads/';

@Injectable()
export class StaticService {
  private readonly logger: Logger = new Logger(StaticService.name);

  private readonly USE_AWS_S3_BUCKET = process.env.USE_AWS_S3_BUCKET?.trim().toLowerCase();
  private readonly AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
  private readonly AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
  private readonly AWS_REGION = process.env.AWS_REGION;
  private readonly AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;
  private readonly MAX_DISK_USAGE: number = parseInt(process.env.MAX_TEMP_STORAGE_FOR_S3_DOWNLOAD) * 1 * 1024 * 1024;
  private s3Client: S3Client;

  private readonly DELETE_INTERVAL = 60 * 60 * 1000; // Check for deletions every hour
  private deletionQueue: { filePath: string; size: number }[] = [];

  constructor() {
    setInterval(() => this.cleanupQueuedFiles(), this.DELETE_INTERVAL);
    this.cleanUpAllFiles();
  }

  getEnvBoolean(value: string, defaultValue: boolean = false): boolean {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return defaultValue;
  }

  isAWSDefined(): boolean {
    const areAWSVariablesValid =
      this.getEnvBoolean(this.USE_AWS_S3_BUCKET) &&
      this.AWS_ACCESS_KEY_ID?.trim().length > 1 &&
      this.AWS_SECRET_ACCESS_KEY?.trim().length > 1 &&
      this.AWS_S3_BUCKET_NAME?.trim().length > 1;

    if (areAWSVariablesValid && !this.s3Client) {
      this.s3Client = new S3Client({
        credentials: {
          accessKeyId: this.AWS_ACCESS_KEY_ID,
          secretAccessKey: this.AWS_SECRET_ACCESS_KEY,
        },
        region: this.AWS_REGION,
      });
      this.logger.log('Using AWS S3 bucket.');
    }
    return areAWSVariablesValid;
  }

  generateNewImage(type: 'screenshot' | 'diff' | 'baseline'): { imageName: string; imagePath: string } {
    const imageName = `${Date.now()}.${type}.png`;
    return {
      imageName,
      imagePath: this.getImagePath(imageName),
    };
  }

  getImagePath(imageName: string): string {
    this.ensureDirectoryExistence(IMAGE_PATH);
    return path.resolve(IMAGE_PATH, imageName);
  }

  async saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer): Promise<string> {
    const { imageName, imagePath } = this.generateNewImage(type);
    try {
      if (this.isAWSDefined()) {
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.AWS_S3_BUCKET_NAME,
            Key: imageName,
            ContentType: 'image/png',
            Body: imageBuffer,
          })
        );
        return imageName;
      } else {
        new PNG().parse(imageBuffer);
        writeFileSync(imagePath, imageBuffer);
        return imageName;
      }
    } catch (ex) {
      throw new Error('Cannot parse image as PNG file: ' + ex);
    }
  }

  scheduleFileDeletion(fileName: string): void {
    const filePath = this.getImagePath(fileName);
    const fileSize = statSync(filePath).size;
    this.deletionQueue.push({ filePath, size: fileSize });
    this.logger.log(`Scheduled deletion for file: ${filePath} with size: ${fileSize} bytes`);
  }

  checkDiskUsageAndClean(): void {
    const totalDiskUsage = this.getTotalDiskUsage();
    if (totalDiskUsage > this.MAX_DISK_USAGE) {
      this.logger.log(`Disk usage exceeded. Triggering cleanup.`);
      this.cleanupQueuedFiles();
    }
  }

  private getTotalDiskUsage(): number {
    return this.deletionQueue.reduce((total, file) => total + file.size, 0);
  }

  private cleanUpAllFiles() {
    readdir(path.resolve(IMAGE_PATH), (err, files) => {
      if (err) throw err;
      for (const file of files) {
        unlink(path.join(path.resolve(IMAGE_PATH), file), (err) => {
          if (err) throw err;
        });
      }
    });
  }

  private cleanupQueuedFiles(): void {
    const totalDiskUsage = this.getTotalDiskUsage();
    this.logger.log(`Cleaning up files. Total disk usage: ${totalDiskUsage} bytes`);

    // Delete files until the total disk usage is within the limit
    let currentUsage = totalDiskUsage;

    if (currentUsage > this.MAX_DISK_USAGE) {
      // Sort files by the earliest (oldest) first for deletion
      this.deletionQueue.sort((a, b) => statSync(a.filePath).birthtimeMs - statSync(b.filePath).birthtimeMs);

      // Reduce the size by half
      while (currentUsage > this.MAX_DISK_USAGE / 2 && this.deletionQueue.length > 0) {
        const fileToDelete = this.deletionQueue.shift();
        if (fileToDelete) {
          try {
            unlinkSync(fileToDelete.filePath);
            currentUsage -= fileToDelete.size;
            this.logger.log(`Deleted file: ${fileToDelete.filePath}`);
          } catch (error) {
            this.logger.log(`Failed to delete file: ${fileToDelete.filePath}. Error: ${error.message}`);
          }
        }
      }
    }
  }

  doesFileExist(fileName: string) {
    return existsSync(this.getImagePath(fileName));
  }

  async getImage(fileName: string): Promise<PNGWithMetadata> {
    if (!fileName) return null;
    try {
      if (!this.doesFileExist(fileName) && this.isAWSDefined()) {
        const localFileStream = await this.saveFileToServerFromS3(fileName);
        await new Promise<void>((resolve, reject) => {
          localFileStream.on('finish', () => {
            this.scheduleFileDeletion(fileName);
            this.checkDiskUsageAndClean();
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

  async saveFileToServerFromS3(fileName: string) {
    if (this.isAWSDefined()) {
      const command = new GetObjectCommand({ Bucket: this.AWS_S3_BUCKET_NAME, Key: fileName });
      const s3Response = await this.s3Client.send(command);
      const fileStream = s3Response.Body as Readable;
      const localFileStream = createWriteStream(this.getImagePath(fileName));
      fileStream.pipe(localFileStream);
      this.logger.log(`File saved locally at ${this.getImagePath(fileName)}`);
      return localFileStream;
    } else {
      throw Error('Error connecting to AWS');
    }
  }

  async deleteImage(imageName: string): Promise<boolean> {
    if (!imageName) return false;
    if (this.isAWSDefined()) {
      try {
        await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.AWS_S3_BUCKET_NAME, Key: imageName }));
        return true;
      } catch (error) {
        this.logger.log(`Failed to delete image ${imageName}:`, error);
        return false; // Return `false` if an error occurs.
      }
    } else {
      return new Promise((resolvePromise) => {
        unlink(this.getImagePath(imageName), (err) => {
          if (err) {
            this.logger.error(err);
            resolvePromise(false);
          }
          resolvePromise(true);
        });
      });
    }
  }

  private ensureDirectoryExistence(dir: string) {
    const filePath = path.resolve(dir);
    if (existsSync(filePath)) {
      return true;
    } else {
      mkdirSync(dir, { recursive: true });
      this.ensureDirectoryExistence(dir);
    }
  }
}
