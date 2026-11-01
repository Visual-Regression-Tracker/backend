export interface Debounced {
  (): void;
  cancel(): void;
}

export function debounce(fn: () => void, wait: number, maxWait: number): Debounced {
  let timer: NodeJS.Timeout | undefined;
  let lastCallTime: number | undefined;
  let lastInvokeTime = 0;
  let pending = false;

  const invoke = (time: number) => {
    lastInvokeTime = time;
    pending = false;
    fn();
  };

  const shouldInvoke = (time: number) => {
    if (lastCallTime === undefined) return true;
    const sinceLastCall = time - lastCallTime;
    return sinceLastCall >= wait || time - lastInvokeTime >= maxWait;
  };

  const timerExpired = () => {
    const time = Date.now();
    if (shouldInvoke(time)) {
      timer = undefined;
      if (pending) invoke(time);
      return;
    }
    timer = setTimeout(timerExpired, Math.min(wait - (time - lastCallTime!), maxWait - (time - lastInvokeTime)));
  };

  const debounced = () => {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);
    pending = true;
    lastCallTime = time;
    if (!isInvoking) {
      timer ??= setTimeout(timerExpired, wait);
      return;
    }
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(timerExpired, wait);
    invoke(time);
  };

  debounced.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    lastCallTime = undefined;
    lastInvokeTime = 0;
    pending = false;
  };

  return debounced;
}
