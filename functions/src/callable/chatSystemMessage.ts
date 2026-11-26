/**
 * Messages « système » d'une conversation — écriture SERVEUR uniquement.
 *
 * Les règles Firestore autorisaient tout participant d'une conversation à créer
 * un message `senderId: 'system'` au CONTENU LIBRE, indiscernable de celui écrit
 * par une Cloud Function. Sur un échange comptant sans séquestre, la parole de
 * la plateforme est le seul repère de confiance de l'acheteur : une partie
 * pouvait mettre en scène une « confirmation » de la plateforme.
 *
 * Le client ne choisit donc plus le texte, seulement un `kind` parmi un
 * catalogue fermé rendu ici. Ces messages restent des déclarations de membre,
 * avec leur auteur natif ; ils ne prouvent aucun événement de paiement/stock
 * ni une décision ou un examen de la plateforme.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

import { db, FieldValue } from '../config/firebase';
import { userBlocks } from '../utils/blocking';
import { checkRateLimit, resolveCallerKey } from '../utils/rateLimit';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';

const APP_LOCALE = 'fr-CA';

/** Types de messages système que le client peut demander. */
export const SYSTEM_MESSAGE_KINDS = [
  'offer_accepted',
  'offer_rejected',
  'counter_price',
  'counter_location',
  'counter_time',
  'meetup_confirmed',
  'no_show_reported',
  'meetup_completed',
  'meetup_cancelled',
] as const;

type SystemMessageKind = (typeof SYSTEM_MESSAGE_KINDS)[number];

/** Montant affichable : nombre fini positif, arrondi au cent. */
function money(raw: unknown): string | null {
  if (typeof raw !== 'number' || !isFinite(raw) || raw < 0) return null;
  return String(Math.round(raw * 100) / 100);
}

/** Texte libre borné, pour un nom de lieu choisi dans le catalogue client. */
function label(raw: unknown, max = 120): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return null;
  return trimmed.substring(0, max);
}

function parseDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateTime(d: Date): string {
  const date = d.toLocaleDateString(APP_LOCALE);
  const time = d.toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit' });
  return `${date} à ${time}`;
}

/**
 * Rend le contenu du message à partir du `kind` et de paramètres validés.
 * Renvoie `null` si les paramètres ne permettent pas un rendu fidèle — le
 * serveur refuse alors plutôt que d'écrire un message dégradé.
 */
export function renderSystemMessage(
  kind: SystemMessageKind,
  params: Record<string, unknown>
): string | null {
  switch (kind) {
    case 'offer_accepted': {
      const amount = money(params.amount);
      return amount === null ? null : `Un participant déclare avoir accepté l’offre de ${amount} $`;
    }
    case 'offer_rejected': {
      const amount = money(params.amount);
      return amount === null ? null : `Un participant déclare avoir refusé l’offre de ${amount} $`;
    }
    case 'counter_price': {
      const from = money(params.fromAmount);
      const to = money(params.toAmount);
      return from === null || to === null ? null : `Contre-offre: ${from} $ → ${to} $`;
    }
    case 'counter_location': {
      const name = label(params.locationName);
      return name === null ? null : `Nouveau lieu proposé: ${name}`;
    }
    case 'counter_time': {
      const when = parseDate(params.dateTime);
      return when === null ? null : `Nouvel horaire proposé: ${formatDateTime(when)}`;
    }
    case 'meetup_confirmed': {
      const name = label(params.locationName);
      if (name === null) return null;
      const when = parseDate(params.dateTime);
      const dateTimeInfo = when ? `le ${formatDateTime(when)}` : 'à une date à convenir';
      return `Rendez-vous confirmé par un participant :\n${name}\n${dateTimeInfo}`;
    }
    case 'no_show_reported':
      return 'Un participant signale une absence au rendez-vous.';
    case 'meetup_completed':
      return 'Un participant déclare la remise et le paiement terminés.';
    case 'meetup_cancelled':
      return 'Un participant déclare la rencontre annulée. Consultez la commande pour connaître l’état de l’article.';
    default:
      return null;
  }
}

export const postChatSystemMessage = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'postChatSystemMessage',
      maxCallsAuthenticated: 60,
      maxCallsUnauthenticated: 0,
      windowMs: 60 * 1000,
    });

    const { chatId, kind, params } = request.data ?? {};
    if (typeof chatId !== 'string' || chatId.length === 0) {
      throw new HttpsError('invalid-argument', 'chatId is required');
    }
    if (
      typeof kind !== 'string' ||
      !(SYSTEM_MESSAGE_KINDS as readonly string[]).includes(kind)
    ) {
      throw new HttpsError('invalid-argument', 'Type de message système inconnu');
    }

    const content = renderSystemMessage(
      kind as SystemMessageKind,
      (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
    );
    if (content === null) {
      throw new HttpsError('invalid-argument', 'Paramètres de message système invalides');
    }

    const uid = request.auth.uid;
    const ref = db.collection('messages').doc();
    await db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const chatSnap = await tx.get(db.collection('chats').doc(chatId));
      if (!chatSnap.exists) throw new HttpsError('not-found', 'Conversation introuvable');
      const participants = chatSnap.data()?.participants;
      if (!Array.isArray(participants) || !participants.includes(uid) ||
          !participants.every(p => typeof p === 'string' && p.length > 0 && !p.includes('/'))) {
        throw new HttpsError('permission-denied', 'Vous ne participez pas à cette conversation');
      }
      // The same transaction reads membership and both forms of symmetric
      // blocking. A concurrent removal/block forces a retry before the message.
      const own = await tx.get(db.collection('users').doc(uid));
      const others = [...new Set(participants.filter(p => p !== uid))] as string[];
      for (const other of others) {
        const currentOther = await tx.get(db.collection('users').doc(other));
        if (userBlocks(own.data(), other) || userBlocks(currentOther.data(), uid)) {
          throw new HttpsError('permission-denied', 'Cette conversation est bloquée.');
        }
      }
      tx.create(ref, {
        chatId,
        senderId: 'system',
        receiverId: 'system',
        type: 'system',
        origin: 'participant_declaration',
        declaredBy: uid,
        content,
        participants,
        timestamp: FieldValue.serverTimestamp(),
        status: 'sent',
        isRead: true,
      });
    });

    logger.info('[postChatSystemMessage] System message posted', { chatId, kind });
    return { success: true, messageId: ref.id };
  })
);
