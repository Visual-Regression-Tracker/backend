import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// The only build columns a client may change: the SDKs stop a build (an empty
// body, see BuildsController.update) and a CI may attach its own build id.
// Everything else — branch, number, status — belongs to the server.
export class ModifyBuildDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly ciBuildId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  readonly isRunning?: boolean;
}
