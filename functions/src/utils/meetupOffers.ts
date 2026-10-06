import { createHash } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';

/** A private contention document shared by every chat for this buyer/article. */
export function meetupThreadId(articleId: string, buyerId: string): string {
  return createHash('sha256').update(JSON.stringify([articleId, buyerId])).digest('hex');
}

const CATEGORIES = new Set(['cafe', 'metro', 'library', 'mall', 'park', 'community_center', 'other_public']);

function text(value: unknown, field: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpsError('invalid-argument', `${field} invalide`);
  }
  return value.trim();
}

/** Keep only location fields that the offer UI and transaction actually use. */
export function normalizeMeetupLocation(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpsError('invalid-argument', 'Lieu de rencontre invalide');
  }
  const value = raw as Record<string, unknown>;
  if (value.toArrange === true) {
    return { name: 'À convenir par messagerie', category: 'other_public', toArrange: true,
      neighborhood: { id: 'to-arrange', name: 'À convenir', borough: 'À convenir' } };
  }
  if (!CATEGORIES.has(value.category as string)) throw new HttpsError('invalid-argument', 'Type de lieu invalide');
  const area = value.neighborhood as Record<string, unknown> | undefined;
  const location: Record<string, unknown> = {
    name: text(value.name, 'Nom du lieu'),
    category: value.category,
    neighborhood: { id: text(area?.id, 'Quartier'), name: text(area?.name, 'Quartier'), borough: text(area?.borough, 'Arrondissement') },
  };
  if (value.id != null) location.id = text(value.id, 'Identifiant du lieu');
  if (value.address != null) location.address = text(value.address, 'Adresse', 300);
  if (value.isUserSuggested === true) location.isUserSuggested = true;
  if (value.coordinates != null) {
    const coordinates = value.coordinates as Record<string, unknown>;
    const latitude = coordinates.latitude;
    const longitude = coordinates.longitude;
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      throw new HttpsError('invalid-argument', 'Coordonnées invalides');
    }
    location.coordinates = { latitude, longitude };
  }
  return location;
}

export function meetupLocationsEqual(a: unknown, b: unknown): boolean {
  const comparable = (raw: unknown) => {
    const l = (raw ?? {}) as Record<string, any>; // Legacy stored location documents are schemaless.
    return [l.toArrange === true, l.id ?? null, l.name ?? null, l.category ?? null,
      l.neighborhood?.id ?? null, l.neighborhood?.name ?? null, l.neighborhood?.borough ?? null,
      l.address ?? null, l.coordinates?.latitude ?? null, l.coordinates?.longitude ?? null];
  };
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

export function offerExpired(offer: Record<string, any>, now = Date.now()): boolean { // Firestore offer payload.
  const raw = offer.expiresAt;
  const ms = raw?.toMillis?.() ?? raw?.toDate?.().getTime() ?? (raw ? new Date(raw).getTime() : null);
  return ms != null && Number.isFinite(ms) && ms <= now;
}

export function hasBlockedUser(data: FirebaseFirestore.DocumentData | undefined, uid: string): boolean {
  return (Array.isArray(data?.blockedUserIds) && data.blockedUserIds.includes(uid)) ||
    (Array.isArray(data?.blockedUsers) && data.blockedUsers.some((entry: unknown) =>
      typeof entry === 'string' ? entry === uid : (entry as { userId?: string } | null)?.userId === uid));
}
