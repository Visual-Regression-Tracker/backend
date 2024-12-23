export interface StaticService {
  // Below are service specific functions
  saveImage(type: 'screenshot' | 'diff' | 'baseline', imageBuffer: Buffer);
  getImage(fileName: string);
  deleteImage(imageName: string);

  doesFileExistLocally(fileName: string);
  saveFileFromCloud(fileName: string);
  scheduleLocalFileDeletion(fileName: string);
  checkLocalDiskUsageAndClean();

  getImagePath(imageName: string);
  generateNewImage(imageName: string);
}

export const STATIC_SERVICE = 'FILE_SERVICE';
