# Consentement analytics, notifications et cohérence MVP

Périmètre de ce lot : branche `audit/seconde-security-ux-20261006`, base
`b79d0c8e47a18ec9b405b13e8229a63f5ef02980`. Ce rapport ne revendique pas une
lecture exhaustive du dépôt. Aucun déploiement, push, paiement, envoi réel de
notification, édition native iOS/Android ou changement de compte externe.
L'intégration, les commits locaux et les tests globaux restent sous la
responsabilité de l'orchestrateur.

## Inventaire examiné

Instructions : `CLAUDE.md`, `.claude/agents/rn-expo-dev.md`,
`.claude/agents/firebase-backend.md`, `CODEBASE_INDEX.md`. Les instructions de
déploiement du document backend sont remplacées par l'interdiction explicite du
mandat. Aucun autre skill sans lien avec ce lot n'a été ouvert.

| Groupe | Fichiers de code examinés / corrigés |
| --- | --- |
| Analytics client | `lib/analytics.ts`, `config/posthogConfig.ts`, `app/_layout.tsx`, `store/authStore.ts`, `hooks/useAuthListener.ts`, `types/analytics.ts`, `types/index.ts` |
| Consentement et texte | `app/settings/privacy.tsx`, `components/legal/PrivacyPolicyContent.tsx`, `services/userService.ts`, `analytics-events.md` |
| Analytics serveur | `functions/src/lib/analytics.ts`, `functions/src/config/firebase.ts`, appel de suppression dans `functions/src/callable/users.ts` |
| Notifications client | `hooks/useNotificationSetup.ts`, `hooks/__tests__/useNotificationSetup.test.tsx`, token/logout de `store/authStore.ts`, méthodes de `services/userService.ts` |
| Notifications serveur | `functions/src/utils/notifications.ts`, `functions/src/scheduled/savedSearches.ts`, `functions/src/triggers/swaps.ts`, nouveaux `functions/src/utils/expoPush.ts` et `functions/src/scheduled/expoPushReceipts.ts`, export de `functions/src/index.ts` |
| MVP | `config/featureFlags.ts`, `app/settings/help.tsx`, `app/shop/[id].tsx`, `app/shop/upgrade.tsx` |
| Contrats et vérifications | `firestore-schema.md`, `CODEBASE_INDEX.md`, `package.json`, `functions/package.json`, configurations Jest/Vitest/TypeScript, types SDK PostHog installés |

## Défauts confirmés et changements

Le SDK PostHog était construit avec autocapture lifecycle avant la lecture du
refus local ; l'identification du compte ne synchronisait pas son refus et le
collecteur serveur ne consultait aucun choix. L'initialisation attend désormais
la préférence locale et celle du compte. Les captures, écrans et identifications
ont une garde synchrone ; la préférence compte est relue lors de l'hydratation et
du rafraîchissement. L'identité du prochain compte est préparée pendant la
suspension, avant toute reprise de capture. Le cache hors ligne ne peut pas
annuler un refus local récent. Une erreur de lecture locale conserve le blocage.
L'autocapture SDK est désactivée ; seuls `Application Opened` et
`Application Backgrounded` sont émis au travers de la garde. `Installed` et
`Updated` ne sont plus émis et le catalogue le précise. Un refus prend effet
localement avant toute écriture asynchrone ; une réactivation depuis les réglages
attend la persistance serveur. Le bouton est désactivé pendant la mutation.

Le collecteur serveur relit `users/{uid}.preferences.analyticsConsent` pour
chaque événement, sans cache de consentement. Refus, document supprimé ou erreur
de lecture : pas de capture ; aucune erreur ne bloque le parcours métier.
L'absence du champ sur un compte existant conserve le modèle produit opt-out
actuel. Le texte explique l'identifiant stable pseudonyme, le pseudo public
éventuel, PostHog et le lieu de traitement par défaut. Il ne promet plus
l'anonymat et n'établit aucune conformité juridique.

Les tokens APNs iOS bruts étaient rejetés par le client ; aucun transport ne
permettait un envoi iOS. iOS obtient désormais un token Expo avec le `projectId`
EAS configuré, stocké dans `expoPushTokens`. Android conserve FCM. Le refresh APNs
renouvelle le token Expo ; le logout retire le token de sa collection de
transport. La permission refusée n'enregistre aucun token. Les envois serveur
partagés passent par FCM pour Android et par l'API Expo pour iOS, avec deep link
canonique et compteur badge serveur. Le choix global et les catégories de
notifications restent appliqués. Swaps et recherches sauvegardées utilisent ce
même chemin ; `swap_proposed`, non reconnu par le routeur, devient `swap_update`.
Une erreur FCM après création in-app/acceptation Expo ne demande pas au caller de
recréer le même encart.

Les tickets Expo sont conservés dans `expoPushReceipts`, collection serveur
fermée aux clients par le refus par défaut des règles. Le job toutes les 15 min
vérifie les reçus après le délai recommandé. Seul `DeviceNotRegistered` confirmé
supprime un token ; panne, résultat inconnu et erreur de credentials ne
suppriment pas un token valide. Les tickets inconnus sont relus jusqu'à 24 h,
puis supprimés avec journalisation. Les acceptations de gateway ne sont pas
présentées comme une livraison sur appareil. Le schéma et l'index du dépôt
mentionnent les nouveaux fichiers/champs.

