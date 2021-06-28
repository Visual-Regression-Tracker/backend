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
  UsePipes,
  ValidationPipe,
  Logger,
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
import { CustomTagsDto } from '../shared/dto/custom-tags.dto';

@ApiTags('test-runs')
@Controller('test-runs')
export class TestRunsController {
  private readonly logger: Logger = new Logger(TestRunsController.name);

  constructor(private testRunsService: TestRunsService) {}

  @Get()
  @ApiOkResponse({ type: [TestRunDto] })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  get(@Query('buildId', new ParseUUIDPipe()) buildId: string): Promise<TestRunDto[]> {
    return this.testRunsService.findMany(buildId);
  }

  @Post('approve')
  @ApiQuery({ name: 'merge', required: false })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async approveTestRun(@Body() ids: string[], @Query('merge', new ParseBoolPipe()) merge: boolean): Promise<void> {
    this.logger.debug(`Going to approve TestRuns: ${ids}`);
    for (const id of ids) {
      await this.testRunsService.approve(id, merge);
    }
  }

  @Post('reject')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async reject(@Body() ids: string[]): Promise<void> {
    this.logger.debug(`Going to reject TestRuns: ${ids}`);
    for (const id of ids) {
      await this.testRunsService.setStatus(id, TestStatus.failed);
    }
  }

  @Post('/delete')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async delete(@Body() ids: string[]): Promise<void> {
    this.logger.debug(`Going to delete TestRuns: ${ids}`);
    for (const id of ids) {
      await this.testRunsService.delete(id);
    }
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

  @Put('customTags/:testRunId')
  @ApiParam({ name: 'testRunId', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updateCustomTags(@Param('testRunId', new ParseUUIDPipe()) id: string, @Body() body: CustomTagsDto): Promise<TestRun> {
    return this.testRunsService.updateCustomTags(id, body);
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
  @UsePipes(new ValidationPipe({ transform: true }))
  postTestRunMultipart(@Body() createTestRequestDto: CreateTestRequestMultipartDto): Promise<TestRunResultDto> {
    const imageBuffer = createTestRequestDto.image.buffer;
    return this.testRunsService.postTestRun({ createTestRequestDto, imageBuffer });
  }
}
