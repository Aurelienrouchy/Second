/**
 * ReviewItem — carte d'un avis (avatar, étoiles, texte, date).
 *
 * Domaine : profil-reviews. Comportement MÉTIER couvert :
 *  - le nom et le texte de l'avis sont rendus.
 *  - sans image, l'avatar retombe sur l'initiale (majuscule) du reviewer.
 *  - taper l'auteur remonte son reviewerId.
 *  - quand l'avis n'a pas de reviewerId (auteur anonyme / supprimé), le tap est
 *    neutralisé (pas de navigation vers un profil fantôme).
 *
 * .test.tsx → périmètre Jest.
 */

import { fireEvent, render } from '@testing-library/react-native';

import { ReviewItem } from '@/features/user-profile/components/ReviewItem';
import type { ProfileReview } from '@/features/user-profile/types';

const review: ProfileReview = {
  id: 'rev-1',
  reviewerId: 'buyer-1',
  reviewerName: 'alice',
  date: '2026-05-01',
  text: 'Colis rapide, conforme.',
  note: 4,
};

describe('ReviewItem — contenu', () => {
  it('rend le nom et le texte de l’avis', () => {
    const { getByText } = render(<ReviewItem review={review} index={0} />);
    expect(getByText('alice')).toBeTruthy();
    expect(getByText('Colis rapide, conforme.')).toBeTruthy();
  });

  it('retombe sur l’initiale en majuscule sans image d’avatar', () => {
    const { getByText } = render(<ReviewItem review={review} index={0} />);
    // "alice" → initiale "A".
    expect(getByText('A')).toBeTruthy();
  });
});

describe('ReviewItem — navigation vers l’auteur', () => {
  it('remonte le reviewerId au tap sur l’avatar', () => {
    const onReviewerPress = jest.fn();
    const { getByText } = render(
      <ReviewItem review={review} index={0} onReviewerPress={onReviewerPress} />,
    );

    fireEvent.press(getByText('A'));
    expect(onReviewerPress).toHaveBeenCalledWith('buyer-1');
  });

  it('neutralise le tap quand l’avis n’a pas de reviewerId', () => {
    const onReviewerPress = jest.fn();
    const anonymous: ProfileReview = { ...review, reviewerId: undefined };
    const { getByText } = render(
      <ReviewItem review={anonymous} index={0} onReviewerPress={onReviewerPress} />,
    );

    fireEvent.press(getByText('A'));
    expect(onReviewerPress).not.toHaveBeenCalled();
  });
});
