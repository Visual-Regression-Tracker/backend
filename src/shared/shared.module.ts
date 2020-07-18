import { Global, Module } from '@nestjs/common';
import { StaticService } from './static/static.service';
import { EventsGateway } from '../shared/events/events.gateway';

@Global()
@Module({
    providers: [StaticService, EventsGateway],
    exports: [StaticService, EventsGateway],
    imports: [],
    controllers: [],
})
export class SharedModule {}