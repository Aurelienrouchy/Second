# Audit médias, règles et favoris — 2026-10-06

Périmètre de ce lot : règles Firestore/Storage, publication et expiration des médias de brouillon, messages système et projections de favoris. Base vérifiée par l’orchestrateur : main `b79d0c8e47a18ec9b405b13e8229a63f5ef02980`; travail partagé sur la branche dédiée `audit/seconde-security-ux-20261006`. Ce rapport ne prétend pas couvrir chaque parcours de l’application.

Instructions examinées : `CLAUDE.md`, `.claude/agents/firebase-backend.md`, `.agents/skills/firebase-security-rules-auditor/SKILL.md`. Les instructions du dépôt relatives au déploiement sont expressément remplacées par l’interdiction de l’utilisateur. Aucune action Firebase/Stripe de production, rotation, publication ou suppression distante exécutée.

## Inventaire et matrice

| Fichiers examinés | Parcours / preuve | Correctif | Validation exécutée | Non vérifiable ici |
|---|---|---|---|---|
| `firestore.rules`, `tests/security/articles.rules.test.ts` | Suppression d’isSold/counters via deleteField ou replacement set; édition/suppression d’une annonce réservée | Diff affectedKeys protège ajouts/modifications/suppressions; snapshots vendeur/boutique protégés; création server-only; article réservé immutable au client | Lecture et tests d’émulateur ajoutés | Runtime de règles non exécuté : téléchargement officiel des jars HTTP403 |
| `storage.rules`, `tests/security/storage.rules.test.ts` | Écriture/suppression sur l’article d’un autre compte; lecture/upload chat ou preuve hors participants | Propriétaire de l’article dérivé Firestore; parties chat/swap dérivées Firestore; chat et preuves create-only; nouveaux chemins preuve comportent UID; drafts/staging lectures propriétaire | Scénarios inter-comptes, overwrite/delete et réservation ajoutés | Runtime de règles; accès HTTP par token bearer existant |
| `firestore.rules`, `tests/security/messages.rules.test.ts`, `services/chatService.ts` | Message system forgé contournant le blocage; offer directe; faux participants/receiver | system et offers client interdits; participants/receiver liés au chat; seules réceptions de lecture par le destinataire; anciennes API système/étiquette client supprimées (sans appel restant) | Tests Jest chat-send existants; nouveaux tests rules ajoutés | Historique contenant d’anciens messages forgés; tests rules runtime |
| `services/articlesService.ts`, `functions/src/callable/products.ts`, `functions/src/utils/articleMedia.ts` | Publication de photos IA expirables; upload avant création article; ajout de drafts par édition | Upload local staged sous products/UID; copie serveur de drafts/products possédés vers articles/ID; promotion aussi à l’édition; images de l’article courant conservées; édition client via callable | Tests mocks média : ownership, bucket, protocole/hôte, staging, édition, ordre, blurhash; Jest service | Publication Storage réelle (aucun compte de production employé) |
| `services/aiService.ts`, `utils/fixStorageUrl.ts`, `services/draftService.ts`, `functions/src/scheduled/cleanupDrafts.ts` | Photos publiées supprimées après 14 jours | Upload REST IA et détection des URL Storage suivent maintenant la même politique test/emulator que le SDK (aucun endpoint REST production en build demo). Cleanup préserve toutes références d’annonces existantes, y compris images legacy string et annonces vendues/inactives; échec lecture références = aucun delete | Âge 13/15/90 jours, référence publiée, date invalide et panne de référence | Volumétrie réelle : scan projeté de toutes annonces à mesurer avant montée en charge |
| `functions/src/triggers/favorites.ts`, `functions/src/callable/products.ts`, `services/favoritesService.ts`, `hooks/useFavorites.ts`, `types/index.ts` | Premier like crée un document; duplicate/retry; inversion d’événements; UI lit un 0 avant le trigger | onDocumentWritten; agrégation transactionnelle de la source live pour chaque article modifié; projection d’accusé propriétaire; compteur optimiste maintenu jusqu’à l’accusé; rollback et double clic protégés | 4 tests serveur : création/replay, source live avec autre acheteur, multi-acheteur, suppression/index absent; 3 tests hook : snapshot initial périmé/accusé, rollback, double clic | Concurrence Firebase réelle (le mock sérialise les transactions) |
| `app/swap/[id].tsx`, `functions/src/callable/swaps.ts` | Attribution/remplacement des preuves de photos | UID scoping upload; URLs limitées au swap et uploader; max 10; remplacement de preuve déjà enregistrée interdit | Lecture et typecheck app; scénarios rules ajoutés | Upload/réception swap réel; tests callable ciblés à compléter avant activation shipping |
| `functions/src/triggers/messages.ts`, `functions/src/callable/chats.ts`, `tests/security/helpers.ts`, `firestore-schema.md`, `CODEBASE_INDEX.md` | Contrats, garde blocage, chemins de test et documentation | Schéma projection média/favoris documenté; pas de callable acceptant un texte system arbitraire | Revue des usages et recherche de références aux anciennes méthodes | Migration des anciennes URLs et messages en production |

## Vérifications de ce lot

