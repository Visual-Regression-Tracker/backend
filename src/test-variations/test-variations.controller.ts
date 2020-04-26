import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TestVariationsService } from './test-variations.service';

@ApiTags('test-variations')
@Controller('test-variations')
export class TestVariationsController {
  constructor(private testVariations: TestVariationsService) {}
}
