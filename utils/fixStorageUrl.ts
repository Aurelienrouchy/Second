/**
 * Centralised Firebase Storage URL fixer.
 *
 * Some URLs were stored with un-encoded paths and Firebase Storage
 * answers 400 on those. This util normalises them so callers don't have
 * to. Used to be duplicated across articlesService, aiService,
 * ProductCard, and PriceDropsSection — single source of truth now.
 *
 * Pure function, deterministic — safe to memoise at any level.
 */
import { resolveFirebaseEnvironment } from '@/config/firebaseEnvironment';

/** REST uploads must use the same endpoint policy as the Firebase SDK. */
export function storageApiOrigin(): string {
  const environment = resolveFirebaseEnvironment({
    test: process.env.NODE_ENV === 'test',
    useEmulators: process.env.EXPO_PUBLIC_FIREBASE_EMULATORS,
    emulatorHost: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST,
  });
  return environment.useEmulators
    ? `http://${environment.emulatorHost}:9199`
    : 'https://firebasestorage.googleapis.com';
}

export function isStorageUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://firebasestorage.googleapis.com'
      || (storageApiOrigin().startsWith('http:') && parsed.origin === storageApiOrigin());
  } catch {
    return false;
  }
}

export function fixStorageUrl(url: string): string {
  if (!url || !isStorageUrl(url)) return url;

  try {
    const pathMatch = url.match(/\/o\/([^?]+)/);
    if (!pathMatch) return url;

    const storagePath = pathMatch[1];

    // Already encoded
    if (storagePath.includes('%2F')) return url;

    const encodedPath = storagePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('%2F');

    return url.replace(`/o/${storagePath}`, `/o/${encodedPath}`);
  } catch {
    return url;
  }
}