La FAQ décrit la remise locale, les règlements convenus lors de la rencontre et
l'indisponibilité du porte-monnaie et des bordereaux. L'entrée « Gérer mon
forfait » est masquée sous `PAYMENTS_ENABLED=false` ; une navigation directe vers
l'upgrade affiche la disponibilité actuelle sans montant, bouton de paiement ou
requête de boutique. Le handler d'achat vérifie aussi ce drapeau. Aucun tarif,
commission ni règle économique n'est modifié. La politique financière serveur
commune appartient au lot finance.

## Matrice de parcours

| Parcours | Examiné | Corrigé | Testé | Limites |
| --- | --- | --- | --- | --- |
| Démarrage avant consentement, refus local/compte, erreur AsyncStorage | Oui | Oui | 6 tests client (capture/écran/identity/lifecycle) | SDK mocké, aucune transmission PostHog réelle |
| Changement/rafraîchissement du compte, cache offline et refus récent | Oui | Oui | Garde de suspension + auth-store | Cache offline contrôlé par le code ; pas de simulation appareil hors ligne |
| Refus analytics serveur et retrait sur fonction chaude | Oui | Oui | 4 tests serveur | Firestore et SDK mockés ; écritures live non exécutées |
| Permission push, token iOS/Android, refresh APNs, logout | Oui | Oui | 16 tests hook + 18 tests auth-store | Appareil iOS/Android absent |
| Payload, routes, badge, opt-out notifications, panne FCM après Expo | Oui | Oui | 5 tests transport partagé + 18 tests deep links | Gateways/Admin entièrement mockés |
| Tickets Expo, taille 100, reçus confirmés/inconnus/credentials | Oui | Oui | 8 tests helper | Aucune livraison ni exécution scheduler cloud réelle |
| Notification de swap / recherches sauvegardées | Oui | Oui | Payload transport partagé | Job complet de matching et trigger sur émulateur non exécutés dans ce lot |
| FAQ et upgrade boutique pendant MVP gratuit | Oui | Oui | Lecture du code et lint/typechecks | Pas de capture visuelle ni de test tactile |

## Vérifications

- Vitest app ciblé : `npx vitest run lib/analytics.test.ts` — **6/6**.
- Functions ciblées : `npx vitest run src/lib/analytics.test.ts src/utils/expoPush.test.ts src/utils/notifications.test.ts src/utils/notifications.delivery.test.ts` — **35/35**, quatre fichiers.
- Jest : `hooks/__tests__/useNotificationSetup.test.tsx` — **16/16** ; `tests/jest/auth-onboarding/authStore.test.tsx` — **18/18**.
- `npx tsc --noEmit` app et Functions — **passés** après intégration du lot.
- ESLint ciblé sur les fichiers client modifiés — **passé**, avertissements d'import inutiles de la FAQ supprimés.
- `git diff --check` — **passé**.
- `npm run lint:boundaries` — échoue à cet instant sur `utils/sellCatalog.test.ts:4` (autre lot : shared → features). Signalé à l’orchestrateur ; aucun nouvel import interdit dans ce lot. Le rapport global doit consigner le résultat après correction.
- Le garde Firebase de tests a correctement rejeté la suite ancienne de deep links qui importait Admin sans mock. Le test purement de routage a reçu un mock explicite ; le garde n'a pas été réduit et la suite passe ensuite.
- Aucun E2E appareil, capture caméra/gestes, réseau PostHog ou push réel exécuté. Les suites globales sont consignées dans le rapport d'intégration du parent.

## Prérequis et risques restants

La delivery iOS exige une application signée avec `expo-notifications`, son
identifiant EAS et des credentials APNs utilisables dans le projet EAS. Le
`projectId` est présent dans la configuration ; les credentials et la réception
sur appareil ne sont pas vérifiables ici et n'ont pas été changés. Le serveur et
le scheduler de reçus nécessiteront un déploiement ultérieur autorisé ; rien n'a
été déployé. L'API Expo utilisée accepte les requêtes non authentifiées dans sa
configuration standard ; si le propriétaire active la sécurité Expo Push, un
canal de credentials serveur approuvé devra être configuré avant envoi. Aucun
nouveau secret n'est requis ou manipulé par cette branche.

Une acceptation Expo n'est pas une preuve de réception par l'utilisateur. Les
échecs transitoires d'envoi sont journalisés sans destruction de token ; il n'y
a pas de nouvelle queue générale de re-envoi des notifications dans ce correctif.
Les tickets attendent la réconciliation ; il faut vérifier les logs du scheduler
et la volumétrie lors d'une validation staging ultérieure.

Le profil PostHog historique n'est pas automatiquement supprimé par la
suppression du compte Firebase. Le document compte ayant déjà été retiré,
`account_deleted` est maintenant conservativement supprimé par le collecteur.
Une éventuelle suppression des profils historiques relève d'une action externe
séparée du propriétaire. L'anonymisation, les durées réelles de conservation et
les autres engagements de la politique de confidentialité ne sont pas validés
juridiquement par ce lot.

Références techniques primaires consultées : [Expo setup](https://docs.expo.dev/push-notifications/push-notifications-setup/), [Expo transport et reçus](https://docs.expo.dev/push-notifications/sending-notifications/), types livrés par `posthog-react-native@4.54.4` (optIn/optOut asynchrones).
