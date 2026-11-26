/**
 * Profil — barrel de la feature.
 *
 * Couvre le domaine métier « profil & réputation » (docs/metier/03) dans ses
 * deux faces :
 *   - `me/`     : mon profil (onglet Profil) — menu, stats, état invité
 *   - `public/` : le profil d'un autre vendeur — avis, grille d'articles, suivi
 *
 * Les deux en-têtes portaient le même nom `ProfileHeader` dans deux features
 * distinctes, pour des contrats de props différents. Ils sont désormais
 * explicitement nommés MyProfileHeader / SellerProfileHeader.
 */

// — mon profil —
export { GuestState } from './components/me/GuestState';
export { MyProfileHeader } from './components/me/MyProfileHeader';
export { ProfileMenu } from './components/me/ProfileMenu';
export { ProfileStats } from './components/me/ProfileStats';

// — profil public d'un vendeur —
export { ArticleGrid } from './components/public/ArticleGrid';
export { ArticleGridItem } from './components/public/ArticleGridItem';
export { SellerProfileHeader } from './components/public/SellerProfileHeader';
export { ProfileSkeleton } from './components/public/ProfileSkeleton';
export { ProfileTabs } from './components/public/ProfileTabs';
export { ReviewItem } from './components/public/ReviewItem';
export { ReviewList } from './components/public/ReviewList';
export { StatItem } from './components/public/StatItem';
export { StyleTag } from './components/public/StyleTag';
export { UserActions } from './components/public/UserActions';

export type { MenuItem, ProfileTab, ProfileReview } from './types';
