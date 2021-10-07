import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { Logger } from '@nestjs/common';
import { UserLogDto } from './dto/user-log.dto';
import { VRTUserLogService } from 'src/shared/user-logs/user-log.service';

@Controller('logs')
export class UserLogsController {
    private readonly logger: Logger = new Logger(UserLogsController.name);

    constructor(private logService: VRTUserLogService) { }

    @Get()
    @ApiOkResponse({ type: [UserLogDto] })
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    async logList() : Promise<UserLogDto[]> {
        let allLogsResponse = await this.logService.getLogs(100);
        if (allLogsResponse) {
            let allLogs: UserLogDto[] = allLogsResponse.hits.hits;
            //Sometimes elastic returns empty object, filter that out.
            let allLogsDto = allLogs.map(each => new UserLogDto(each)).filter(e => e.eventType);
            return allLogsDto;
        } else {
            //Case when elastic server is not configured.
            let elasticObject = { "_id": "id", "_source": { "vrtEventType": "", "vrtUser": "", "vrtMessage": "No logs found. Elastic server is required. Setup documentation in Github VRT page." }, "sort": [new Date().getTime()] };
            const emptyLogToReturn: UserLogDto = new UserLogDto(elasticObject);
            return [emptyLogToReturn];
        }
    }

}
