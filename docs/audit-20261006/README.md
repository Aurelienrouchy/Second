# Audit et corrections Seconde — 6 octobre 2026

Les défauts confirmés fournis dans le mandat ont reçu des correctifs locaux et des tests ciblés. Le MVP reste local et gratuit : aucun paiement, livraison ou forfait n'a été activé, aucun tarif n'a changé. Les règles Firestore et les deux tests de concurrence SDK réelle passent désormais sur un serveur officiel local. Storage reste bloqué par son binaire officiel ; caméra, gestes, push et rendu natif nécessitent un appareil. L'export web et trois contrôles Chromium de la page statique passent avec captures. Ce résultat n'est pas une certification de sécurité ni une revue exhaustive de chaque fichier/parcours.

## Base, branche et limites d'autorisation

- Dépôt : `Aurelienrouchy/Second`, workspace `/workspace/Second`.
- Branche initiale : `work`, arbre propre, HEAD `b79d0c8e47a18ec9b405b13e8229a63f5ef02980`, exactement la base `main` demandée. Le nom local initial était `work` ; aucune affirmation sur un déplacement ultérieur du main distant.
- Branche locale dédiée : `audit/seconde-security-ux-20261006`, commits locaux uniquement.
- Série organisée par domaine dans [commits.md](commits.md). Code testé : `617ec865d8414a39abd9ba25fa58900eb13150c8` ; le dernier commit de documentation ajoute les rapports sans changer ce code.
- Aucun push, PR, merge, déploiement, paiement réel, changement de compte externe, rotation de secret ou réécriture d'historique distant. Les SDK/gateways des tests unitaires sont mockés. Les builds d'audit pointent sur `demo-second` et les émulateurs.
- `AGENTS.md` absent après recherche ; instructions lues dans `CLAUDE.md`, les guides RN/Expo et Firebase backend et les SKILL.md locaux pertinents aux lots. Les anciennes consignes de déploiement du dépôt ne s'appliquent pas au mandat interdisant tout déploiement. Six lots indépendants, intégration et validation finales uniques.
- Node `24.19.0`, npm `11.9.0`, Java 21 ; moteur Functions déclaré Node 20. Tests exécutés sur Node 24, sans validation du runtime cloud Node 20. Dépendances des lockfiles installées par `npm ci` depuis `https://registry.npmjs.org`, caches sous `/tmp` ; aucun lockfile modifié.

## Couverture attestée

[file-inventory.json](file-inventory.json) inventorie les **1 844 entrées** de l'arbre Git audité : **1 716 fichiers blob et 128 symlinks**. Il fournit chemins, tailles, domaines et classification des fichiers modifiés/retirés. Un inventaire de métadonnées n'atteste pas une lecture manuelle du contenu. Les SKILL.md sans lien avec la tâche n'ont pas été appliqués.

[routes.md](routes.md) mappe les **76 fichiers TSX d'app**, dont 7 layouts : 17 fichiers de routes directement corrigés, d'autres contrats associés examinés, et les autres routes explicitement marquées inventoriées/compilées sans revue manuelle intégrale attestée. Le typecheck et les bundles portent sur le code app ; les assertions portent sur le périmètre propre de chaque suite. Aucun parcours E2E natif complet n'est revendiqué.

Les rapports de lots donnent les fichiers effectivement examinés, scénarios corrigés, tests et limites : [vente](sell.md), [articles/recherche/profil](articles.md), [offres/rencontre](offers.md), [médias/règles/favoris](media-rules.md), [finance](finance.md), [consentement/notifications/MVP](privacy-notifications.md). [automated-scan.json](automated-scan.json) est un scan syntaxique intermédiaire de littéraux, sans valeur secrète reproduite et sans verdict de sécurité. [maestro-syntax.json](maestro-syntax.json) atteste uniquement le parsing de 19 YAML : 18 flows/subflows et une configuration.

La seconde revue indépendante a identifié 15 constats supplémentaires, corrections d'intégration ou défauts conservés de la base. Leur résolution, preuves et limites sont dans [review-resolution.md](review-resolution.md). Les nouvelles références privées, l'isolation UID des futurs brouillons locaux et le respect du site statique sont détaillés dans [private-media.md](private-media.md), [private-drafts-ai.md](private-drafts-ai.md) et [web-platform.md](web-platform.md). [ux-validation.md](ux-validation.md) sépare pour chaque demande UX les fichiers modifiés, tests ajoutés et contrôles encore nécessaires sur appareil.

## Matrice des demandes et constats confirmés