- Functions Vitest ciblé : **14/14** (`favorites.test.ts`, `articleMedia.test.ts`, `cleanupDrafts.test.ts`). Les tests utilisent uniquement des mocks en mémoire; aucun Firebase/Stripe distant.
- Jest ciblé : **36/36** sur `useFavorites.test.tsx`, `aiService.test.ts`, `articlesService.test.ts`, `chatService.send.test.ts`. Le hook compte 3/3 tests.
- Vitest app : `utils/fixStorageUrl.test.ts` **13/13**, y compris endpoint REST test/emulator et refus d’un hôte local non configuré.
- `npx tsc --noEmit` app : passé.
- ESLint ciblé (`hooks/useFavorites.ts`, services articles/chat, route swap, types) : **0 erreur**; directives eslint-disable déjà présentes dans articlesService signalées en avertissements.
- Typecheck Functions initialement bloqué par `savedSearches.ts` (namespace admin) puis corrigé par l’orchestrateur; résultat final global dans le rapport principal.
- Typecheck tests : les derniers échecs observés concernent les spreads des nouveaux mocks du lot sell; remontés à son propriétaire, pas aux fichiers de ce lot.
- Règles Firebase : tests écrits mais **non exécutés**. L’orchestrateur a tenté le téléchargement officiel des jars; HTTP403 sur storage.googleapis.com empêche le démarrage d’émulateur. Aucun fallback non officiel ni production utilisé.
- Aucun appareil/simulateur ni capture UI de ce lot. Pas de vérification caméra/gestes revendiquée.

## Limites et actions restant au propriétaire

1. Les URL Firebase `alt=media&token=…` sont des capacités bearer. Les règles SDK resserrées n’annulent pas les liens historiques déjà divulgués de chat/preuves/drafts. Une révocation/migration historique doit être décidée et exécutée séparément; aucune rotation n’est autorisée dans cette tâche. Le correctif ne revendique pas de confidentialité HTTP de liens déjà distribués.
2. Les annonces déjà publiées sous drafts sont préservées du cleanup; les nouvelles publications/éditions sont promues. Une migration contrôlée des anciennes références reste à préparer après validation. Le propriétaire d’un ancien draft possède encore son chemin Storage; ce reliquat disparaît après promotion/migration.
3. Cleanup fait un scan de champs images des annonces. Préserver toutes références est volontaire; mesurer coût/volume et préparer un index de références serveur pour les grandes bases.
4. Des copies promues peuvent rester orphelines si la persistance d’annonce échoue après Storage. Elles ne risquent plus d’effacer une annonce publiée mais une politique de purge propriétaire/serveur pourra être ajoutée après observation, sans supprimer arbitrairement des médias existants.
5. La réconciliation de favoris corrige le compteur des articles touchés, pas l’historique de tous articles au repos. Elle conserve une seule source : favorites/articleIds. La projection privée sert d’accusé UI. Il n’y a aucune double écriture de compteur côté client/callable.
6. Les modèles users/savedSearches/chats contiennent encore des champs propriétaires dont les bornes/types pourraient être plus stricts. Le lot corrige les escalades confirmées, sans prétendre revalider juridiquement ou exhaustivement le schéma entier.

## Évaluation JSON du skill

```json
{
  "score": 3,
  "summary": "Escalades confirmées corrigées dans la branche locale; tests ciblés mocks verts. Score conservateur: runtime des règles bloqué, URLs bearer historiques et migration legacy non résolues.",
  "findings": [
    {"check": "The Update Bypass", "severity": "major", "issue": "À la base, deleteField/isSold et effacement des champs compteurs contournaient leur contrôle; corrigé par diff.affectedKeys et verrou serveur, runtime emulator non validé.", "recommendation": "Exécuter les nouveaux tests règles dès disponibilité du téléchargement officiel des émulateurs."},
    {"check": "Authority Source", "severity": "major", "issue": "À la base Storage autorisait d'autres comptes sur articles/chat/preuves; corrigé par documents Firestore propriétaires/participants et immutabilité. Les capacités HTTP bearer déjà distribuées subsistent.", "recommendation": "Décider une migration/révocation des liens privés historiques hors de cette tâche, sans confondre règles SDK et liens tokenisés."},
    {"check": "Business Logic vs. Rules", "severity": "moderate", "issue": "Publication callable promeut le média; clients système/offres supprimés et remplacés par transitions serveur. Les anciennes versions app seront rejetées pour ces écritures.", "recommendation": "Valider app et Functions/règles comme une release coordonnée avant tout déploiement autorisé."},
    {"check": "Storage Abuse", "severity": "minor", "issue": "Uploads 10MB/MIME image et preuves max10 bornés; quelques documents propriétaires existants ont encore des formes/bornes permissives.", "recommendation": "Étendre graduellement les schémas typés avec tests de compatibilité, sans autoriser un contournement de propriété."},
    {"check": "Type Safety", "severity": "minor", "issue": "Bounds string et isActive bool ajoutés aux chemins concernés; d'autres champs propriétaires ne sont pas tous validés de manière exhaustive.", "recommendation": "Poursuivre un audit de schéma par collection avec preuves de parcours client."},
    {"check": "Field-Level vs. Identity-Level Security", "severity": "moderate", "issue": "Champs serveur protégés avec propriétaire pour articles, destinataire pour receipts, owner pour projection. Les snapshots legacy peuvent garder des données historiques antérieures au correctif.", "recommendation": "Contrôler les anciens documents et valider les tests inter-comptes dans les émulateurs."}
  ]
}
```
