/**
 * Types — Boutiques : identité, adresse, horaires, validation.
 *
 * Éclaté depuis types/index.ts (1029 lignes, tous domaines mêlés).
 * `types/index.ts` reste le barrel public : les imports `from '@/types'`
 * sont inchangés.
 */

// Shop types
export type ShopType = 
  | 'friperie'
  | 'depot-vente'
  | 'vintage'
  | 'luxe-seconde-main'
  | 'streetwear'
  | 'concept-store'
  | 'createurs-designer'
  | 'workwear-militaire'
  | 'boutique-enfant'
  | 'chaussures-sneakers'
  | 'accessoires-maroquinerie'
  | 'librairie-occasion'
  | 'jouets-puericulture'
  | 'hightech-electronique'
  | 'maison-deco'
  | 'sport-outdoor'
  | 'vinyles-musique'
  | 'beaute-cosmetiques'
  | 'ressourcerie'
  | 'autre';

export const ShopTypeLabels: Record<ShopType, string> = {
  'friperie': 'Friperie',
  'depot-vente': 'Dépôt-vente',
  'vintage': 'Vintage',
  'luxe-seconde-main': 'Luxe & Seconde main',
  'streetwear': 'Streetwear',
  'concept-store': 'Concept store',
  'createurs-designer': 'Créateurs & Designer',
  'workwear-militaire': 'Workwear & Militaire',
  'boutique-enfant': 'Boutique enfant',
  'chaussures-sneakers': 'Chaussures & Sneakers',
  'accessoires-maroquinerie': 'Accessoires & Maroquinerie',
  'librairie-occasion': 'Librairie d\'occasion',
  'jouets-puericulture': 'Jouets & Puériculture',
  'hightech-electronique': 'High-tech & Électronique',
  'maison-deco': 'Maison & Déco',
  'sport-outdoor': 'Sport & Outdoor',
  'vinyles-musique': 'Vinyles & Musique',
  'beaute-cosmetiques': 'Beauté & Cosmétiques',
  'ressourcerie': 'Ressourcerie',
  'autre': 'Autre',
};

export type ShopStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface ShopVerificationDetails {
  reason?: string;
  verifiedAt?: Date;
  verifiedBy?: string;
}

export interface ShopLegalInfo {
  businessNumber?: string;    // NEQ (Numero d'entreprise du Quebec) ou BN/NE federal
  gstNumber?: string;         // Numero de TPS
  qstNumber?: string;         // Numero de TVQ (Quebec)
  bankTransit?: string;       // Numero de transit (5 chiffres)
  bankInstitution?: string;   // Numero d'institution (3 chiffres)
  bankAccount?: string;       // Numero de compte (7-12 chiffres)
}

export interface ShopAddress {
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface ShopLocation {
  /** Legacy shops may have no qualified position. Never substitute (0, 0). */
  latitude: number | null;
  longitude: number | null;
  geohash?: string; // For Firestore geolocation queries
}

export interface ShopSocialMedia {
  instagram?: string;
  facebook?: string;
}

export interface OpeningHours {
  [day: string]: {
    open: string;
    close: string;
  } | null;
}

export interface Shop {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  type: ShopType;
  address: ShopAddress;
  location: ShopLocation;
  phoneNumber: string;
  email: string;
  website?: string;
  socialMedia?: ShopSocialMedia;
  openingHours: OpeningHours;
  logo?: string;
  images: string[];
  status: ShopStatus;
  /**
   * Forfait payant de la boutique (Paid shop model). Détermine la réduction
   * des frais acheteur appliquée 100% serveur (jamais le client). Optionnel :
   * omettre (ne pas écrire) tant que le forfait n'est pas souscrit.
   */
  tier?: 'basic' | 'pro' | 'premium';
  /**
   * Date d'expiration du forfait payant (stampée 100% serveur par le webhook
   * après paiement, F134). Tant que `tierPaidUntil > now`, la réduction de frais
   * acheteur du `tier` s'applique ; passée cette date, retour au tier `basic`.
   * Optionnel : absent tant qu'aucun forfait payant n'a été souscrit.
   */
  tierPaidUntil?: Date;
  verificationDetails?: ShopVerificationDetails;
  legalInfo?: ShopLegalInfo;
  rating?: number;
  reviewCount: number;
  articlesCount: number;
  /** Missing historical timestamps remain unknown; never replace them with now. */
  createdAt: Date | null;
  updatedAt: Date | null;
}
