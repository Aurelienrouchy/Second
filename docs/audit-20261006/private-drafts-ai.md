# Brouillons privés, téléversement IA et isolation locale

Lot ciblé complémentaire sur `audit/seconde-security-ux-20261006`, issue de `b79d0c8e47a18ec9b405b13e8229a63f5ef02980`. Il ne constitue pas une couverture exhaustive. Aucun service de production, modèle IA réel, appareil ou simulateur natif n’a été appelé dans ce lot ; aucun commit, push, déploiement ou changement historique n’a été effectué par cet agent.

## Résultat

Les nouveaux téléversements IA conservent le transport REST binaire Expo existant, authentifié avec Firebase. Leur réponse peut contenir un token de téléchargement généré par Storage : elle est désormais ignorée intégralement, sans parsing, journalisation ni persistance. Le service retourne exclusivement une référence canonique au chemin privé, avec `alt=media` et sans bearer token. Après succès, seul l’objet nouvellement créé reçoit `cacheControl: private, no-store, max-age=0` via le SDK authentifié. Le passage à une autre identité interrompt le traitement avant réutilisation par cette identité.

Les prévisualisations brouillon/review/détails/aperçu et les miniatures caméra passent par `PrivateStorageImage`, intégré avec le lot confidentialité. Les références distantes privées sont lues par `getBytes` authentifié et rendues depuis des octets en mémoire, sans cache image natif ni repli vers une URL publique. Les photos locales exigent le propriétaire capturé à l’entrée du parcours ; elles sont masquées lorsque l’UID courant change. Le modal de reprise masque également texte et actions d’un brouillon d’un autre compte ; ses callbacks natifs/boutons vérifient directement l’identité SDK courante pour bloquer un événement tardif avant le rerender.

Les nouveaux brouillons portent `ownerUid`. Leur clé AsyncStorage et leur répertoire de cache sont propres à l’UID authentifié. Les UID hors du sous-ensemble borné `[A-Za-z0-9_-]` sont refusés avant accès disque, pour éviter la normalisation de chemins avec `..`, `/` ou encodage d’un séparateur. Les lectures, écritures, suppressions, caches et nettoyages ne consultent jamais la clé globale historique ou les fichiers directement sous l’ancien répertoire commun. Les snapshots d’un autre compte sont rejetés. Une génération de session invalide les opérations en file, débouncées ou en cours après un changement de compte, y compris A → B → A.

Une opération native AsyncStorage/FileSystem déjà dispatchée ne peut pas être annulée : elle reste attachée à la clé ou au répertoire du compte initiateur, et son résultat tardif est rejeté. Les callbacks des écrans sont aussi attachés à leur propriétaire initial, afin de ne pas récupérer un brouillon B puis y enregistrer les photos/champs A. La publication terminée après un changement d’identité ne supprime pas le brouillon du nouveau compte.

Le callable IA et son service serveur utilisent déjà les images **inline base64**, et ne téléchargent pas les URL du brouillon. Le contrat inline reste inchangé ; aucun téléchargement HTTP anonyme ou nouveau flux Admin n’est nécessaire pour analyser les photos privées. Le chemin canonique privé reste accepté par la promotion Admin des médias en publication.

## Matrice de couverture

| Parcours / propriété | Sources examinées | Correctif | Preuve ciblée | Non vérifiable ici |
| --- | --- | --- | --- | --- |
| REST upload → nouveau brouillon canonique | `services/aiService.ts` complet | Réponse ignorée, URL sans token, garde UID, cache nouvel objet | Upload binaire/auth, réponse réaliste avec token synthétique ignoré, échec non-2xx sans fuite | Transport RN/Storage réel, AppCheck réel |
| Photos multiples / traitement / callable retardé + changement de compte | Service IA complet | UID initiateur à chaque upload, avant callable et au retour ; cleanup lié à cet UID | Aucun upload suivant pour B ; résultat tardif abandonné ; aucun cleanup B | Appareil/reprise réseau réelle |
| Reprise avec média privé | Modal + service complet | Source authentifiée, propriétaire local et texte/actions guardés | Test source mémoire/cache none ; vieux modal masqué après changement UID | Rendu natif / bitmap GPU |
| Review + miniature + détails + aperçu | Composants listés ci-dessous, blocs pertinents des écrans | Rendu privé commun ; propriétaire capturé ; sauvegarde/nav guardées | Régressions ordre/URL/double tap, capture/Continue, reprise prix | Caméra/galerie/gestes natifs |
| Persistance par compte et absence de migration | `services/draftService.ts` complet | ownerUid, clé/cache UID, ancien global ignoré | Reprise A/B indépendante, snapshots rejetés, vieux cache jamais lu/supprimé | Inspection des appareils historiques |
| Sauvegarde en file / debounce / lecture / copie / écriture retardée | Service complet et callbacks d’écrans | Génération de session + vérifications avant/après await | A→B→A, debounce annulé, lecture/copie rejetées, écriture restant sous clé A | Annulation d’une opération native déjà dispatchée impossible |
| Cache UID et nettoyage | Service complet | Rejet chemins d’autre propriétaire, nettoyage limité au sous-répertoire courant | Comptes distincts ; UID dot/dotdot/slash/encodé refusés | UID custom hors sous-ensemble non pris en charge localement |
| Backend IA | `functions/src/callable/ai.ts` complet et chemins de traitement `services/ai.ts` | Aucun changement requis | Test client conserve `{images:[{base64,mimeType}]}` | Gemini réel non exécuté |
| Publication d’un chemin privé sans token | Helper Admin et suite média | Test ajouté, implémentation lot média existante | Copie Admin depuis chemin propriétaire, URL finale article publique | Runtime Storage indisponible dans l’environnement, intégration parent |

