import { Controller, Get, Logger, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { StaticService } from './static.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('images')
@Controller('images')
export class StaticController {
  private readonly logger: Logger = new Logger(StaticController.name);

  constructor(private staticService: StaticService) {}

  @Get('/:fileName')
  @ApiOkResponse()
  async downloadPngAndRedirect(@Param('fileName') fileName: string, @Res() res: Response) {
    try {
      if (!fileName.endsWith('.png')) {
        return res.status(400).send('Invalid file type. Only PNG files are allowed.');
      }
      if (this.staticService.doesFileExist(fileName)) {
        res.redirect('/' + fileName);
      } else {
        const localFileStream = await this.staticService.saveFileToServerFromS3(fileName);
        localFileStream.on('finish', () => {
          this.staticService.scheduleFileDeletion(fileName);
          this.staticService.checkDiskUsageAndClean();
          // After saving the file from S3, just redirect to the local file.
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
