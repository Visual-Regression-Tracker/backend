import { BadRequestException, Controller, Get, Logger, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { pipeline } from 'stream/promises';
import { StaticService } from './static.service';

const REDIRECT_MAX_AGE_SECONDS = 3000;

export const IMAGE_NAME_PATTERN = /^[0-9A-Za-z_-]{1,64}\.(screenshot|diff|baseline)\.png$/;

const assertImageName = (fileName: string): void => {
  if (!IMAGE_NAME_PATTERN.test(fileName)) {
    throw new BadRequestException('Invalid image name');
  }
};

@ApiTags('images')
@Controller('images')
export class StaticController {
  private readonly logger: Logger = new Logger(StaticController.name);

  constructor(private staticService: StaticService) {}

  @Get('/:fileName')
  @ApiOkResponse()
  async getUrlAndRedirect(@Param('fileName') fileName: string, @Res() res: Response) {
    assertImageName(fileName);
    try {
      const url = await this.staticService.getImageUrl(fileName);
      res.set('Cache-Control', `private, max-age=${REDIRECT_MAX_AGE_SECONDS}`);
      res.redirect(url);
    } catch (error) {
      this.logger.error('Error fetching file from S3:' + fileName, error);
      res.status(500).send('Error occurred while getting the file.');
    }
  }

  @Get('/:fileName/download')
  @ApiOkResponse()
  async download(@Param('fileName') fileName: string, @Res() res: Response) {
    assertImageName(fileName);

    const stream = await this.staticService.getImageStream(fileName);
    if (!stream) {
      throw new NotFoundException(`Image not found: ${fileName}`);
    }
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    try {
      await pipeline(stream, res);
    } catch (error) {
      this.logger.warn(`Download of ${fileName} stopped: ${error}`);
    }
  }
}
