export function fittedImageSize(width: number, height: number, imageWidth: number, imageHeight: number) {
  'worklet';
  if (imageWidth <= 0 || imageHeight <= 0) return { width, height };
  const ratio = Math.min(width / imageWidth, height / imageHeight);
  return { width: imageWidth * ratio, height: imageHeight * ratio };
}

export function clampImageTranslation(offset: number, imageExtent: number, viewportExtent: number, scale: number) {
  'worklet';
  const bound = Math.max(0, (imageExtent * scale - viewportExtent) / 2);
  return Math.max(-bound, Math.min(bound, offset));
}
