import {
  Controller,
  Delete,
  UseGuards,
  Param,
  ParseUUIDPipe,
  Put,
  Body,
  Get,
  Query,
  Post,
  ParseBoolPipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiParam, ApiBearerAuth, ApiQuery, ApiSecurity, ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { TestRun } from '@prisma/client';
import { TestRunsService } from './test-runs.service';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { CommentDto } from '../shared/dto/comment.dto';
import { TestRunResultDto } from './dto/testRunResult.dto';
import { ApiGuard } from '../auth/guards/api.guard';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { PaginatedTestRunDto } from './dto/testRun-paginated.dto';

@ApiTags('test-runs')
@Controller('test-runs')
export class TestRunsController {
  constructor(private testRunsService: TestRunsService) {}

  @Get()
  @ApiOkResponse({ type: PaginatedTestRunDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  get(
    @Query('buildId', new ParseUUIDPipe()) buildId: string,
    @Query('take', new ParseIntPipe()) take: number,
    @Query('skip', new ParseIntPipe()) skip: number
  ): Promise<PaginatedTestRunDto> {
    return this.testRunsService.findMany(buildId, take, skip);
  }

  @Get('recalculateDiff/:id')
  @ApiParam({ name: 'id', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  recalculateDiff(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestRun> {
    return this.testRunsService.recalculateDiff(id);
  }

  @Get('approve')
  @ApiQuery({ name: 'id', required: true })
  @ApiQuery({ name: 'merge', required: false })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  approveTestRun(
    @Query('id', new ParseUUIDPipe()) id: string,
    @Query('merge', new ParseBoolPipe()) merge: boolean
  ): Promise<TestRun> {
    return this.testRunsService.approve(id, merge);
  }

  @Get('reject/:id')
  @ApiParam({ name: 'id', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  rejectTestRun(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestRun> {
    return this.testRunsService.reject(id);
  }

  @Delete('/:id')
  @ApiParam({ name: 'id', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  deleteTestRun(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestRun> {
    return this.testRunsService.delete(id);
  }

  @Put('ignoreArea/:testRunId')
  @ApiParam({ name: 'testRunId', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updateIgnoreAreas(
    @Param('testRunId', new ParseUUIDPipe()) testRunId: string,
    @Body() ignoreAreas: IgnoreAreaDto[]
  ): Promise<TestRun> {
    return this.testRunsService.updateIgnoreAreas(testRunId, ignoreAreas);
  }

  @Put('comment/:testRunId')
  @ApiParam({ name: 'testRunId', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updateComment(@Param('testRunId', new ParseUUIDPipe()) id: string, @Body() body: CommentDto): Promise<TestRun> {
    return this.testRunsService.updateComment(id, body);
  }

  @Post()
  @ApiSecurity('api_key')
  @ApiOkResponse({ type: TestRunResultDto })
  @UseGuards(ApiGuard)
  postTestRun(@Body() createTestRequestDto: CreateTestRequestDto): Promise<TestRunResultDto> {
    return this.testRunsService.postTestRun(createTestRequestDto);
  }
}
