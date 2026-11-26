/**
 * OfferBubble helpers — status colors/icons/labels + time formatting.
 */

import type { Ionicons } from '@expo/vector-icons';

import { APP_LOCALE } from '@/constants/locale';
import { colors } from '@/constants/theme';
import type { OfferStatus } from '@/types';

export const formatTime = (date: Date) => {
  return date.toLocaleTimeString(APP_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getTimeUntilExpiry = (
  expiresAt?: Date | string | null,
  status?: OfferStatus,
): string | null => {
  if (!expiresAt || status !== 'pending') return null;

  const now = new Date();
  const expiry = expiresAt instanceof Date
    ? expiresAt
    : typeof expiresAt === 'object' && expiresAt !== null && 'toDate' in expiresAt
      ? (expiresAt as unknown as { toDate: () => Date }).toDate()
      : new Date(expiresAt);
  const diffMs = expiry.getTime() - now.getTime();

  if (diffMs <= 0) return 'Expirée';

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `Expire dans ${hours}h ${minutes}min`;
  }
  return `Expire dans ${minutes}min`;
};

export const getStatusColor = (s: OfferStatus) => {
  switch (s) {
    case 'accepted':
    case 'completed':
      return colors.success;
    case 'rejected':
    case 'expired':
      return colors.danger;
    case 'counter_price':
    case 'counter_location':
    case 'counter_time':
      return colors.sand;
    default:
      return colors.primary;
  }
};

export const getStatusIcon = (s: OfferStatus): keyof typeof Ionicons.glyphMap => {
  switch (s) {
    case 'accepted':
      return 'checkmark-circle';
    case 'completed':
      return 'checkmark-done-circle';
    case 'rejected':
      return 'close-circle';
    case 'expired':
      return 'time-outline';
    case 'counter_price':
      return 'swap-horizontal';
    case 'counter_location':
      return 'location';
    case 'counter_time':
      return 'calendar';
    default:
      return 'cash';
  }
};

export const getStatusText = (s: OfferStatus) => {
  switch (s) {
    case 'accepted':
      return 'Acceptée';
    case 'completed':
      return 'Terminée';
    case 'rejected':
      return 'Refusée';
    case 'expired':
      return 'Expirée';
    case 'counter_price':
      return 'Contre-offre prix';
    case 'counter_location':
      return 'Autre lieu proposé';
    case 'counter_time':
      return 'Autre horaire proposé';
    default:
      return 'En attente';
  }
};

export const getStatusIconBackground = (status: OfferStatus): string => {
  switch (status) {
    case 'pending':
      return colors.primaryLight;
    case 'accepted':
    case 'completed':
      return colors.successLight;
    case 'rejected':
    case 'expired':
      return colors.dangerLight;
    case 'counter_price':
    case 'counter_location':
    case 'counter_time':
      return colors.sandLight;
    default:
      return colors.primaryLight;
  }
};

export const getStatusBgColor = (status: OfferStatus): string => {
  switch (status) {
    case 'pending':
      return colors.primaryLight;
    case 'accepted':
    case 'completed':
      return colors.successLight;
    case 'rejected':
    case 'expired':
      return colors.dangerLight;
    case 'counter_price':
    case 'counter_location':
    case 'counter_time':
      return colors.sandLight;
    default:
      return colors.primaryLight;
  }
};

/**
 * Ce que chaque partie peut faire sur une rencontre, à un instant donné.
 *
 * Cette décision vivait dans `OfferBubble.tsx` sous la forme de cinq booléens
 * calculés en ligne au milieu d'un composant de 1100 lignes, sans une seule
 * assertion de test. Elle est extraite ici pour être vérifiable — et parce
 * qu'un défaut s'y cachait : « Signaler une absence » n'était rendu qu'à
 * l'intérieur de `MeetupActions`, donc uniquement quand un bouton « Confirmer »
 * était affiché. À l'étape « rencontre en attente », seul le VENDEUR en a un.
 * L'acheteur n'avait donc aucun recours tant que le vendeur n'avait pas
 * confirmé, alors que le serveur (`reportMeetupNoShow`) accepte les deux
 * parties sur les DEUX statuts et que les deux documents métier le promettent.
 */
export interface MeetupActionState {
  /** Le vendeur confirme le rendez-vous : meetup_pending → meetup_confirmed. */
  canConfirm: boolean;
  /** L'une ou l'autre partie clôture après la rencontre. */
  canComplete: boolean;
  /** Signaler une absence — les deux parties, aux deux étapes. */
  canReportNoShow: boolean;
  /** Sortie à l'amiable, sans accusation — les deux parties. */
  canCancel: boolean;
  /** Donner sa version après avoir été visé par un signalement. */
  canContest: boolean;
}

export interface MeetupActionInput {
  isBuyer: boolean;
  isSeller: boolean;
  offerStatus: OfferStatus;
  isMeetupOffer: boolean;
  currentUserId?: string;
  meetup?: {
    confirmedAt?: unknown;
    completedAt?: unknown;
    noShow?: { reportedBy?: string } | null;
  } | null;
}

export function getMeetupActionState({
  isBuyer,
  isSeller,
  offerStatus,
  isMeetupOffer,
  currentUserId,
  meetup,
}: MeetupActionInput): MeetupActionState {
  const isParty = isBuyer || isSeller;
  // Un signalement d'absence gèle la transaction : les boutons du cycle normal
  // doivent disparaître, le serveur refuserait l'appel.
  const closed = !!meetup?.noShow;
  const live =
    isParty &&
    isMeetupOffer &&
    offerStatus === 'accepted' &&
    !!meetup &&
    !closed &&
    !meetup.completedAt;

  return {
    canConfirm: live && isSeller && !meetup?.confirmedAt,
    canComplete: live && !!meetup?.confirmedAt,
    canReportNoShow: live,
    canCancel: live,
    canContest:
      isMeetupOffer &&
      !!meetup?.noShow &&
      !!currentUserId &&
      meetup.noShow.reportedBy !== currentUserId &&
      !meetup.completedAt,
  };
}


/**
 * Code d'erreur à faible cardinalité pour l'analytique — jamais le message FR
 * brut (règle de cardinalité et de données personnelles du dépôt).
 */
export function errCode(error: unknown): string | undefined {
  const code = (error as { code?: string })?.code;
  return typeof code === 'string' ? code : undefined;
}