| Demande / défaut | Correctif local | Preuve ciblée | Non vérifié / restant |
| --- | --- | --- | --- |
| Matières A–Z et fond Zone de Meetup | Tri français sur libellés, surface input/footer cohérente | Tests référentiels, relecture/typecheck | Aspect sur appareil |
| Caméra frontale, torche et reprise erreur | Sessions remount, délai readiness/erreur/retry, torche arrière désactivée en frontal, galerie accessible | Tests hook/capture/permission | Capteur iOS/Android, permissions et interruptions natives |
| Réordre libre des photos et brouillon | Déplacements adjacents permettent toute permutation ; paires photo/URL conservées, sauvegardes ordonnées et reprise | Tests vente/brouillon/réordre | Navigation tactile et fichiers réels |
| Zoom/carousel | Zoom par photo, pinch cumulatif, pan borné, double toucher, swipe à échelle initiale, index/navigation synchronisés | Jest galerie + géométrie | Reconnaissance native des gestes et rotation |
| Photos profil et onglets Articles/Avis | Normalisation legacy/objets/fallback, première image valide côté serveur, liste/header conservés, offsets distincts | Jest grille/onglets/profil, Functions images publiques | Virtualisation et rendu sur grands profils |
| Like affichant 0 | onDocumentWritten ; comptage transactionnel de la source live, accusé privé ; optimisme UI jusqu'à confirmation | Functions création/replay/ordre/multi-acheteur + Jest hook | Trigger mocké ; règles Firestore réelles passées ; historique au repos non backfillé |
| Photo à l'étape lieu et propositions répétées | Rappel compact titre/photo ; prix retiré du header personne ; lieu dans carte structurée | Jest composants/services, lecture code | Pas de capture visuelle ; rappel compact retenu sans test utilisateur |
| Choix de lieu | Suggéré/personnalisé/à convenir : Continuer → récapitulatif → envoi distinct | Jest modale + callables | Parcours natif |
| Offres successives/doubles clics/multi-acheteurs | Une pending par acheteur/article ; remplacement annoncé/atomique ; clés de replay ; acceptation unique article + liens exacts | Functions offre/accept/rejet/expiration/trigger, Jest service | 2 tests SDK réels passés ; UI appareil et réseau externe non vérifiés |
| Ancien refus et ancien accord | Refus sans mutation d'accord ; aucune réécriture de termes acceptés ; adoption legacy seulement exacte/non acceptée | Tests réponses périmées/termes différents ; verrou dans products | Données historiques contradictoires à réconcilier explicitement |
| Credentials et document interne publics | `credentials.json` et `ROADMAP_SECONDE_DRAFT.md` retirés ; ignore ajouté ; aucune valeur reproduite | Vérification présence/clé, inventaire Git | Secret dans ancien historique : rotation et traitement historique par propriétaire |
| Storage trop ouvert, preuves modifiables | Propriétaire article ; participants chat/swap ; nouveaux chemins UID, create-only et bornes fichier | Tests inter-comptes/overwrite/delete ajoutés | Rules Firestore passées ; Storage runtime bloqué ; anciens liens tokenisés restent bearer. Nouveaux flux privés via SDK authentifié, sans distribuer de token |
| Médias IA expirant après publication | Promotion serveur drafts/products → articles ; édition via callable ; cleanup protège références legacy publiées, âge invalide/faille lecture fail closed | Tests médias et âges 13/15/90 j ; services client | Migration historique, coût scan références, copies orphelines possibles |
| Suppression isSold/champs serveur et engagements | Toutes écritures article réservées au serveur ; champs éditables filtrés et garde transactionnelle sur engagements, y compris legacy sans lien | Tests products/live statuses/unresolved link + rules réels | Rules Firestore et contention SDK passées ; transactions Storage/Firestore non atomiques |
| Messages system forgés | system/offers réservés serveur ; anciennes écritures client supprimées, reçus limités destinataire | Jest chat + règles ajoutées | Messages historiques non nettoyés ; migration anciens clients |
| Pagination sautant des annonces | Curseur après dernier document consommé, lookahead, plafond de scan avec continuation correcte | Exhaustivité, doublons, filtres sélectifs, pages finales et lectures bornées | Index/latence/facturation Firebase réels |
| iOS APNs non exploitable | Transport Expo iOS, FCM Android ; consentement/token logout ; tickets/reçus serveur | Tests hook/auth/transport/reçus | Credentials APNs/EAS et réception appareil, scheduler non déployé |
| Paiements cachés seulement dans UI | Garde serveur OFF commune pour nouvelles opérations shipping/wallet/retraits/forfaits/suppléments ; régularisations conservées | Tests phase avant toute mutation | Aucun lancement autorisé ; accords/charges historiques non audités live |
| Double compensation wallet | Tentative réservée et transition atomique unique ; réponse ancienne/inconnue ne compense pas aveuglément | Courses/replays et erreurs Stripe mockées | Résultats inconnus nécessitent rapprochement opérateur |
| Payout Stripe sans identifiant persisté | Inconnu distinct du rejet ; réserve maintenue ; lookup exact/borné avant compensation | Tests payout/network/persist/reconcile/retry | Payouts historiques et consultation externe non effectués |
| Dette vendeur recréée à livraison | Crédit pending net séparé du brut de responsabilité ; transition held/release au crédit réellement déplacé, lecture ledger legacy et maintien des fonds sans preuve | Tests conservation/sous-financement/held indépendant/remboursements/machine d'états | Anomalies historiques réelles non corrigées automatiquement |
| Boutique → tous articles | sellerId=ownerId ; anciens shopId résolus sans requête globale ; tri récent cohérent | Jest scope/hook | Données/navigation réelles |
| netMargin omet transport | Recette transport + coût réel/estimé séparés, autres coûts et taxes identifiés | Tests montants/marge | Aucune modification tarifs/règles économiques |
| Analytics avant hydratation/refus serveur | Garde synchrone, hydration local+compte, lifecycle explicite ; refus serveur relu, libellé pseudonyme | Tests analytics client/serveur/auth | Historique PostHog, rétention et conformité juridique hors validation |
| Autocomplete et tailles divergentes | Validation adresse commune ; catalogue JSON partagé app/onboarding/Functions | Tests adresse et parité | Sorties IA complètes et référentiel géographique réel non certifiés |
| FAQ/boutiques payantes hors phase | Texte remise locale gratuite ; upgrade inaccessible à l'achat et sans requête payante | Relecture/types/lint + garde serveur | Validation visuelle non faite |

