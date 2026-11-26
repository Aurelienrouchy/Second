import { Image } from 'react-native';

/**
 * Pixel size of a local image, or `null` when it cannot be read in time.
 * A reading that never answers must not block an upload: it gives up after
 * `timeoutMs` and the caller falls back to a width-only resize.
 */
export function getImageSize(
  uri: string,
  timeoutMs = 1500,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const done = (size: { width: number; height: number } | null) => {
      clearTimeout(timer);
      resolve(size);
    };
    try {
      Image.getSize(
        uri,
        (width, height) => done({ width, height }),
        () => done(null),
      );
    } catch {
      done(null);
    }
  });
}
