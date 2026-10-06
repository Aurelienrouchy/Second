# Création d’annonce, brouillons, adresse et référentiels de tailles

Audit ciblé de la branche `audit/seconde-security-ux-20261006`, issue du commit demandé `b79d0c8e47a18ec9b405b13e8229a63f5ef02980`. Ce lot ne constitue pas un audit exhaustif du dépôt. Aucun appareil, simulateur iOS/Android ni vérification visuelle native n’était disponible. Aucun déploiement, publication distante, appel de paiement ou changement externe n’a été effectué par ce lot.

## Résultats

- Les matières sont triées selon le libellé français affiché, sur une copie ; les identifiants et l’ordre du référentiel utilisé par l’IA restent inchangés.
- Le fond extérieur du sélecteur Zone de meetup, son fond natif et son espace inférieur utilisent `surfaceWarm`, comme autour du champ de recherche. Les lignes restent distinctes. Aucun token global n’a été changé.
- Les deux entrées caméra partagent une gestion de session : remount à chaque changement d’objectif, torch coupé au passage en frontal, capture désactivée avant ready, erreur de montage ou absence de ready après 8 secondes avec bouton Réessayer. Les callbacks d’une ancienne session sont ignorés.
- Le refus de permission et l’échec de caméra laissent accéder à la galerie, au compteur de photos, à Continuer et à Fermer. Continuer attend la sauvegarde des photos.
- Les photos peuvent changer de position indépendamment de la photo principale grâce aux commandes Avancer/Reculer ; toute permutation est possible. Le raccourci de mise en principale reste disponible. L’ordre des URL suit celui des photos, et ajout/suppression/réordre sont persistés. Un jeu d’URL incomplet est invalidé pour que publication téléverse toutes les photos locales.
- Les sorties explicites et les handlers de sortie native attendent la sauvegarde ; les écrans détails/prix attendent aussi leurs champs avant Continuer/quitter. La reprise de prix restaure désormais les photos, champs, URL et contexte IA, auparavant perdus à la navigation suivante.
- Les mutations du brouillon sont sérialisées et fusionnent la dernière version : une sauvegarde de champs depuis un ancien snapshot ne restaure plus l’ancien ordre. Les nouveaux fichiers locaux ont des noms distincts, les fichiers déjà cachés sont réutilisés. Un brouillon supprimé/publié/remplacé ne peut pas être rétabli par une sauvegarde tardive.
- Adresse manuelle, Google Places et autocomplétion de secours passent par la même validation canadienne au point de sauvegarde : champs requis, province, pays et format postal, avec normalisation. Une suggestion incomplète ouvre la saisie manuelle préremplie sans enregistrer une adresse incomplète.
- Les tailles sont désormais des données JSON communes aux sélecteurs de vente, à l’onboarding et au référentiel Functions, sans changement de valeurs déjà stockées. Les doublons de listes de tailles de vêtements sont retirés à la lecture. Le test de parité couvre les sept types du référentiel serveur.

## Matrice des parcours

| Parcours | Examen | Correctif | Validation automatisée | Limites |
| --- | --- | --- | --- | --- |
| Matières A–Z, accents inclus | Source complète du référentiel et usages détails | Oui | Vitest ordre/identifiants/source non mutée | Apparence native non vérifiée |
| Zone de meetup | Source complète du sheet | Oui | ESLint/types ; inspection des valeurs de styles | Contraste final et safe area sur appareil non vérifiés |
| Caméra arrière → frontale → arrière | Deux composants + contrôles | Oui | Hook : session différente, torch off, ready, anciens callbacks, erreur/timeout/retry | Image réelle, driver et capture frontale non vérifiés |
| Caméra refusée + galerie + Continuer immédiat | Overlay et route | Oui | Composant et écran : galerie visible, Continuer attend save | Permission système/galerie natives mockées |
| Réordre non principal puis Continuer | Review + service | Oui | Écran : ordre + URL + double tap ; utilitaire : déplacement arbitraire | Boutons testés ; pas de glisser-déposer ajouté |
| Ajout/suppression puis sortie/reprise | Review/capture + service | Oui | Service : paires conservées, nouveaux médias sans URL obsolètes, cache sans écrasement | Navigation native testée par source/handlers, geste réel non vérifié |
| Sauvegarde de champs concurrente au réordre | Service + détails/prix | Oui | Sauvegardes concurrentes conservent ordre et champs | AsyncStorage mocké |
| Publication/suppression puis sauvegarde tardive | Service | Oui | Brouillon supprimé ou remplacé jamais recréé | Promotion/cleanup serveur appartiennent au lot média/règles |
| Reprendre à l’étape prix → aperçu | Prix et lecture des paramètres preview | Oui | Écran : photos, URL, détails et IA transmis à preview | Publication réelle non exécutée |
| Adresse manuelle/Google/fallback | Screen et service autocomplete | Oui | Validateur : normalisation, champs manquants, pays/province/code postal rejetés | Aucun appel Google/Photon ni changement de profil réel |
| Référentiel tailles vente/onboarding/Functions | Sources des trois côtés | Oui | Parité des sept catégories + catalogue onboarding | Sortie d’un modèle IA réel non évaluée ; il conserve le texte détecté sur l’étiquette |

