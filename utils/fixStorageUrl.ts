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
export function isStorageUrl(url: string): boolean {
  return !!url && url.includes('firebasestorage.googleapis.com');
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
