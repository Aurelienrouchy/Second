/**
 * Présentation de la liste des conversations — logique pure, extraite de
 * `app/(tabs)/messages.tsx`.
 *
 * Cette route fait 700 lignes et portait ces trois décisions en ligne, sans
 * aucun test : le classement en onglets, le choix de l'onglet par défaut et la
 * datation du dernier message. La dernière était fausse une partie de la
 * journée. Les extraire les rend vérifiables sans monter tout Expo Router.
 */
import type { Chat } from '@/types';

export type ConversationType = 'achats' | 'ventes' | 'autres';

/** Ordre d'affichage des onglets, et ordre de priorité pour l'onglet par défaut. */
export const CONVERSATION_TABS = ['ventes', 'achats', 'autres'] as const;

/**
 * À quel onglet appartient une conversation.
 *
 * Une conversation ouverte depuis un profil ou une fiche de swap n'a pas de
 * `sellerId` (`createOrGetChat` ne le pose que pour les fils liés à un article) :
 * elle n'est donc ni une vente ni un achat.
 */
export function conversationTypeOf(chat: Chat, userId?: string | null): ConversationType {
  if (!chat.sellerId || !userId) return 'autres';
  return chat.sellerId === userId ? 'ventes' : 'achats';
}

/** Premier onglet non vide, dans l'ordre d'affichage. `ventes` à défaut. */
export function firstNonEmptyTab(chats: Chat[], userId?: string | null): ConversationType {
  return (
    CONVERSATION_TABS.find((tab) =>
      chats.some((c) => conversationTypeOf(c, userId) === tab),
    ) ?? 'ventes'
  );
}

/**
 * Datation du dernier message, en jours de CALENDRIER.
 *
 * Le calcul se faisait sur des tranches de 24 h GLISSANTES : un message d'hier
 * 23 h relu ce matin à 8 h donnait neuf heures d'écart, donc « aujourd'hui », et
 * s'affichait à l'heure — comme s'il venait d'arriver. Symétriquement, un
 * message d'avant-hier 23 h relu à 1 h du matin donnait vingt-six heures, donc
 * « Hier », ce qui était faux. Sur une messagerie où l'on décide de relancer
 * quelqu'un d'après la fraîcheur du dernier échange, l'écart trompe toute la
 * matinée.
 *
 * `now` est injectable pour rendre la fonction testable sans horloge figée.
 */
export function formatConversationTimestamp(
  timestamp: Date | undefined,
  locale: string,
  now: Date = new Date(),
): string {
  if (!timestamp) return '';

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round(
    (startOfDay(now) - startOfDay(timestamp)) / (1000 * 60 * 60 * 24),
  );

  if (days <= 0) {
    return timestamp.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
  if (days === 1) return 'Hier';
  if (days < 7) return timestamp.toLocaleDateString(locale, { weekday: 'short' });
  return timestamp.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
}

/** Pastille de non-lus, plafonnée. */
export function formatBadgeCount(count: number, max = 99): string {
  return count > max ? `${max}+` : String(count);
}

/**
 * Aperçu du dernier message dans la liste.
 *
 * Le type est lu sur `chat.lastMessageType`, mais la distinction entre offre,
 * contre-offre et offre de rencontre se fait sur le TEXTE — c'est le seul
 * endroit du produit qui procède ainsi, et cela mérite d'être visible plutôt
 * qu'enfoui au milieu d'une route de sept cents lignes.
 */
export function getLastMessagePreview(chat: Chat): string {
  if (chat.contentPreviewRestricted) return 'Consultez la conversation';
  if (!chat.lastMessage) return 'Aucun message';

  switch (chat.lastMessageType) {
    case 'image':
      return '[Photo]';
    case 'offer': {
      const msg = chat.lastMessage.toLowerCase();
      if (msg.includes('contre-offre')) return '[Contre-offre]';
      if (msg.includes('meetup') || msg.includes('remise en main')) return '[Offre meetup]';
      return '[Offre]';
    }
    case 'system':
      return `ℹ️ ${chat.lastMessage}`;
    default:
      return chat.lastMessage;
  }
}
