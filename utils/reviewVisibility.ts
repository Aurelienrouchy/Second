/** Match the public server projection; hidden/unknown markers never count. */
export function isPublicReviewVisible(value: {note?: unknown; text?: unknown; contentModeration?: unknown}): boolean {
  if (Object.prototype.hasOwnProperty.call(value, 'contentModeration')) {
    const marker = value.contentModeration;
    if (!marker || typeof marker !== 'object' || !('protocol' in marker) || marker.protocol !== 'content_visibility_v1' || !('state' in marker) || marker.state !== 'visible') return false;
  }
  return typeof value.note === 'number' && Number.isInteger(value.note) && value.note >= 1 && value.note <= 5 && typeof value.text === 'string';
}
