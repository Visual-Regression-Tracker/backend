import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CreateTestRequestDto } from './create-test-request.dto';

export class CreateTestRequestBase64Dto extends CreateTestRequestDto {
  @ApiProperty()
  @IsString()
  imageBase64!: string;
}
