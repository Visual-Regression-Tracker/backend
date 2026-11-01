import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ValidationOptions } from '../../shared/validation';

@ValidationOptions({ forbidNonWhitelisted: true })
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
