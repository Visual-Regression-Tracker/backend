import { ApiPropertyOptions, ApiProperty } from '@nestjs/swagger';

export const ApiFile =
  (options?: ApiPropertyOptions): PropertyDecorator =>
  (target: any, propertyKey: string | symbol) => {
    if (options?.isArray) {
      ApiProperty({
        type: 'array',
        isArray: true,
        items: {
          type: 'string',
          format: 'binary',
        },
      })(target, propertyKey);
    } else {
      ApiProperty({
        type: 'string',
        format: 'binary',
      })(target, propertyKey);
    }
  };
