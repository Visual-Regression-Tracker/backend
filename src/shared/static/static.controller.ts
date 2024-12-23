import { Controller, Get, Inject, Logger, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { STATIC_SERVICE, StaticService } from './static-service.interface';

@ApiTags('images')
@Controller('images')
export class StaticController {
  private readonly logger: Logger = new Logger(StaticController.name);

  constructor(@Inject(STATIC_SERVICE) private readonly staticService: StaticService) {}

  @Get('/:fileName')
  @ApiOkResponse()
  async downloadPngAndRedirect(@Param('fileName') fileName: string, @Res() res: Response) {
    try {
      if (!fileName.endsWith('.png')) {
        return res.status(400).send('Invalid file type. Only PNG files are allowed.');
      }
      if (this.staticService.doesFileExistLocally(fileName)) {
        res.redirect('/' + fileName);
      } else {
        const localFileStream = await this.staticService.saveFileFromCloud(fileName);
        localFileStream.on('finish', () => {
          this.staticService.scheduleLocalFileDeletion(fileName);
          this.staticService.checkLocalDiskUsageAndClean();
          // After saving the file from the cloud, just redirect to the local file.
          res.redirect('/' + fileName);
        });
        localFileStream.on('error', (error) => {
          this.logger.error('Error writing file:', error);
          res.status(500).send('Error occurred while saving the file.');
        });
      }
    } catch (error) {
      this.logger.error('Error fetching file from S3:' + fileName, error);
      res.status(500).send('Error occurred while downloading the file.');
    }
  }
}
