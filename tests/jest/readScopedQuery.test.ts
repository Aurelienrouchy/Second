import {CancelledError, QueryCache, QueryClient} from '@tanstack/react-query';
import {readScopedQuery} from '@/utils/readScopedQuery';

const pending = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};

it('keeps a successful read under its original guard', async () => {
  const guard = jest.fn();
  const capture = jest.fn(() => guard);
  await expect(readScopedQuery(new AbortController().signal, capture, async current => {current(); return ['receipt'];})).resolves.toEqual(['receipt']);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(guard).toHaveBeenCalledTimes(3);
});

it.each(['uid', 'generation', 'focus', 'sdk'] as const)('cancels a late read when its original %s changes', async field => {
  const original = {uid: 'member', generation: 1, focus: 1, sdk: {}};
  const current = {...original};
  const response = pending<string>();
  const capture = jest.fn(() => () => {if (Object.keys(original).some(key => current[key as keyof typeof current] !== original[key as keyof typeof original])) throw new Error('Native scope changed');});
  const result = readScopedQuery(new AbortController().signal, capture, () => response.promise);
  if (field === 'uid') current.uid = 'other';
  else if (field === 'sdk') current.sdk = {};
  else current[field]++;
  response.resolve('old receipt');
  await expect(result).rejects.toBeInstanceOf(CancelledError);
  expect(capture).toHaveBeenCalledTimes(1);
});

it('does not read after signal cancellation or unavailable native capture', async () => {
  const signal = new AbortController(); signal.abort();
  const read = jest.fn(async () => 'receipt');
  await expect(readScopedQuery(signal.signal, () => () => undefined, read)).rejects.toBeInstanceOf(CancelledError);
  await expect(readScopedQuery(new AbortController().signal, () => {throw new Error('Focus lost');}, read)).rejects.toBeInstanceOf(CancelledError);
  expect(read).not.toHaveBeenCalled();
});

it('cancels an in-flight read when its query signal is aborted', async () => {
  const signal = new AbortController(), response = pending<string>();
  const result = readScopedQuery(signal.signal, () => () => undefined, () => response.promise);
  signal.abort(); response.reject(new Error('Request interrupted'));
  await expect(result).rejects.toMatchObject({silent: true, revert: true});
});

it('preserves current errors even when they contain a stale-operation code', async () => {
  const error = Object.assign(new Error('Current source is unavailable'), {code: 'client/stale-operation'});
  await expect(readScopedQuery(new AbortController().signal, () => () => undefined, async () => {throw error;})).rejects.toBe(error);
});

it('does not mistake an initial capture error for cancellation when the native guard is current', async () => {
  const failure = new Error('Unexpected capture failure');
  const capture = jest.fn().mockImplementationOnce(() => {throw failure;}).mockReturnValue(() => undefined);
  await expect(readScopedQuery(new AbortController().signal, capture, async () => 'receipt')).rejects.toBe(failure);
});

it('avoids QueryCache errors for obsolete reads while retaining current failures', async () => {
  const onError = jest.fn(), response = pending<string>();
  const client = new QueryClient({queryCache: new QueryCache({onError}), defaultOptions: {queries: {retry: false, gcTime: 0}}});
  let focused = true;
  const result = client.fetchQuery({queryKey: ['old-support-page'], queryFn: ({signal}) => readScopedQuery(signal,
    () => () => {if (!focused) throw new Error('Page closed');}, () => response.promise)});
  focused = false; response.resolve('old page');
  await expect(result).rejects.toBeInstanceOf(CancelledError);
  expect(onError).not.toHaveBeenCalled();
  const error = new Error('Current provider unavailable');
  await expect(client.fetchQuery({queryKey: ['current-support-page'], queryFn: ({signal}) => readScopedQuery(signal,
    () => () => undefined, async () => {throw error;})})).rejects.toBe(error);
  expect(onError).toHaveBeenCalledWith(error, expect.anything());
  client.clear();
});