## Vérifications finales

Les logs complets locaux résident sous `/tmp/second-final-*.log` ; [verification.json](verification.json) fournit les commandes, exit codes, résultats et empreintes des logs ; [source-manifest.json](source-manifest.json) identifie les fichiers de code/config/tests modifiés et leur SHA-256. Les validations de première passe sont conservées comme contexte dans les rapports de lots ; la table et les empreintes ci-dessous portent sur la seconde intégration finale. Les tests financiers utilisent des doubles stricts ou des gateways mockées ; les deux tests offres désignés utilisent les vraies transactions Admin sur l'émulateur.

| Contrôle | Résultat final |
| --- | --- |
| `jest --runInBand --detectOpenHandles` | 91 suites, **735/735 passent**, exit 0, sortie normale sans forceExit |
| Vitest app | 15 fichiers, **118/118 passent**, exit 0 |
| Vitest Functions | 51 fichiers, **608/608 passent**, exit 0 ; deux tests SDK réels inclus, aucun ignoré |
| Typecheck app / tests / Functions | Tous passent, exit 0 |
| Lint Expo | 0 erreur, **93 avertissements**, exit 0 |
| Lint frontières | Passe, exit 0 ; test parité tailles déplacé dans sa feature, sans suppression de règle |
| Rules Firestore | 12 fichiers, **185/185 passent**, exit 0 ; mode partiel explicite |
| Rules Storage et accès HTTP privés | **Non exécutés** : téléchargement runtime officiel bloqué HTTP403 CONNECT ; aucune réussite du contrôle complet revendiquée |
| Maestro | **Non exécuté** : CLI, ADB, Xcode/appareil absents ; parsing 19 YAML passe (18 flows/subflows + configuration) |
| Export Metro iOS + Android, demo-second, offline | Passe, exit 0 ; bundles Hermes et assets dans `/tmp/second-mobile-audit` ; aucun build signé ni rendu appareil |
| Export Metro web | Passe, exit 0 ; adaptateur Stripe + entrée web respectent la page statique intentionnelle, sans monter le marketplace |
| Navigateur local Chromium | 3 scénarios passent (accueil desktop, deep link article avec query, accueil largeur mobile), zéro erreur JS, aucun appel externe tenté ; captures dans captures/ |
| `git diff --check` | Passe |

