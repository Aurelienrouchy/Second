import {CancelledError} from '@tanstack/react-query';

/** Cancel only a read whose original native scope or query signal was lost. */
export async function readScopedQuery<T>(
  signal: AbortSignal,
  captureGuard: () => () => void,
  read: (assertCurrent: () => void) => Promise<T>,
): Promise<T> {
  let assertCurrent: (() => void) | null = null;
  const cancelled = () => new CancelledError({silent: true, revert: true});
  try {
    if (signal.aborted) throw cancelled();
    assertCurrent = captureGuard();
    const current = () => {if (signal.aborted) throw cancelled(); assertCurrent!();};
    current();
    const result = await read(current);
    current();
    return result;
  } catch (error) {
    if (signal.aborted) throw cancelled();
    try {(assertCurrent ?? captureGuard())();} catch {throw cancelled();}
    throw error;
  }
}
