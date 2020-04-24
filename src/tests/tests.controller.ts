import {
  Controller,
  Get,
  UseGuards,
  Param,
  ParseIntPipe,
  Post,
  Body,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiParam,
  ApiOkResponse,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { TestsService } from './tests.service';
import { JwtAuthGuard } from 'src/auth/guards/auth.guard';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { ApiGuard } from 'src/auth/guards/api.guard';
import { CreateTestResponseDto } from './dto/create-test-response.dto';
import { TestDto } from './dto/test.dto';

@Controller('tests')
@ApiTags('tests')
export class TestsController {
  constructor(private testsService: TestsService) {}

  @Get(':id')
  @ApiParam({ name: 'id', required: true })
  @ApiOkResponse({ type: TestDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getDetails(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestDto> {
    return this.testsService.getDetails(id);
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
  @ApiOkResponse({ type: TestDto })
  @ApiSecurity('api_key')
  @UseGuards(JwtAuthGuard)
  approve(@Param('testId', new ParseUUIDPipe()) testId: string): Promise<TestDto> {
    return this.testsService.approve(testId);
  }

  @Get('reject/:testId')
  @ApiParam({ name: 'testId', required: true })
  @ApiOkResponse({ type: TestDto })
  @ApiSecurity('api_key')
  @UseGuards(JwtAuthGuard)
  reject(@Param('testId', new ParseUUIDPipe()) testId: string): Promise<TestDto> {
    return this.testsService.reject(testId);
  }
}
