import {
  Controller,
  UseGuards,
  Param,
  ParseUUIDPipe,
  Body,
  Get,
  Query,
  Post,
  ParseBoolPipe,
  UseInterceptors,
  Logger,
  Patch,
  NotFoundException,
  BadRequestException,
  ParseArrayPipe,
  HttpCode,
  HttpException,
  PipeTransform,
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
  ApiOperation,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { Role, TestRun, User } from '@prisma/client';
import { TestRunsService } from './test-runs.service';
import { TestRunResultDto } from './dto/testRunResult.dto';
import { ApiGuard } from '../auth/guards/api.guard';
import { TestRunDto } from './dto/testRun.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateTestRequestBase64Dto } from './dto/create-test-request-base64.dto';
import { CreateTestRequestMultipartDto } from './dto/create-test-request-multipart.dto';
import { FileToBodyInterceptor } from '../shared/fite-to-body.interceptor';
import { UpdateIgnoreAreasDto } from './dto/update-ignore-area.dto';
import { UpdateTestRunDto } from './dto/update-test.dto';
import { CurrentUser } from '../shared/current-user.decorator';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../shared/roles.decorator';
import { isPngBuffer } from '../static/utils';
import { positiveNumber } from '../utils/env';
import { isUUID } from 'class-validator';
import { BulkResultDto } from './dto/bulk-result.dto';
import { isPrismaError } from '../prisma/prisma-errors';

const DEFAULT_MULTIPART_FILE_SIZE_LIMIT = 100 * 1024 * 1024;

// read per request: decorators run before ConfigModule has loaded .env
export const multipartLimits = () => ({
  fileSize: positiveNumber(process.env.MULTIPART_FILE_SIZE_LIMIT, DEFAULT_MULTIPART_FILE_SIZE_LIMIT),
});

export const parseIds = () => new ParseArrayPipe({ items: String });

export const parseUuidIds = (): PipeTransform<string[], string[]> => ({
  transform: (ids) => {
    const invalid = ids.filter((id) => !isUUID(id));
    if (invalid.length) {
      throw new BadRequestException(`Not a uuid: ${invalid.join(', ')}`);
    }
    return ids;
  },
});

function pngOrBadRequest(imageBuffer: unknown): Buffer {
  if (!Buffer.isBuffer(imageBuffer) || !isPngBuffer(imageBuffer)) {
    throw new BadRequestException('Image is not a PNG file');
  }
  return imageBuffer;
}

@ApiTags('test-runs')
@Controller('test-runs')
export class TestRunsController {
  private readonly logger: Logger = new Logger(TestRunsController.name);

  constructor(private testRunsService: TestRunsService) {}

  @Get()
  @ApiOkResponse({ type: TestRunDto, isArray: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  get(@Query('buildId', new ParseUUIDPipe()) buildId: string): Promise<TestRunDto[]> {
    return this.testRunsService.findMany(buildId);
  }

  @Get(':id')
  @ApiOkResponse({ type: TestRunDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async getDetails(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestRunDto> {
    const testRun = await this.testRunsService.findOne(id);
    if (!testRun) {
      throw new NotFoundException(`Test run not found: ${id}`);
    }
    return testRun;
  }

  @Post('approve')
  @HttpCode(200)
  @ApiQuery({ name: 'merge', required: false })
  @ApiOkResponse({ type: BulkResultDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  approveTestRun(
    @CurrentUser() user: User,
    @Body(parseIds()) ids: string[],
    @Query('merge', new ParseBoolPipe()) merge: boolean
  ): Promise<BulkResultDto> {
    this.logger.debug(`Going to approve TestRuns: ${ids}`);
    return this.forEachId('approve', ids, (id) => this.testRunsService.approve(id, merge, false, user.id));
  }

  @Get('matchingSiblings/:id')
  @ApiOperation({
    summary: 'Preview the variation group of a test run for bulk review',
    description:
      'Read-only. Returns the reviewed test run together with its sibling variations in the same build ' +
      '(same name/os/device/browser/viewport/branch, differing only by customTags — e.g. locales) whose ' +
      'change matches it, plus the siblings left out (skipped) because of a different/additional change. ' +
      'Nothing is mutated: the reviewer confirms the group and then approves/rejects the chosen ids, so a ' +
      'similar-looking regression can never be accepted without a human seeing it.',
  })
  @ApiParam({ name: 'id', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getMatchingSiblings(
    @Param('id', new ParseUUIDPipe()) id: string
  ): Promise<{ variations: TestRunDto[]; skipped: Array<TestRunDto & { reason: string }> }> {
    return this.testRunsService.getMatchingVariations(id);
  }

  @Post('reject')
  @HttpCode(200)
  @ApiOkResponse({ type: BulkResultDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  reject(@Body(parseIds()) ids: string[]): Promise<BulkResultDto> {
    this.logger.debug(`Going to reject TestRuns: ${ids}`);
    return this.forEachId('reject', ids, (id) => this.testRunsService.reject(id));
  }

  @Post('revert')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  revert(@Body(parseIds(), parseUuidIds()) ids: string[]): Promise<void> {
    this.logger.debug(`Going to revert TestRuns: ${ids}`);
    return this.testRunsService.revert(ids);
  }

  @Post('delete')
  @HttpCode(200)
  @ApiOkResponse({ type: BulkResultDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  delete(@Body(parseIds()) ids: string[]): Promise<BulkResultDto> {
    this.logger.debug(`Going to delete TestRuns: ${ids}`);
    return this.forEachId('delete', ids, (id) => this.testRunsService.delete(id));
  }

  @Post('ignoreAreas/update')
  @ApiOkResponse({ type: undefined })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  async updateIgnoreAreas(@Body() data: UpdateIgnoreAreasDto): Promise<void> {
    this.logger.debug(`Going to update IgnoreAreas for TestRuns: ${data.ids}`);
    for (const id of data.ids) {
      await this.testRunsService.updateIgnoreAreas(id, data.ignoreAreas);
    }
  }

  @Post('ignoreAreas/add')
  @ApiOkResponse({ type: undefined })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  async addIgnoreAreas(@Body() data: UpdateIgnoreAreasDto): Promise<void> {
    this.logger.debug(`Going to add IgnoreAreas for TestRuns: ${data.ids}`);
    for (const id of data.ids) {
      await this.testRunsService.addIgnoreAreas(id, data.ignoreAreas);
    }
  }

  @Patch('update/:testRunId')
  @ApiParam({ name: 'testRunId', required: true })
  @ApiOkResponse({ type: TestRunDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  update(@Param('testRunId', new ParseUUIDPipe()) id: string, @Body() body: UpdateTestRunDto): Promise<TestRun> {
    this.logger.debug(`Going to update TestRuns: ${id}`);
    return this.testRunsService.update(id, body);
  }

  @Post()
  @ApiSecurity('api_key')
  @ApiOkResponse({ type: TestRunResultDto })
  @UseGuards(ApiGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  async postTestRun(@Body() createTestRequestDto: CreateTestRequestBase64Dto): Promise<TestRunResultDto> {
    const imageBuffer = pngOrBadRequest(Buffer.from(createTestRequestDto.imageBase64, 'base64'));
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
  @UseGuards(ApiGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  @UseInterceptors(FileInterceptor('image', { limits: multipartLimits }), FileToBodyInterceptor)
  async postTestRunMultipart(@Body() createTestRequestDto: CreateTestRequestMultipartDto): Promise<TestRunResultDto> {
    const imageBuffer = pngOrBadRequest(createTestRequestDto.image.buffer);
    return this.testRunsService.postTestRun({ createTestRequestDto, imageBuffer });
  }

  private async forEachId(
    action: string,
    ids: string[],
    run: (id: string) => Promise<unknown>
  ): Promise<BulkResultDto> {
    const result: BulkResultDto = { succeeded: [], failed: [] };
    for (const id of ids) {
      try {
        await run(id);
        result.succeeded.push(id);
      } catch (error) {
        if (!(error instanceof HttpException || isPrismaError(error, 'P2025'))) throw error;
        this.logger.warn(`Cannot ${action} TestRun ${id}: ${error.message}`);
        result.failed.push({ id, message: error.message });
      }
    }
    return result;
  }
}
