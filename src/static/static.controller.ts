import { Controller, Get, Logger, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { StaticService } from './static.service';

@ApiTags('images')
@Controller('images')
export class StaticController {
  private readonly logger: Logger = new Logger(StaticController.name);
  constructor(private staticService: StaticService) {}

  @Get('/:fileName')
  @ApiOkResponse()
  async getUrlAndRedirect(@Param('fileName') fileName: string, @Res() res: Response) {
    try {
      const url = await this.staticService.getImageUrl(fileName);
      res.redirect(url);
    } catch (error) {
      this.logger.error('Error fetching file from S3:' + fileName, error);
      res.status(500).send('Error occurred while getting the file.');
    }
  }

  /**
   * Serves the image bytes from this origin instead of redirecting to storage.
   * Redirected pre-signed S3 URLs carry no CORS headers, so a browser `fetch`
   * (used to build the bulk download zip) is blocked; an `<img>` tag is not,
   * which is why display keeps using the redirect above.
   */
  @Get('/:fileName/download')
  @ApiOkResponse()
  async download(@Param('fileName') fileName: string, @Res() res: Response) {
    const imageBuffer = await this.staticService.getImageBuffer(fileName);
    if (!imageBuffer) {
      throw new NotFoundException(`Image not found: ${fileName}`);
    }
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    res.send(imageBuffer);
  }
}