## Inventaire du lot

Modifiés : `services/aiService.ts`, `services/draftService.ts`, `components/DraftResumeModal.tsx`, `components/PhotoCarousel.tsx`, `features/sell/components/capture/ThumbnailStrip.tsx`, `features/sell/components/shared/PhotoStripPreview.tsx`, `features/sell/components/capture/SellOverlayCapture.tsx`, `app/sell/capture.tsx`, `app/sell/photos-review.tsx`, `app/sell/details.tsx`, `app/sell/pricing.tsx`, `app/sell/preview.tsx`.

Tests : `tests/jest/aiService.test.ts`, `draftService.test.ts`, `privateDraftPreview.test.tsx` ajouté, mocks des tests `sellCapture.test.tsx`, `sellPhotosReview.test.tsx`, `sellPricingResume.test.tsx`, et cas canonique ajouté à `functions/src/utils/articleMedia.test.ts`.

Intégration en coopération, détenue par le lot confidentialité : `utils/privateMedia.ts`, `hooks/usePrivateMediaSource.ts`, `hooks/useFirebaseUserId.ts`, `components/PrivateStorageImage.tsx`, mock auth partagé `jest.setup.js` et leurs suites. Le rapport de ce lot est `docs/audit-20261006/private-media.md`.

Examinés sans modification : `functions/src/callable/ai.ts`, `functions/src/services/ai.ts` (traitement inline), `functions/src/utils/articleMedia.ts` (promotion Admin), usages de reprise dans `app/(tabs)/sell.tsx`, points d’entrée d’auth et recherche des anciennes clés. Aucun autre écran ou fonction n’est déclaré couvert par ce complément.

## Vérifications

Passe ciblée du 6 octobre 2026 :

- Jest : **66/66**, six suites (IA, brouillons, preview privé, capture, review, reprise prix).
- Functions `articleMedia.test.ts` : **16/16** sur l’état partagé final observé, dont le cas source canonique sans token ajouté par ce lot.
- TypeScript application, tests et Functions : **réussis** sur le snapshot final de ce lot ; les vérifications globales sont intégrées séparément par le parent.
- ESLint sources de ce lot : **0 erreur, 17 avertissements** ; avertissements existants d’imports default nommés, deux dépendances de hooks déjà présentes et variables de preview inutilisées. Aucun contournement de règle ajouté.
- `git diff --check` réussi sur l’état partagé observé.

```sh
node_modules/.bin/jest --runInBand tests/jest/draftService.test.ts tests/jest/aiService.test.ts tests/jest/privateDraftPreview.test.tsx tests/jest/sellCapture.test.tsx tests/jest/sellPhotosReview.test.tsx tests/jest/sellPricingResume.test.tsx --silent
node_modules/.bin/tsc --noEmit
node_modules/.bin/tsc -p tsconfig.test.json --noEmit
cd functions
node_modules/.bin/vitest run src/utils/articleMedia.test.ts
node_modules/.bin/tsc --noEmit
```

## Limites et décisions restantes

Ce correctif ferme la distribution des capacités de téléchargement dans les nouveaux flux ordinaires. Storage peut toujours générer un token sur l’objet, et les anciens liens privés distribués restent des capacités bearer jusqu’à une intervention externe autorisée. Aucune absence de token sur l’objet ni révocation historique n’est revendiquée.

La clé globale et les photos communes historiques restent intactes mais ne sont plus proposées à la reprise. Leur migration, attribution sûre ou suppression nécessite une décision distincte du propriétaire ; le nouveau flux ne les inspecte pas. Le support de UID custom contenant des caractères hors sous-ensemble sûr demanderait un encodage de répertoire dédié avant activation.

Les tests utilisent Firebase, FileSystem, image/galerie et IA mockés. Aucun accès HTTP Storage réel, appel Gemini, capture visuelle ni E2E natif n’est revendiqué ici. Les règles inter-comptes et les parcours d’émulateur globaux restent consignés par l’intégration unique du parent.
