import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config/config.service';
import { StaticService } from './static/static.service';

@Global()
@Module({
    providers: [ConfigService, StaticService],
    exports: [ConfigService, StaticService],
    imports: [],
    controllers: [],
})
export class SharedModule {}