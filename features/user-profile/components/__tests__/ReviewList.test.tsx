/**
 * ReviewList — en-tête de note + liste des avis du profil.
 *
 * Domaine : profil-reviews. Comportement MÉTIER couvert :
 *  - le résumé de note (moyenne + nombre d'avis) n'apparaît QUE s'il existe au
 *    moins un avis (nombreAvis > 0).
 *  - le compteur s'accorde au singulier/pluriel ("évaluation" / "évaluations").
 *  - en chargement, ni résumé ni état vide ne s'affichent (spinner only).
 *  - état vide différencié : message d'incitation sur SON profil vs message
 *    neutre sur le profil d'un tiers.
 *  - taper l'avatar d'un avis remonte le reviewerId (navigation vers son profil).
 *
 * .test.tsx → périmètre Jest.
 */

import { fireEvent, render } from '@testing-library/react-native';

// On importe le composant par son chemin direct (pas le barrel) : le barrel
// @/features/user-profile tire ProfileHeader → components/ui (Avatar /
// OfflineBanner) qui pullent des ESM natifs (expo-linear-gradient, expo-network)
// non transpilés sous Jest et hors périmètre de ce test.
import { ReviewList } from '@/features/user-profile/components/ReviewList';
import type { UserStats } from '@/services/userStatsService';
import type { ProfileReview } from '@/features/user-profile/types';

const baseStats: UserStats = {
  articlesEnVente: 0,
  articlesVendus: 0,
  gainsTotal: 0,
  totalVues: 0,
  totalLikes: 0,
  moyenneNote: 4.6,
  nombreAvis: 0,
};

const review: ProfileReview = {
  id: 'rev-1',
  reviewerId: 'buyer-1',
  reviewerName: 'Alice',
  date: '2026-05-01',
  text: 'Très bonne transaction.',
  note: 5,
};

describe('ReviewList — résumé de note', () => {
  it('affiche la moyenne et le total quand il y a des avis', () => {
    const { getByText } = render(
      <ReviewList
        stats={{ ...baseStats, moyenneNote: 4.6, nombreAvis: 3 }}
        reviews={[review]}
        onReviewerPress={jest.fn()}
      />,
    );

    expect(getByText('4.6')).toBeTruthy();
    expect(getByText('3 évaluations')).toBeTruthy();
  });

  it('accorde le compteur au singulier pour un seul avis', () => {
    const { getByText } = render(
      <ReviewList
        stats={{ ...baseStats, moyenneNote: 5, nombreAvis: 1 }}
        reviews={[review]}
        onReviewerPress={jest.fn()}
      />,
    );

    expect(getByText('1 évaluation')).toBeTruthy();
  });

  it('masque le résumé de note quand le vendeur n’a aucun avis', () => {
    const { queryByText } = render(
      <ReviewList
        stats={{ ...baseStats, nombreAvis: 0 }}
        reviews={[]}
        onReviewerPress={jest.fn()}
      />,
    );

    // Pas de "0 évaluation(s)" ni de score affiché.
    expect(queryByText(/évaluation/)).toBeNull();
  });
});

describe('ReviewList — états chargement / vide', () => {
  it('n’affiche pas l’état vide pendant le chargement', () => {
    const { queryByText } = render(
      <ReviewList
        stats={baseStats}
        reviews={[]}
        isLoading
        onReviewerPress={jest.fn()}
      />,
    );

    expect(queryByText('Aucun avis pour le moment')).toBeNull();
  });

  it('affiche un message neutre quand un tiers n’a aucun avis', () => {
    const { getByText } = render(
      <ReviewList
        stats={baseStats}
        reviews={[]}
        isOwnProfile={false}
        onReviewerPress={jest.fn()}
      />,
    );

    expect(getByText('Aucun avis pour le moment')).toBeTruthy();
  });

  it('affiche un message d’incitation sur son propre profil sans avis', () => {
    const { getByText } = render(
      <ReviewList
        stats={baseStats}
        reviews={[]}
        isOwnProfile
        onReviewerPress={jest.fn()}
      />,
    );

    expect(getByText('Les avis de vos acheteurs apparaîtront ici.')).toBeTruthy();
  });
});

describe('ReviewList — navigation vers l’auteur d’un avis', () => {
  it('remonte le reviewerId quand on tape l’avatar de l’avis', () => {
    const onReviewerPress = jest.fn();
    const { getByText } = render(
      <ReviewList
        stats={{ ...baseStats, nombreAvis: 1 }}
        reviews={[review]}
        onReviewerPress={onReviewerPress}
      />,
    );

    // L'avatar sans image affiche l'initiale du reviewer — point d'entrée tap.
    fireEvent.press(getByText('A'));
    expect(onReviewerPress).toHaveBeenCalledWith('buyer-1');
  });
});
