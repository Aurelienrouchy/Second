# Audit #01 — Flow d'achat complet (Discovery → Checkout)

**Date** : 2026-05-26 | **Incohérences** : 21 (2C, 5H, 8M, 6B)

## Résumé

Le parcours home → fiche article → checkout est globalement solide (transactions atomiques, protection double-achat). Problèmes principaux : conflit de types ShippingEstimate, références Helcim/Intelcom actives, absence de validation isSold dans le checkout, prix livraison "Gratuit" trompeur.

## Incohérences

### CRITIQUES

1. **Conflit types ShippingEstimate** — deux définitions incompatibles entre `types/index.ts:158-166` (Intelcom legacy) et `features/checkout-shipping/types.ts:6-13` (ShipEngine). Cast `as` masque l'erreur.
2. **Références Helcim/Intelcom actives** — fallback estimates avec `carrier: 'Intelcom'` (`features/checkout-shipping/types.ts:36-37`), types Transaction avec champs Helcim (`types/index.ts:255-260`), composant `HelcimPayment.tsx` toujours présent.

### HAUTES

3. **Checkout ne vérifie pas isSold** — `checkout/index.tsx`, `checkout/meetup.tsx`, `checkout/shipping.tsx` ne vérifient jamais `article.isSold`. L'utilisateur remplit tout pour découvrir l'erreur à la fin.
4. **Checkout ne vérifie pas acheteur ≠ vendeur** — pas de guard `currentUser.uid === article.sellerId` dans les écrans checkout.
5. **Service fee fallback client faux** — `checkout/shipping.tsx:158` calcule `price * 0.05` au lieu de `max(2.00, price * 0.05 + 1.50)`.
6. **Livraison "Gratuit" trompeuse** — `ArticleDetails.tsx:114-115` affiche "Gratuit" quand `shippingCost` est undefined (toujours le cas, TODO permanent à `article/[id].tsx:149`).
7. **FlashList home sans estimatedItemSize** — `app/(tabs)/index.tsx:118-125`.

### MOYENNES

8. ProductCard n'affiche pas l'état "vendu" — pas de prop `isSold`.
9. Pas de protection double-tap sur CTA achat — `ArticleCTABar.tsx:63`.
10. Checkout charge l'article directement Firestore, bypass React Query cache.
11. Seller rating toujours undefined sur la fiche produit.
12. Prix livraison hardcodé "À partir de 8,50 $" — `checkout/index.tsx:213`.
13. Checkout meetup ne vérifie pas `isHandDelivery`.
14. Accents manquants dans les textes checkout FR.
15. Commentaire fees.ts référence "Helcim processing".

### BASSES

16. `withSpring` dans PriceDropsSection (convention no-spring violée).
17. Erreur article : bouton retour vs accueil cohérent (RAS).
18. Success screen passe montants comme strings (risque NaN).
19. Checkout article error sans bouton retour.
20. Province non validée (champ libre au lieu de picker).
21. SimilarProducts utilise `category` (deprecated) au lieu de `categoryIds`.

## Fichiers clés

- `app/checkout/index.tsx`, `shipping.tsx`, `meetup.tsx`, `success.tsx`
- `app/article/[id].tsx`, `features/article/components/ArticleDetails.tsx`
- `features/checkout-shipping/types.ts`
- `components/ProductCard.tsx`, `components/SimilarProducts.tsx`
- `functions/src/callable/payments.ts`, `functions/src/utils/fees.ts`
- `types/index.ts`
