import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { BuildResultDto } from './dto/build-result.dto';
import { StatisticsQueryDto } from './dto/statistics-query.dto';
import { StatisticsService } from './statistics.service';

@ApiTags('statistics')
@Controller('statistics')
export class StatisticsController {
  constructor(private statisticsService: StatisticsService) {}

  @Get('results')
  @ApiOkResponse({ type: BuildResultDto, isArray: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getResults(@Query() { projectId, branchName }: StatisticsQueryDto): Promise<BuildResultDto[]> {
    return this.statisticsService.getResults(projectId, branchName);
  }
}
