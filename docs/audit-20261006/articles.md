# Lot articles, galerie, profils et recherche — 6 octobre 2026

Base vérifiée : branche `audit/seconde-security-ux-20261006`, commit initial `b79d0c8e47a18ec9b405b13e8229a63f5ef02980`. Aucun commit, push, merge ou déploiement effectué par ce lot. Les tests utilisent des mocks locaux ; aucune opération Firebase/Stripe de production.

## Corrections et preuves

| Parcours | Constat confirmé au code audité | Correction | Vérification réalisée | Non vérifiable ici |
| --- | --- | --- | --- | --- |
| Article → agrandir une photo → naviguer → fermer | Échelle commune aux pages, pinch non cumulatif, absence de pan, index modal/pager désynchronisé, dimensions figées et marge haute arbitraire | Instance de zoom propre à la photo sélectionnée ; pinch cumulatif 1–4 ; double toucher ; pan borné à l’image réellement ajustée ; swipe seulement au zoom initial ; boutons accessibles ; index commun et pager réaligné ; dimensions et safe areas réactives | 4 tests Jest : navigation, limites d’index, changement d’article, pinch répété, swipe bloqué au zoom et remise à zéro en changeant de photo. Géométrie testée séparément | Reconnaissance native des gestes, rendu, rotation, animation et safe areas sur appareils iOS/Android ; aucune capture |
| Profil public → photos d’articles | Image brute `images[0].url` sans normalisation des URLs ni prise en charge legacy ; absence d’état d’erreur image | Normalisation commune des chaînes/objets, URLs Storage encodées, blurhash conservé ; première image valide et placeholder si absente ou illisible | Test Jest de photo legacy, erreur de chargement et navigation vers l’article ; tests unitaires de normalisation | Disponibilité des fichiers réels et anciennes URLs cassées/introuvables |
| Profil → Articles ↔ Avis | Deux conteneurs alternés démontent le header/liste et perdent le défilement | Une FlashList conservée ; avis bornés en footer, sans ScrollView imbriquée ; offsets par onglet ; données mémoïsées ; erreurs de lecture explicites | Test Jest de maintien du header/liste et restauration de deux offsets ; tests existants des onglets, avis et lecture de profil | Virtualisation et positions visuelles avec de grands profils sur appareil. Les erreurs d’écran sont relues au code, sans test de route complet |
| Recherche/filtres → pages successives | Les deux chemins articles/search_index lisent un lot, tronquent les résultats et avancent après tout le lot : annonces sautées. Fin prématurée si lot court ou plafond de remplissage atteint | Scan commun ; curseur après le dernier document consommé, avant le match de lookahead ; continuation au plafond même pour page vide ; vrai épuisement quand lot court ; exclusion du vendeur traitée comme filtre client | 8 tests Jest des deux chemins : 17 annonces sans saut/doublon, filtre sélectif après 50 lectures, dernière page exacte, exclusion utilisateur ; 10 tests du hook de recherche | Index Firestore réellement déployés, latence et coûts facturés réels ; tests de pagination sur SDK mocké |
| Recherche très sélective → page vide intermédiaire | La page n’est pas nécessairement la fin de recherche | Message de continuation et bouton « Continuer la recherche » lorsque des documents restent à examiner | Lecture du rendu et tests de continuation du service/hook | Déclenchement natif onEndReached et rendu du bouton |
| Boutique → Voir tous les articles | shopId utilisé comme sellerId ; résultats masqués quand aucun terme/filtre ; tri prix annoncé mais requête vendeur triée par récence | Nouveau lien sellerId=ownerId ; anciens liens shopId résolus via boutique approuvée ; recherche suspendue pendant résolution ; résultats conservés sans filtre ; parcours boutique limité au tri récent supporté | 3 tests de hook : lookup legacy/owner, lien explicite sans lookup, boutique suspendue sans requête globale ; options de tri récent vérifiées | Navigation et données des boutiques réelles ; aucun achat de forfait |

La callable de profil renvoie historiquement au plus 30 articles et 10 avis. Ce lot ne transforme pas ces limites existantes en pagination publique complète. Le parent a pris en charge la conservation des candidats image côté callable `reviews.ts`, afin qu’une première entrée invalide ne masque pas une image valide suivante.

## Inventaire ciblé

Les lectures ci-dessous portent sur les parcours et sections pertinents, pas sur une preuve de lecture exhaustive de chaque fichier du dépôt.

Fichiers modifiés dans ce lot :

