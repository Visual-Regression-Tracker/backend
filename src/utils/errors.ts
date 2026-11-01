// a cast, not instanceof: fetch errors come from another realm under Jest
export const messageOf = (error: unknown): string => (error as Error)?.message ?? String(error);

export function errorMessage(exception: Error): string {
  const response = (exception as { getResponse?: () => unknown }).getResponse?.();
  const details = typeof response === 'object' ? (response as { message?: unknown } | null)?.message : undefined;
  return Array.isArray(details) ? details.join(', ') : exception.message;
}
