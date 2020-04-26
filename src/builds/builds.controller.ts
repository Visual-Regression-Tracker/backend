import {
  Controller,
  Get,
  UseGuards,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { BuildsService } from './builds.service';
import { JwtAuthGuard } from 'src/auth/guards/auth.guard';
import { BuildDto } from './dto/builds.dto';
import {
  ApiOkResponse,
  ApiBearerAuth,
  ApiTags,
  ApiParam,
  ApiSecurity,
} from '@nestjs/swagger';
import { CreateBuildDto } from './dto/build-create.dto';
import { ApiGuard } from 'src/auth/guards/api.guard';
import { TestRunDto } from 'src/test/dto/test-run.dto';

@Controller('builds')
@ApiTags('builds')
export class BuildsController {
  constructor(private buildsService: BuildsService) {}

  @Get(':id')
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ type: [TestRunDto] })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getDetails(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestRunDto[]> {
    return this.buildsService.findById(id);
  }

  @Post()
  @ApiOkResponse({ type: BuildDto })
  @ApiSecurity('api_key')
  @UseGuards(ApiGuard)
  create(@Body() createBuildDto: CreateBuildDto): Promise<BuildDto> {
    return this.buildsService.create(createBuildDto);
  }
}