- `components/ImageGallery.tsx`, nouveau `components/ZoomableGalleryImage.tsx`, `features/article/components/ArticleHero.tsx`.
- `app/user/[id].tsx`, `features/user-profile/components/ArticleGrid.tsx`, `ArticleGridItem.tsx`, `ReviewList.tsx`.
- `services/articlesService.ts` : normalisation image et pagination. Les mutations/upload de ce même fichier sont traités par le lot média/règles.
- `hooks/useArticleSearch.ts`, `features/search/hooks/useSearchScreen.ts`, `app/search.tsx`, `app/shop/[id].tsx` (lien articles uniquement ; forfait traité ailleurs).
- Nouveaux `utils/articleImages.ts`, `utils/galleryGeometry.ts` et tests.
- `tests/jest/articlesSearchPagination.test.ts`, `ImageGallery.test.tsx`, `shopSearchScope.test.tsx`, `features/user-profile/components/__tests__/ArticleGrid.test.tsx`, compléments `tests/jest/useArticleSearch.test.tsx`, assertion d’erreur française `tests/jest/articlesService.test.ts`.
- `.maestro/flows/article-gallery.yaml` ajouté ; `.maestro/flows/profile-reviews-view-and-avis.yaml` renforcé.

Autres sources examinées : types/barrel de user-profile, `services/reviewService.ts`, `services/shopService.ts#getShopById`, normalisation dans `services/userStatsService.ts`, `hooks/useUserProfile.ts`, requêtes du profil dans `functions/src/callable/reviews.ts`, indexes articles vendeur de `firestore.indexes.json`, `utils/fixStorageUrl.ts` et ses tests, configuration Jest/Vitest, `CLAUDE.md`, agent RN/Expo et skills RN/gestes/animations/TanStack pertinents.

## Vérifications

- Suite ciblée de 11 fichiers Jest : **66/66 assertions passent** (`/tmp/articles-targeted-final.log`). Ce premier lot complet ne s’est pas terminé normalement en raison d’un timer préexistant de la fixture useUserProfile.
- Réexécution isolée galerie/profil/shop avec `--detectOpenHandles` : **9/9 passent, exit 0** (`/tmp/articles-handles.log`).
- Réexécution finale pagination/shop/hook recherche avec `--detectOpenHandles` : **21/21 passent, exit 0** (`/tmp/articles-search-final.log`).
- Vitest normalisation/géométrie/URL existante : **15/15 passent, exit 0** (`/tmp/articles-vitest-final.log`).
- App `npx tsc --noEmit` et `npm run typecheck:tests` : passent au snapshot testé ; logs `/tmp/articles-types-final.log`, `/tmp/articles-testtypes-final.log`.
- ESLint ciblé : aucune erreur ; quelques avertissements préexistants (`/tmp/articles-lint-final.log`).
- `lint:boundaries` global a identifié un test du lot vente classé sous utils qui importait une feature ; signalé au parent puis déplacé par le lot vente. La validation globale finale relève du parent.
- YAML des deux parcours Maestro parsé ; **Maestro non exécuté** : `maestro`, `adb`, `xcrun` absents. Pas de captures UI.

Cause exacte du timer de la fixture profil signalée au parent : `useUserProfile` fixe `gcTime` à 24 heures et remplace le `gcTime: 0` du QueryClient de test. La fixture crée ses clients sans les vider ; le démontage démarre un timer de 24 heures. Corriger la fixture avec cleanup et `client.clear()`, sans changer le comportement de cache produit.

## Limites restantes

`hasMore` signifie soit qu’un autre match a été observé, soit qu’une continuation non épuisée reste après le plafond de cinq lots ; il ne promet pas un futur match. Les lectures de documents sont bornées à cinq lots par appel : au plus `25 × pageSize` si des filtres sont appliqués, `5 × (pageSize + 1)` sinon. Le lookahead garantit le dernier lot exact sans fin prématurée. Le suffixe déjà lu mais non consommé peut être relu à la page suivante ; cette solution privilégie la correction du curseur sans introduire de buffer de session fragile. Les tests comptent les documents mockés, pas la facture Firestore.

Avant validation UI finale : vérifier sur iOS et Android pinch répété/double toucher/pan aux bords/swipe au zoom initial, boutons précédent/suivant et retour de modal, rotation et zones sûres ; ouvrir un profil avec photos legacy/manquantes, alterner les onglets après défilement, tester les erreurs réseau et une boutique via ancien et nouveau lien. Ces contrôles restent à réaliser sur un bundle pointant vers les émulateurs et des données de test.
