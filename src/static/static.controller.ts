import { BadRequestException, Controller, Get, Logger, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { basename } from 'path';
import { StaticService } from './static.service';

// Shorter than the window a signed URL is minted for (URL_WINDOW_SECONDS), so a
// cached redirect always still points at a URL that works.
const REDIRECT_MAX_AGE_SECONDS = 3000;

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
      // The redirect has to be reusable too, or the browser comes back here for
      // a location on every single view — and a storage that signs its URLs
      // hands back a different one each time, making the copy the browser
      // already holds worthless. Kept well inside the signature's life so the
      // redirect can never outlive what it points at. Private, because a signed
      // URL is an access grant and has no business in a shared cache.
      res.set('Cache-Control', `private, max-age=${REDIRECT_MAX_AGE_SECONDS}`);
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
    // a stored image is always a plain file name, so anything carrying a path
    // is rejected before it reaches storage. basename keeps '.' and '..' as
    // they are, so both are named here rather than reaching a backend that
    // would answer 500 for them, or ask storage for a directory.
    if (!fileName || fileName === '.' || fileName === '..' || fileName !== basename(fileName)) {
      throw new BadRequestException('Invalid image name');
    }

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
