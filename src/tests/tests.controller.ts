import {
  Controller,
  Get,
  UseGuards,
  Param,
  ParseIntPipe,
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
import { TestsService } from './tests.service';
import { Test } from './test.entity';
import { JwtAuthGuard } from 'src/auth/guards/auth.guard';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { ApiGuard } from 'src/auth/guards/api.guard';
import { CreateTestResponseDto } from './dto/create-test-response.dto';

@Controller('tests')
@ApiTags('tests')
export class TestsController {
  constructor(private testsService: TestsService) {}

  @Get(':buildId')
  @ApiParam({ name: 'buildId', required: true })
  @ApiOkResponse({ type: [Test] })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getAll(@Param('buildId', new ParseIntPipe()) buildId: number): Promise<Test[]> {
    return this.testsService.findAll(buildId);
  }

  @Post()
  @ApiOkResponse({ type: CreateTestResponseDto })
  @ApiSecurity('api_key')
  @UseGuards(ApiGuard)
  create(@Body() createTestDto: CreateTestRequestDto): Promise<CreateTestResponseDto> {
    return this.testsService.create(createTestDto);
  }

  @Get('approve/:testId')
  @ApiParam({ name: 'testId', required: true })
  @ApiOkResponse({ type: CreateTestResponseDto })
  @ApiSecurity('api_key')
  @UseGuards(ApiGuard)
  approve(@Param('testId') testId: string): Promise<CreateTestResponseDto> {
    return this.testsService.approve(testId);
  }

  @Get('reject/:testId')
  @ApiParam({ name: 'testId', required: true })
  @ApiOkResponse({ type: CreateTestResponseDto })
  @ApiSecurity('api_key')
  @UseGuards(ApiGuard)
  reject(@Param('testId') testId: string): Promise<CreateTestResponseDto> {
    return this.testsService.reject(testId);
  }
}
