import { Controller, Get, Logger, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { isHddStaticServiceConfigured, isS3ServiceConfigured } from './utils';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@ApiTags('images')
@Controller('images')
export class StaticController {
  private readonly logger: Logger = new Logger(StaticController.name);

  @Get('/:fileName')
  @ApiOkResponse()
  async getUrlAndRedirect(@Param('fileName') fileName: string, @Res() res: Response) {
    try {
      if (isHddStaticServiceConfigured()) {
        res.redirect('/' + fileName);
      }
      if (isS3ServiceConfigured()) {
        const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
        const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
        const AWS_REGION = process.env.AWS_REGION;
        const AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

        const s3Client = new S3Client({
          credentials: {
            accessKeyId: `${AWS_ACCESS_KEY_ID}`,
            secretAccessKey: `${AWS_SECRET_ACCESS_KEY}`,
          },
          region: `${AWS_REGION}`,
        });
        const command = new GetObjectCommand({
          Bucket: `${AWS_S3_BUCKET_NAME}`,
          Key: fileName,
        });
        res.redirect(await getSignedUrl(s3Client, command, { expiresIn: 3600 }));
      }
    } catch (error) {
      this.logger.error('Error fetching file from S3:' + fileName, error);
      res.status(500).send('Error occurred while getting the file.');
    }
  }
}
