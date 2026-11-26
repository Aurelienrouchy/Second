export interface PhotoGridItem { id: string; uri: string; fallbackUri?: string }

/** Provisional UI order; the committed photos and upload URLs stay untouched. */
export function movePhotoGridOrder(ids: readonly string[], from: number, to: number): string[] {
  'worklet';
  const next = [...ids];
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return next;
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

export function photoGridTarget(x: number, y: number, stride: number, columns: number, count: number): number {
  'worklet';
  const column = Math.max(0, Math.min(columns - 1, Math.round(x / stride)));
  const row = Math.max(0, Math.round(y / stride));
  const target = row * columns + column;
  return target < count ? target : -1;
}

/** Gaps, unused slots and the full remove touch target never initiate a drag. */
export function photoGridTouchIndex(x: number, y: number, size: number, gap: number, columns: number, count: number, removeSize: number): number {
  'worklet';
  if (x < 0 || y < 0 || size <= 0) return -1;
  const stride = size + gap;
  const column = Math.floor(x / stride), row = Math.floor(y / stride);
  const localX = x - column * stride, localY = y - row * stride;
  const index = row * columns + column;
  if (column >= columns || index >= count || localX >= size || localY >= size || (localX >= size - removeSize && localY <= removeSize)) return -1;
  return index;
}
