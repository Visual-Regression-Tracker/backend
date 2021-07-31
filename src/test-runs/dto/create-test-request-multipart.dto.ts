import { ApiFile } from '../../shared/api-file.decorator';
import { CreateTestRequestDto } from './create-test-request.dto';

export class CreateTestRequestMultipartDto extends CreateTestRequestDto {
  @ApiFile()
  image: Express.Multer.File;
}
