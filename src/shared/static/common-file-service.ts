import path from 'path';
import { unlink, mkdirSync, existsSync, unlinkSync, statSync, readdir } from 'fs';
import { Logger } from '@nestjs/common/services/logger.service';

export const IMAGE_PATH = 'imageUploads/';

export class CommonFileService {
  readonly DELETE_INTERVAL = 60 * 60 * 1000; // Check for deletions every hour
  deletionQueue: { filePath: string; size: number }[] = [];
  readonly MAX_DISK_USAGE: number = parseInt(process.env.MAX_TEMP_STORAGE_FOR_S3_DOWNLOAD) * 1 * 1024 * 1024;
  logger: Logger;

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

  private ensureDirectoryExistence(dir: string) {
    const filePath = path.resolve(dir);
    if (existsSync(filePath)) {
      return true;
    } else {
      mkdirSync(dir, { recursive: true });
      this.ensureDirectoryExistence(dir);
    }
  }

  doesFileExistLocally(fileName: string) {
    return existsSync(this.getImagePath(fileName));
  }

  scheduleLocalFileDeletion(fileName: string): void {
    const filePath = this.getImagePath(fileName);
    const fileSize = statSync(filePath).size;
    this.deletionQueue.push({ filePath, size: fileSize });
    this.logger.log(`Scheduled deletion for file: ${filePath} with size: ${fileSize} bytes`);
  }

  checkLocalDiskUsageAndClean(): void {
    const totalDiskUsage = this.getTotalDiskUsage();
    if (totalDiskUsage > this.MAX_DISK_USAGE) {
      this.logger.log(`Disk usage exceeded. Triggering cleanup.`);
      this.cleanupQueuedFiles();
    }
  }

  getTotalDiskUsage(): number {
    return this.deletionQueue.reduce((total, file) => total + file.size, 0);
  }

  cleanUpAllFiles() {
    readdir(path.resolve(IMAGE_PATH), (err, files) => {
      if (err) throw err;
      for (const file of files) {
        unlink(path.join(path.resolve(IMAGE_PATH), file), () => {});
      }
    });
  }

  cleanupQueuedFiles(): void {
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
}
