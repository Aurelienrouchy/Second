/**
 * Blocage entre deux personnes — lecture serveur unique.
 *
 * Le blocage est stocké sous DEUX formes par `services/moderationService.ts` :
 * `blockedUserIds` (liste plate d'UID, forme canonique lue par
 * `firestore.rules`) et `blockedUsers` (tableau d'objets `{ userId, userName,
 * blockedAt }`, pour l'interface). Ce module lit les DEUX, et tolère une forme
 * plate sur `blockedUsers` au cas où le modèle serait un jour migré.
 *
 * Il existait jusqu'ici une copie privée de cette logique dans
 * `triggers/messages.ts`, tandis que `callable/chatSystemMessage.ts` et
 * `triggers/messages.ts#sendOfferStatusNotification` n'en avaient aucune. Un
 * même concept lu de plusieurs façons — ou pas du tout — produit exactement
 * l'écart qui laisse passer un message chez quelqu'un qui a bloqué.
 *
 * Le blocage est SYMÉTRIQUE : si l'une des deux personnes a bloqué l'autre, la
 * paire est bloquée. C'est la sémantique de `neitherBlocks` dans
 * `firestore.rules`, et celle que le produit promet (« Cette personne ne pourra
 * plus vous contacter »).
 */
import { db } from '../config/firebase';

export function userBlocks(
  data: FirebaseFirestore.DocumentData | null | undefined,
  target: string
): boolean {
  const flat = (data?.blockedUserIds || []) as string[];
  if (Array.isArray(flat) && flat.includes(target)) return true;

  const legacy = (data?.blockedUsers || []) as Array<{ userId?: string } | string>;
  return (
    Array.isArray(legacy) &&
    legacy.some((u) => (typeof u === 'string' ? u === target : u?.userId === target))
  );
}

/** Vrai si l'un des deux a bloqué l'autre. */
export async function areUsersBlocked(
  userId1: string,
  userId2: string
): Promise<boolean> {
  if (!userId1 || !userId2 || userId1 === userId2) return false;

  const [snap1, snap2] = await Promise.all([
    db.collection('users').doc(userId1).get(),
    db.collection('users').doc(userId2).get(),
  ]);

  return userBlocks(snap1.data(), userId2) || userBlocks(snap2.data(), userId1);
}
