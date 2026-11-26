import type { Article, MeetupNeighborhood, MeetupSpot } from '@/types';

/**
 * Lieux proposés à l'acheteur. La vente et l'édition enregistrent des
 * QUARTIERS (`neighborhoods`, `neighborhood` pour les anciens articles) ;
 * aucun code n'écrit `preferredMeetupSpots`. L'écran ne lisait que ce dernier :
 * les quartiers choisis par le vendeur n'atteignaient jamais l'acheteur.
 */
export function meetupSpotsForArticle(
  article: Pick<Article, 'preferredMeetupSpots' | 'neighborhoods' | 'neighborhood'>,
): MeetupSpot[] {
  if (article.preferredMeetupSpots?.length) return article.preferredMeetupSpots;

  const neighborhoods: MeetupNeighborhood[] = article.neighborhoods?.length
    ? article.neighborhoods
    : article.neighborhood
      ? [article.neighborhood]
      : [];

  const seen = new Set<string>();
  return neighborhoods
    .filter((n) => n?.id && !seen.has(n.id) && Boolean(seen.add(n.id)))
    .map((n) => ({
      name: `À convenir dans ${n.name}`,
      category: 'other_public',
      neighborhood: { id: n.id, name: n.name, borough: n.borough },
    }));
}
