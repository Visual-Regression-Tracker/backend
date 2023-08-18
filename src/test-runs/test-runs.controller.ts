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
import { CreateTestRequestBase64Dto } from './dto/create-test-request-base64.dto';
import { CreateTestRequestMultipartDto } from './dto/create-test-request-multipart.dto';
import { FileToBodyInterceptor } from '../shared/fite-to-body.interceptor';
import { UpdateIgnoreAreasDto } from './dto/update-ignore-area.dto';
import { UpdateTestRunDto } from './dto/update-test.dto';
import { CurrentUser } from '../shared/current-user.decorator';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../shared/roles.decorator';

/* eslint-disable @darraghor/nestjs-typed/injectable-should-be-provided */
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
  getDetails(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestRunDto> {
    return this.testRunsService.findOne(id);
  }

  @Post('approve')
  @ApiQuery({ name: 'merge', required: false })
  @ApiOkResponse({ type: undefined })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  async approveTestRun(
    @CurrentUser() user: User,
    @Body() ids: string[],
    @Query('merge', new ParseBoolPipe()) merge: boolean
  ): Promise<void> {
    this.logger.debug(`Going to approve TestRuns: ${ids}`);
    for (const id of ids) {
      await this.testRunsService.approve(id, merge, false, user.id);
    }
  }

  @Post('reject')
  @ApiOkResponse({ type: undefined })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  async reject(@Body() ids: string[]): Promise<void> {
    this.logger.debug(`Going to reject TestRuns: ${ids}`);
    for (const id of ids) {
      await this.testRunsService.setStatus(id, TestStatus.failed);
    }
  }

  @Post('delete')
  @ApiOkResponse({ type: undefined })
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
  @UseGuards(ApiGuard, RoleGuard)
  @Roles(Role.admin, Role.editor)
  @UseInterceptors(FileInterceptor('image'), FileToBodyInterceptor)
  @UsePipes(new ValidationPipe({ transform: true, forbidUnknownValues: true }))
  postTestRunMultipart(@Body() createTestRequestDto: CreateTestRequestMultipartDto): Promise<TestRunResultDto> {
    const imageBuffer = createTestRequestDto.image.buffer;
    return this.testRunsService.postTestRun({ createTestRequestDto, imageBuffer });
  }
}
