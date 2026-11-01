// Hides the type from design:paramtypes: a circular import is not initialised there yet and SWC throws
export type WrapperType<T> = T;
