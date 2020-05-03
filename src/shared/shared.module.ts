import { Global, Module } from '@nestjs/common';
import { StaticService } from './static/static.service';

@Global()
@Module({
    providers: [StaticService],
    exports: [StaticService],
    imports: [],
    controllers: [],
})
export class SharedModule {}