## Inventaire et niveau de lecture

Sources entièrement examinées et corrigées :

- `app/sell/capture.tsx`, `app/sell/photos-review.tsx`, `app/sell/details.tsx`, `app/sell/pricing.tsx`.
- `features/sell/components/capture/SellOverlayCapture.tsx`, `PermissionDenied.tsx`, `TopControls.tsx` ; `features/sell/hooks/useSellCamera.ts` et `features/sell/components/shared/PhotoOrderControls.tsx` ajoutés ; barrel `features/sell/index.ts` vérifié et mis à jour.
- `services/draftService.ts`, `data/materials.ts`, `data/sizes.ts`, `features/onboarding/constants/sizes.ts`, `functions/src/productReference.ts`, `functions/src/shared/sizeCatalog.json` ajouté.
- `components/NeighborhoodBottomSheet.tsx`, `app/settings/address.tsx`, `utils/addressValidation.ts` et `utils/sellPhotos.ts` ajoutés.

Sources examinées en lecture, sans modification :

- `features/sell/components/capture/CameraControlsRow.tsx`, `ThumbnailStrip.tsx`, `services/addressAutocompleteService.ts`, `app/(tabs)/sell.tsx`.
- `app/sell/preview.tsx` : blocs de reprise, navigation et publication examinés ; promotion/stockage traités par le lot média.
- `functions/src/services/ai.ts` : imports, prompt et normalisation des tailles/matières ; `functions/src/services/brands.ts` : import Firebase et lecture de marques.
- `CLAUDE.md`, `.claude/agents/rn-expo-dev.md`, `CODEBASE_INDEX.md`, `.agents/skills/tdd/SKILL.md`, configs TypeScript/Jest/Vitest/ESLint/Metro utiles à ce lot.

Fichiers inventoriés seulement : les autres fichiers de `components/sell/`, `features/sell/components/analysis/`, `features/sell/components/details/`, `features/sell/components/pricing/`, `features/sell/components/shared/` et `app/sell/_layout.tsx`. Leur présence a été recensée ; aucune lecture exhaustive ou validation native n’est revendiquée. Les tests existants ChipSelector, FormErrors, PriceCard, SellFooter et ShippingCard ont été exécutés.

Tests ajoutés/étendus :

- `tests/jest/draftService.test.ts` : concurrence, média/cache, suppression et remplacement du brouillon.
- `tests/jest/sellCapture.test.tsx`, `sellPhotosReview.test.tsx`, `sellPricingResume.test.tsx` : régressions de parcours.
- `features/sell/hooks/useSellCamera.test.tsx`, `features/sell/components/__tests__/PermissionDenied.test.tsx`.
- `utils/addressValidation.test.ts`, `utils/sellPhotos.test.ts`, `utils/sellCatalog.test.ts`, `features/onboarding/constants/sizes.test.ts`.
- `functions/src/services/ai.materials.test.ts` : mock explicite de Firebase ; une lecture DB inattendue fait échouer le test, sans affaiblir la garde d’émulateurs.

## Vérifications

Dernière passe ciblée :

- Jest : **58/58**, 11 suites.
- Vitest utilitaires/catalogues/adresse : **21/21**, 4 suites.
- Functions AI materials : **4/4**.
- TypeScript application : réussi ; TypeScript Functions : réussi ; TypeScript des tests : réussi lors de la passe ciblée à 02:06 UTC. Une passe partagée ultérieure a signalé `tests/jest/chatService.send.test.ts:88` (mock `messageId` du lot offres) ; intégration finale à réconcilier par le parent.
- ESLint des fichiers de ce lot : **0 erreur**, 7 avertissements de patterns déjà présents (imports default nommés et dépendances de deux hooks existants).
- `git diff --check` : réussi sur l’état partagé observé.

Commandes reproductibles (outils installés par npm officiel, exécution locale sans services de production) :

```sh
node_modules/.bin/jest --runInBand tests/jest/draftService.test.ts tests/jest/sellCapture.test.tsx tests/jest/sellPhotosReview.test.tsx tests/jest/sellPricingResume.test.tsx features/sell/hooks/useSellCamera.test.tsx features/sell/components/__tests__ --silent
node_modules/.bin/vitest run utils/sellPhotos.test.ts utils/addressValidation.test.ts utils/sellCatalog.test.ts features/onboarding/constants/sizes.test.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/tsc -p tsconfig.test.json --noEmit
cd functions
node_modules/.bin/vitest run src/services/ai.materials.test.ts
node_modules/.bin/tsc --noEmit
```

Les vérifications globales finales (lint:boundaries, l’ensemble des suites et règles, E2E disponibles) relèvent de l’intégration unique du parent. Aucun résultat E2E ni capture visuelle native n’est revendiqué par ce lot. La caméra, la navigation native de retour et l’aspect du sheet restent à confirmer sur appareil iOS et Android avant diffusion.