Les résultats CI `run33321090058` fournis par le mandat ne sont pas présentés comme une CI distante réexécutée. Les assertions/mocks ont été alignés sur le comportement attendu : erreurs non critiques de recherche, messages français, payload notifications, contexte auth des gates, phase financière OFF et accord meetup serveur. Aucune suppression de test pour rendre les suites vertes. Un timeout AdminRejectionModal observé pendant une validation très parallélisée a passé isolément puis dans la suite finale, sans modification de son assertion. Les fixtures profil/home et wallet libèrent désormais leurs caches/timers après démontage ; pas de `--forceExit` ni de réduction du cache produit.

## Actions réservées au propriétaire et limites avant livraison

1. **Credential publié** : le retrait est fait sur cette branche ; les commits anciens restent inchangés. Le propriétaire doit décider la rotation/révocation et le traitement de l'historique/expositions. Aucune valeur, détail personnel du document retiré ou secret ne doit être repris dans les échanges.
2. **Storage et appareils** : règles Firestore et concurrence réelle validées localement. Installer normalement le runtime officiel Storage puis exécuter les tests inter-comptes et accès HTTP ; tester les flows Maestro sur deux comptes/appareils. Vérifier caméra/galerie/profil/rencontre sur iOS et Android, puis push avec credentials approuvés. Trois captures de la page web statique sont disponibles ; aucune capture de l'app native.
3. **Migration coordonnée ultérieure** : nouvelles callables, règles et clients doivent être livrés ensemble après autorisation. Les anciens clients écrivant articles/offers/system directement deviennent incompatibles avec les règles renforcées. Ne pas déployer seulement les règles ; aucune livraison n'a été effectuée.
4. **Historique et capacités URL** : les règles SDK n'invalident pas les URLs `alt=media` tokenisées déjà distribuées. Révocation/migration des anciennes preuves/chats/drafts et promotion des médias legacy exigent une action séparée ; le cleanup les protège actuellement. Les nouveaux brouillons locaux sont isolés par UID ; l'ancienne clé globale et ses fichiers restent intacts, sans reprise automatique ni migration. Les anciennes références privées déjà partagées restent une limite distincte. Mesurer le scan de références et le volume des documents privés de replay/reçus avant une montée en charge.
5. **Finance historique** : réservations ou payouts inconnus restent réservés/alertés jusqu'à rapprochement, sans re-crédit automatique risqué. Les données financières réelles n'ont pas été consultées. Aucune dette historique ou économie n'a été réécrite ; les nouvelles opérations restent fermées.
6. **Analytics** : alignement technique/libellés, pas avis juridique. Profils et données PostHog historiques, suppression/rétention et autres engagements de confidentialité nécessitent validation du propriétaire.
7. **Couverture restante** : les autres routes sont identifiées dans routes.md, sans garantie de revue manuelle intégrale. Les avertissements de lint et le runtime cloud Node 20 restent explicitement consignés ; les suites vertes ne prouvent pas tous les parcours natifs.

## Reproduction sûre

Unitaires : `npm run test`, `npm run test:unit -- --runInBand`, puis `cd functions && ./node_modules/.bin/vitest run`. Les imports Firebase Admin non mockés en mode test échouent sans projet demo et les trois hôtes d'émulateur.

Règles : `npm run test:security` utilise explicitement `--project demo-second`. La CLI officielle de cette session est installée sous `/tmp/second-firebase-cli/node_modules/.bin`; `FIREBASE_EMULATORS_PATH=/tmp/second-emulators` et `XDG_CONFIG_HOME=/tmp/second-firebase-config` évitent les caches hors workspace. Le canal canonique `storage.googleapis.com` échoue au tunnel HTTP403. Le paquet Google Cloud officiel Firestore 1.22.0 a été téléchargé depuis `dl.google.com`, empreinte vérifiée et lancé localement ; [emulator-verification.md](emulator-verification.md) fournit la provenance et les commandes. Storage reste bloqué ; aucune source tierce ou production utilisée.

Tests SDK offres, exécutés dans cette passe avec Firestore local : `METADATA_SERVER_DETECTION=none GCLOUD_PROJECT=demo-second FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 ./node_modules/.bin/vitest run src/callable/offers.emulator.test.ts` depuis functions. Ils refusent un hôte non local/projet non demo.

Build app de test : `EXPO_PUBLIC_FIREBASE_EMULATORS=1`, hôte adapté à l'appareil (`EXPO_PUBLIC_FIREBASE_EMULATOR_HOST`) ; les URLs REST IA/Storage suivent aussi ce mode et ne reprennent pas le fallback canonique de production. Export utilisé : `CI=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 EXPO_NO_CACHE=1 EXPO_PUBLIC_FIREBASE_EMULATORS=1 ./node_modules/.bin/expo export --platform ios --platform android --output-dir /tmp/second-mobile-audit --max-workers 2`.
