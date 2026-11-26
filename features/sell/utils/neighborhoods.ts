import type { MeetupNeighborhood } from '@/types';

/** Quartiers de rencontre qu'un article peut porter — le plafond du serveur. */
export const MAX_MEETUP_NEIGHBORHOODS = 10;

/**
 * Ajoute ou retire `neighborhood`. Au plafond, un ajout laisse la liste telle
 * quelle et `capped` le signale : le serveur refuse une onzième entrée, et la
 * troncature silencieuse qu'il pratiquait auparavant perdait le surplus.
 */
export function toggleNeighborhood(
  list: MeetupNeighborhood[],
  neighborhood: MeetupNeighborhood,
): { next: MeetupNeighborhood[]; capped: boolean } {
  if (list.some((n) => n.id === neighborhood.id)) {
    return { next: list.filter((n) => n.id !== neighborhood.id), capped: false };
  }
  if (list.length >= MAX_MEETUP_NEIGHBORHOODS) {
    return { next: list, capped: true };
  }
  return { next: [...list, neighborhood], capped: false };
}
