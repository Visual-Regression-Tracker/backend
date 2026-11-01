import { ArgumentMetadata, PipeTransform, ValidationPipe, ValidationPipeOptions } from '@nestjs/common';

const VALIDATION_OPTIONS = Symbol('validationOptions');

export const ValidationOptions =
  (options: ValidationPipeOptions): ClassDecorator =>
  (target) => {
    Reflect.defineMetadata(VALIDATION_OPTIONS, options, target);
  };

export class GlobalValidationPipe implements PipeTransform {
  private readonly defaultPipe = new ValidationPipe({ whitelist: true });
  private readonly pipes = new WeakMap<object, ValidationPipe>();

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipeFor(metadata.metatype).transform(value, metadata);
  }

  private pipeFor(metatype: ArgumentMetadata['metatype']): ValidationPipe {
    const options: ValidationPipeOptions | undefined = metatype && Reflect.getMetadata(VALIDATION_OPTIONS, metatype);
    if (!metatype || !options) {
      return this.defaultPipe;
    }
    let pipe = this.pipes.get(metatype);
    if (!pipe) {
      pipe = new ValidationPipe({ whitelist: true, ...options });
      this.pipes.set(metatype, pipe);
    }
    return pipe;
  }
}
