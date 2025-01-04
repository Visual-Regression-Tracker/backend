import { Controller, Get, Logger, Param, Res } from '@nestjs/common';
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
}
