/**
 * Resize that bounds the LONGEST side and never enlarges.
 *
 * `resize: { width }` alone bounded the width only: a portrait photo came out
 * taller than the bound. And a photo smaller than the bound was ENLARGED up
 * to it — heavier to upload, without a single pixel of information more.
 */
export type ResizeAction = { resize: { width: number } | { height: number } };

export function boundedResize(width: number, height: number, maxDimension: number): ResizeAction[] {
  // Unknown size: the former behaviour, bounded by width.
  if (!(width > 0) || !(height > 0)) return [{ resize: { width: maxDimension } }];
  if (Math.max(width, height) <= maxDimension) return [];
  return width >= height
    ? [{ resize: { width: maxDimension } }]
    : [{ resize: { height: maxDimension } }];
}
