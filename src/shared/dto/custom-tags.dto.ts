import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CustomTagsDto {
    @ApiProperty()
    @IsString()
    customTags: string;
}
