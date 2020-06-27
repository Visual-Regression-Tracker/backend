import { Controller, Delete, UseGuards, Param, ParseUUIDPipe, Put, Body, Get, Query } from '@nestjs/common';
import { ApiTags, ApiParam, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { TestRun } from '@prisma/client';
import { TestRunsService } from './test-runs.service';
import { IgnoreAreaDto } from '../test/dto/ignore-area.dto';

@ApiTags('test-runs')
@Controller('test-runs')
export class TestRunsController {
  constructor(private testRunsService: TestRunsService) {}

  @Get()
  @ApiQuery({ name: 'buildId', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  get(@Query('buildId', new ParseUUIDPipe()) buildId: string): Promise<TestRun[]> {
    return this.testRunsService.findMany(buildId);
  }

  @Get('recalculateDiff/:id')
  @ApiParam({ name: 'id', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  recalculateDiff(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestRun> {
    return this.testRunsService.recalculateDiff(id);
  }

  @Get('approve/:id')
  @ApiParam({ name: 'id', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  approveTestRun(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestRun> {
    return this.testRunsService.approve(id);
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
  updateComment(@Param('testRunId', new ParseUUIDPipe()) testRunId: string, @Body() comment: string): Promise<TestRun> {
    return this.testRunsService.updateComment(testRunId, comment);
  }
}
