import { debounce } from './debounce';

const setup = () => {
  const fn = jest.fn();
  return { fn, debounced: debounce(fn, 1500, 3000) };
};

describe('debounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('runs the first call at once', () => {
    const { fn, debounced } = setup();
    debounced();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not run again after the wait when it was called once', () => {
    const { fn, debounced } = setup();
    debounced();
    jest.advanceTimersByTime(5000);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs once more 1500ms after the last of the calls that followed the first', () => {
    const { fn, debounced } = setup();

    debounced();
    debounced();
    jest.advanceTimersByTime(1000);
    debounced();
    jest.advanceTimersByTime(1499);
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs a steady stream of calls at least every maxWait', () => {
    const { fn, debounced } = setup();

    debounced();
    for (let elapsed = 0; elapsed < 9000; elapsed += 1000) {
      jest.advanceTimersByTime(1000);
      debounced();
    }

    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('runs at once again when called after a quiet period', () => {
    const { fn, debounced } = setup();

    debounced();
    jest.advanceTimersByTime(1500);
    debounced();

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs at once when maxWait has passed before its timer could fire', () => {
    const { fn, debounced } = setup();

    debounced();
    debounced();
    jest.setSystemTime(Date.now() + 3000);
    debounced();
    expect(fn).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('drops the pending run when cancelled and starts afresh afterwards', () => {
    const { fn, debounced } = setup();

    debounced();
    debounced();
    debounced.cancel();
    jest.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);

    debounced();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
