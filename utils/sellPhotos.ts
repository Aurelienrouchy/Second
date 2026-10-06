/** Keep local photos and their uploaded media in the same order. */
export function moveSellPhoto(photos: string[], storageUrls: string[], from: number, to: number) {
  if (from < 0 || to < 0 || from >= photos.length || to >= photos.length) return { photos, storageUrls };
  const move = (items: string[]) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };
  return { photos: move(photos), storageUrls: storageUrls.length === photos.length ? move(storageUrls) : [] };
}
