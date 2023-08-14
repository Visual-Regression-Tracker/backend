import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBase64 } from 'class-validator';
import { CreateTestRequestDto } from './create-test-request.dto';

export class CreateTestRequestBase64Dto extends CreateTestRequestDto {
  @ApiProperty()
  @Transform(({ value }) => value.replace(/(\r\n|\n|\r)/gm, ''))
  @IsBase64()
  imageBase64: string;
}
