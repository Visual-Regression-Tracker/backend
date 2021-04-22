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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiParam,
  ApiBearerAuth,
  ApiQuery,
  ApiSecurity,
  ApiOkResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { TestRun, TestStatus } from '@prisma/client';
import { TestRunsService } from './test-runs.service';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { CommentDto } from '../shared/dto/comment.dto';
import { TestRunResultDto } from './dto/testRunResult.dto';
import { ApiGuard } from '../auth/guards/api.guard';
import { TestRunDto } from './dto/testRun.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateTestRequestBase64Dto } from './dto/create-test-request-base64.dto';
import { CreateTestRequestMultipartDto } from './dto/create-test-request-multipart.dto';
import { FileToBodyInterceptor } from '../shared/fite-to-body.interceptor';

@ApiTags('test-runs')
@Controller('test-runs')
export class TestRunsController {
  constructor(private testRunsService: TestRunsService) {}

  @Get()
  @ApiOkResponse({ type: [TestRunDto] })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  get(@Query('buildId', new ParseUUIDPipe()) buildId: string): Promise<TestRunDto[]> {
    return this.testRunsService.findMany(buildId);
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
    return this.testRunsService.setStatus(id, TestStatus.failed);
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
  postTestRun(@Body() createTestRequestDto: CreateTestRequestBase64Dto): Promise<TestRunResultDto> {
    const imageBuffer = Buffer.from(createTestRequestDto.imageBase64, 'base64');
    return this.testRunsService.postTestRun({
      createTestRequestDto,
      imageBuffer,
    });
  }

  @Post('/multipart')
  @ApiSecurity('api_key')
  @ApiBody({ type: CreateTestRequestMultipartDto })
  @ApiOkResponse({ type: TestRunResultDto })
  @ApiConsumes('multipart/form-data')
  @UseGuards(ApiGuard)
  @UseInterceptors(FileInterceptor('image'), FileToBodyInterceptor)
  postTestRunMultipart(
    @Body() createTestRequestDto: CreateTestRequestMultipartDto
  ): Promise<TestRunResultDto> {
    const imageBuffer = createTestRequestDto.image.buffer;
    return this.testRunsService.postTestRun({ createTestRequestDto, imageBuffer });
  }
}
