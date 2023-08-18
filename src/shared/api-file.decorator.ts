import { ApiPropertyOptions, ApiProperty } from '@nestjs/swagger';

export const ApiFile =
  (options?: ApiPropertyOptions): PropertyDecorator =>
  (target: any, propertyKey: string | symbol) => {
    if (options?.isArray) {
      ApiProperty({
        type: 'array',
        isArray: true,
        items: {
          type: 'file',
          properties: {
            [propertyKey]: {
              type: 'string',
              format: 'binary',
            },
          },
        },
      })(target, propertyKey);
    } else {
      ApiProperty({
        type: 'file',
        properties: {
          [propertyKey]: {
            type: 'string',
            format: 'binary',
          },
        },
      })(target, propertyKey);
    }
  };
