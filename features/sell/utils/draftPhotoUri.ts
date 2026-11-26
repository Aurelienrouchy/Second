interface DraftPhotoLocation {
  uri: string;
  documentDirectory: string | null;
  cacheDirectory: string;
  ownerUid: string;
  draftId: string;
}

/** Rebase an iOS container move, never an account/project/draft migration. */
export function resolveDraftPhotoUri({uri, documentDirectory, cacheDirectory, ownerUid, draftId}: DraftPhotoLocation): string {
  if (!documentDirectory) return uri;
  const ownedDirectory = `${documentDirectory}${cacheDirectory}/${encodeURIComponent(ownerUid)}/`;
  if (uri.startsWith(ownedDirectory)) {
    const filename = uri.slice(ownedDirectory.length);
    if (!filename || /[/\\?#]/.test(filename) || filename.includes('%') || filename === '.' || filename === '..') {
      throw new Error('Cette photo ne correspond pas au cache du brouillon.');
    }
    return uri;
  }
  // iOS preserves Documents across an update but may move its container UUID.
  // Require the same simulator/device sandbox prefix, then the exact current
  // environment, owner and draft filename. Never read the old container.
  const current = /^(file:\/\/.+\/Containers\/Data\/Application\/)[0-9a-f-]{36}(\/Documents\/)$/i.exec(documentDirectory);
  if (current && uri.startsWith(current[1])) {
    const tail = uri.slice(current[1].length);
    const moved = /^([0-9a-f-]{36})\/Documents\/(.+)$/i.exec(tail);
    const expected = `${cacheDirectory}/${encodeURIComponent(ownerUid)}/`;
    if (moved?.[2].startsWith(expected) && /^[A-Za-z0-9_-]{1,180}$/.test(draftId)) {
      const filename = moved[2].slice(expected.length);
      const suffix = filename.slice(draftId.length + 1);
      if (filename.startsWith(`${draftId}_`) && /^\d+_\d+_[A-Za-z0-9]+\.(?:jpe?g|png|heic|heif|webp)$/i.test(suffix)) {
        return `${ownedDirectory}${filename}`;
      }
    }
  }
  let decoded = uri;
  try { decoded = decodeURIComponent(uri); } catch { /* An invalid cache URI is refused below. */ }
  if (/\/draft_images(?:\/|%2f)/i.test(decoded)) {
    throw new Error('Cette photo ne correspond pas au cache du brouillon.');
  }
  return uri;
}
