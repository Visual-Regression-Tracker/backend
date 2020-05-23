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
import { TestService } from './test.service';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { ApiGuard } from 'src/auth/guards/api.guard';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { TestRun, TestVariation } from '@prisma/client';
import { TestRunResultDto } from './dto/testRunResult.dto';

@ApiTags('test')
@Controller('test')
export class TestController {
  constructor(private testService: TestService) { }

  @Get(':testRunId')
  @ApiParam({ name: 'testRunId', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getTestRunDetails(
    @Param('testRunId', new ParseUUIDPipe()) testRunId: string,
  ): Promise<TestRun> {
    return this.testService.getTestRunById(testRunId);
  }

  @Get('approve/:testRunId')
  @ApiParam({ name: 'testRunId', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  approveTestRun(@Param('testRunId', new ParseUUIDPipe()) testRunId: string): Promise<TestRun> {
    return this.testService.approveTestRun(testRunId);
  }

  @Get('reject/:testRunId')
  @ApiParam({ name: 'testRunId', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  rejectTestRun(@Param('testRunId', new ParseUUIDPipe()) testRunId: string): Promise<TestRun> {
    return this.testService.rejectTestRun(testRunId);
  }

  @Put('ignoreArea/:variationId')
  @ApiParam({ name: 'variationId', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updateIgnoreAreas(
    @Param('variationId', new ParseUUIDPipe()) variationId: string,
    @Body() ignoreAreas: IgnoreAreaDto[],
  ): Promise<TestVariation> {
    return this.testService.updateIgnoreAreas(variationId, ignoreAreas);
  }

  @Post()
  @ApiSecurity('api_key')
  @ApiOkResponse({ type: TestRunResultDto })
  @UseGuards(ApiGuard)
  postTestRun(@Body() createTestRequestDto: CreateTestRequestDto): Promise<TestRunResultDto> {
    return this.testService.postTestRun(createTestRequestDto);
  }
}
