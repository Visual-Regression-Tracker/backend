import {
  Controller,
  UseGuards,
  Post,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiSecurity } from '@nestjs/swagger';
import { TestService } from './test.service';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { ApiGuard } from '../auth/guards/api.guard';
import { TestRunResultDto } from './dto/testRunResult.dto';

@ApiTags('test')
@Controller('test')
export class TestController {
  constructor(private testService: TestService) { }

  @Post()
  @ApiSecurity('api_key')
  @ApiOkResponse({ type: TestRunResultDto })
  @UseGuards(ApiGuard)
  postTestRun(@Body() createTestRequestDto: CreateTestRequestDto): Promise<TestRunResultDto> {
    return this.testService.postTestRun(createTestRequestDto);
  }
}
