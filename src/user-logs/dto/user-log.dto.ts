import { ApiProperty } from '@nestjs/swagger';

export class UserLogDto {

    @ApiProperty()
    readonly id: string;

    @ApiProperty()
    readonly user: string;

    @ApiProperty()
    readonly timestamp: Date;

    @ApiProperty()
    readonly eventType: string;

    @ApiProperty()
    readonly description: string;

    constructor(elasticObject: any) {
        this.id = elasticObject._id;
        this.eventType = elasticObject._source.vrtEventType;
        this.user = elasticObject._source.vrtUser;
        this.description = elasticObject._source.vrtMessage;
        this.timestamp = new Date(elasticObject.sort[0]);
    }

}
