// a cast, not instanceof: fetch errors come from another realm under Jest
export const messageOf = (error: unknown): string => {
  const message = (error as Error)?.message ?? String(error);
  const cause = (error as Error | undefined)?.cause;
  return cause == null ? message : `${message} (cause: ${messageOf(cause)})`;
};

export function httpErrorMessage(exception: Error): string {
  const response = (exception as { getResponse?: () => unknown }).getResponse?.();
  const details = typeof response === 'object' ? (response as { message?: unknown } | null)?.message : undefined;
  return Array.isArray(details) ? details.join(', ') : exception.message;
}
