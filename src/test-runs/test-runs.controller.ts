import { Controller, Delete, UseGuards, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/auth.guard';
import { TestRun } from '@prisma/client';
import { TestRunsService } from './test-runs.service';

@ApiTags('test-runs')
@Controller('test-runs')
export class TestRunsController {
    constructor(private testRunsService: TestRunsService) { }

    @Delete('/:id')
    @ApiParam({ name: 'id', required: true })
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    deleteTestRun(@Param('id', new ParseUUIDPipe()) id: string): Promise<TestRun> {
        return this.testRunsService.delete(id);
    }
}
