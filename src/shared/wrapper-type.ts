/**
 * The type of a dependency injected with forwardRef. A plain class type would
 * be emitted into the constructor's design:paramtypes metadata, and with
 * circular imports that class is not initialised yet when the decorator runs:
 * tsc's output reads it as undefined, SWC's live bindings throw. Behind an
 * alias the metadata says Object, and forwardRef hands Nest the real class.
 */
export type WrapperType<T> = T;
