import {
  Controller,
  Get,
  UseGuards,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Put,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiParam, ApiOkResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/auth.guard';
import { TestRunDto } from './dto/test-run.dto';
import { TestService } from './test.service';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { ApiGuard } from 'src/auth/guards/api.guard';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { TestVariationDto } from './dto/test-variation.dto';

@ApiTags('test')
@Controller('test')
export class TestController {
  constructor(private testService: TestService) {}

  @Get(':testRunId')
  @ApiParam({ name: 'testRunId', required: true })
  @ApiOkResponse({ type: TestRunDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getTestRunsByBuildId(
    @Param('testRunId', new ParseUUIDPipe()) testRunId: string,
  ): Promise<TestRunDto> {
    return this.testService.getTestRunById(testRunId);
  }

  @Get('approve/:testRunId')
  @ApiParam({ name: 'testRunId', required: true })
  @ApiOkResponse({ type: TestRunDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  approveTestRun(@Param('testRunId', new ParseUUIDPipe()) testRunId: string): Promise<TestRunDto> {
    return this.testService.approveTestRun(testRunId);
  }

  @Get('reject/:testRunId')
  @ApiParam({ name: 'testRunId', required: true })
  @ApiOkResponse({ type: TestRunDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  rejectTestRun(@Param('testRunId', new ParseUUIDPipe()) testRunId: string): Promise<TestRunDto> {
    return this.testService.rejectTestRun(testRunId);
  }

  @Put('ignoreArea/:variationId')
  @ApiParam({ name: 'variationId', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updateIgnoreAreas(
    @Param('variationId', new ParseUUIDPipe()) variationId: string,
    @Body() ignoreAreas: IgnoreAreaDto[],
  ): Promise<[number, TestVariationDto[]]> {
    return this.testService.updateIgnoreAreas(variationId, ignoreAreas);
  }

  @Post()
  @ApiOkResponse({ type: TestRunDto })
  @ApiSecurity('api_key')
  @UseGuards(ApiGuard)
  postTestRun(@Body() createTestRequestDto: CreateTestRequestDto): Promise<TestRunDto> {
    return this.testService.postTestRun(createTestRequestDto);
  }

  @Delete('/:testRunId')
  @ApiParam({ name: 'testRunId', required: true })
  @ApiOkResponse({ type: Number })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  deleteTestRun(@Param('testRunId', new ParseUUIDPipe()) testRunId: string): Promise<number> {
    return this.testService.deleteTestRun(testRunId);
  }
}
