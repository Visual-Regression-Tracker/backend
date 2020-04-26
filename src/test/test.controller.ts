import {
  Controller,
  Get,
  UseGuards,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
} from '@nestjs/common';
import {
  ApiTags,
  ApiParam,
  ApiOkResponse,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { BuildDto } from 'src/builds/dto/builds.dto';
import { JwtAuthGuard } from 'src/auth/guards/auth.guard';
import { TestRunDto } from './dto/test-run.dto';
import { TestService } from './test.service';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { ApiGuard } from 'src/auth/guards/api.guard';

@ApiTags('test')
@Controller('test')
export class TestController {
  constructor(private testService: TestService) {}

  @Get(':buildId')
  @ApiParam({ name: 'buildId', required: true })
  @ApiOkResponse({ type: [TestRunDto] })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getTestRunsByBuildId(
    @Param('buildId', new ParseUUIDPipe()) buildId: string,
  ): Promise<TestRunDto[]> {
    return this.testService.getTestRunsByBuildId(buildId);
  }

  @Post()
  @ApiOkResponse({ type: TestRunDto })
  @ApiSecurity('api_key')
  @UseGuards(ApiGuard)
  postTestRunResult(
    @Body() createTestRequestDto: CreateTestRequestDto,
  ): Promise<TestRunDto> {
    return this.testService.postTestRunResult(createTestRequestDto);
  }
}
