/**
 * OfferBubble helpers — status colors/icons/labels + time formatting.
 */

import type { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/theme';
import type { OfferStatus } from '@/types';

export const formatTime = (date: Date) => {
  return date.toLocaleTimeString('fr-FR', {
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
  const expiry = new Date(expiresAt);
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
      return 'rgba(212, 196, 160, 0.12)';
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
      return 'rgba(212, 196, 160, 0.12)';
    default:
      return colors.primaryLight;
  }
};
