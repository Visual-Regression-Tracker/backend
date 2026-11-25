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
  UsePipes,
  ValidationPipe,
  Logger,
  Patch,
  HttpCode,
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
import { Role, TestRun, TestStatus, User } from '@prisma/client';
import { TestRunsService } from './test-runs.service';
import { TestRunResultDto } from './dto/testRunResult.dto';
import { ApiGuard } from '../auth/guards/api.guard';
import { TestRunDto } from './dto/testRun.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CreateTestRequestBase64BaselineBranchDto,
  CreateTestRequestBase64Dto,
} from './dto/create-test-request-base64.dto';
import {
  CreateTestRequestMultipartDto,
  CreateTestRequestMultipartBaselineBranchDto,
} from './dto/create-test-request-multipart.dto';
import { FileToBodyInterceptor } from '../shared/fite-to-body.interceptor';
import { UpdateIgnoreAreasDto } from './dto/update-ignore-area.dto';
import { TestRunsByBuildsDto } from './dto/test-runs-by-builds.dto';
import { UpdateTestRunDto } from './dto/update-test.dto';
import { CurrentUser } from '../shared/current-user.decorator';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../shared/roles.decorator';

@ApiTags('test-runs')
@Controller('test-runs')
export class TestRunsController {
  private readonly logger: Logger = new Logger(TestRunsController.name);

  constructor(private testRunsService: TestRunsService) {}

  @Get()
  @ApiOkResponse({ type: [TestRunDto] })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async get(@Query('buildId', new ParseUUIDPipe()) buildId: string): Promise<TestRunDto[]> {
    return await this.testRunsService.findMany(buildId);
  }

  // The test runs of many builds in one query: a client showing a run of many builds asked
  // for them one build at a time. POST, so a long list of ids never hits a URL length limit.
  @Post('by-builds')
  @HttpCode(200)
  @ApiOkResponse({ type: [TestRunDto] })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async getByBuilds(@Body() body: TestRunsByBuildsDto): Promise<TestRunDto[]> {
    return await this.testRunsService.findManyByBuilds(body.buildIds);
  }

  @Get(':id')
  @ApiOkResponse({ type: TestRunDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async getDetails(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestRunDto> {
    return await this.testRunsService.findOne(id);
  }

  @Post('approve')
  @ApiQuery({ name: 'merge', required: false })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  async approveTestRun(
    @CurrentUser() user: User,
    @Body() ids: string[],
    @Query('merge', new ParseBoolPipe()) merge: boolean
  ): Promise<TestRun[]> {
    this.logger.debug(`Going to approve TestRuns: ${ids}`);
    const testRuns = [];
    for (const id of ids) {
      const testRun = await this.testRunsService.approve(id, merge, false, user.id);
      testRuns.push(testRun);
    }
    console.log(`Updated testRuns: ${JSON.stringify(testRuns)}`);
    return testRuns;
  }

  @Post('approveWithIgnoreAreasFromFeatureBranch')
  @ApiQuery({ name: 'featureBranch', required: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  async approveWithIgnoreAreasFromFeatureBranchTestRun(
    @CurrentUser() user: User,
    @Body() ids: string[],
    @Query('featureBranch') featureBranch: string
  ): Promise<TestRun[]> {
    this.logger.debug(
      `Going to approve with migrating ignoreAreas from feature branch: ${featureBranch}, TestRuns: ${ids}`
    );
    const testRuns = [];
    for (const id of ids) {
      const testRun = await this.testRunsService.approveWithIgnoreAreasFromFeatureBranch(id, featureBranch, user.id);
      testRuns.push(testRun);
    }
    console.log(`Updated testRuns: ${JSON.stringify(testRuns)}`);
    return testRuns;
  }

  @Post('reject')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  async reject(@Body() ids: string[]): Promise<TestRun[]> {
    this.logger.debug(`Going to reject TestRuns: ${ids}`);
    const testRuns = [];
    for (const id of ids) {
      const testRun = await this.testRunsService.setStatus(id, TestStatus.failed);
      testRuns.push(testRun);
    }
    console.log(`Updated testRuns: ${JSON.stringify(testRuns)}`);
    return testRuns;
  }

  @Post('delete')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  async delete(@Body() ids: string[]): Promise<void> {
    this.logger.debug(`Going to delete TestRuns: ${ids}`);
    for (const id of ids) {
      await this.testRunsService.delete(id);
    }
  }

  @Post('ignoreAreas/update')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  async updateIgnoreAreas(@Body() data: UpdateIgnoreAreasDto): Promise<TestRun[]> {
    this.logger.debug(`Going to update IgnoreAreas for TestRuns: ${data.ids}`);
    const testRuns = [];
    for (const id of data.ids) {
      const testRun = await this.testRunsService.updateIgnoreAreas(id, data.ignoreAreas);
      testRuns.push(testRun);
    }
    console.log(`Updated testRuns: ${JSON.stringify(testRuns)}`);
    return testRuns;
  }

  @Post('ignoreAreas/add')
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
  postTestRun(@Body() createTestRequestDto: CreateTestRequestBase64Dto): Promise<TestRunResultDto> {
    const imageBuffer = Buffer.from(createTestRequestDto.imageBase64, 'base64');
    return this.testRunsService.postTestRun({
      createTestRequestDto,
      imageBuffer,
    });
  }

  @Post('/baselineBranch')
  @ApiSecurity('api_key')
  @ApiOkResponse({ type: TestRunResultDto })
  @UseGuards(ApiGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  postTestRunBaselineBranch(
    @Body() createTestRequestDto: CreateTestRequestBase64BaselineBranchDto
  ): Promise<TestRunResultDto> {
    const imageBuffer = Buffer.from(createTestRequestDto.imageBase64, 'base64');
    return this.testRunsService.postTestRunBaselineBranch({
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
  @UseInterceptors(FileInterceptor('image'), FileToBodyInterceptor)
  @UsePipes(new ValidationPipe({ transform: true }))
  postTestRunMultipart(@Body() createTestRequestDto: CreateTestRequestMultipartDto): Promise<TestRunResultDto> {
    const imageBuffer = createTestRequestDto.image.buffer;
    return this.testRunsService.postTestRun({ createTestRequestDto, imageBuffer });
  }

  @Post('/multipartBaselineBranch')
  @ApiSecurity('api_key')
  @ApiBody({ type: CreateTestRequestMultipartBaselineBranchDto })
  @ApiOkResponse({ type: TestRunResultDto })
  @ApiConsumes('multipart/form-data')
  @UseGuards(ApiGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  @UseInterceptors(FileInterceptor('image'), FileToBodyInterceptor)
  @UsePipes(new ValidationPipe({ transform: true }))
  postTestRunMultipartBaselineBranch(
    @Body() createTestRequestDto: CreateTestRequestMultipartBaselineBranchDto
  ): Promise<TestRunResultDto> {
    const imageBuffer = createTestRequestDto.image.buffer;
    return this.testRunsService.postTestRunBaselineBranch({ createTestRequestDto, imageBuffer });
  }
}
