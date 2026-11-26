# Passation — 26 novembre 2026, V1 corrigée soumise aux stores

## Où en est le travail

✅ Le code final est testé et poussé : **a4e833825810aee46b72e3bc8c85ba9198bd8e52**, branche `codex/v1-local-qa-20261125`, dépôt Aurelienrouchy/Second. Le checkout de publication est `/tmp/seconde-v1-git-release-20261125` (SDK57). La racine `/Users/aurelien/dev/Second` reste SDK56 pour préserver le Metro utilisateur8081. Ne jamais copier son runtime vers le candidat, ni pousser/reset main.

✅ La V1 de test est installée sur l’iPhone physique (client Dev SDK57/Hermes.17, mise à jour sans effacement). Recherche, favoris, galerie, brouillon, publication, édition, remise locale et Troc ont été exercés. Sur le dernier code : vendu→Accueil absent, remise en vente→Accueil présent, retrait→Accueil absent, sans rechargement et avec l’ancienne ligne vendue préservée. Voir la preuve native et ses limites ci-dessous.

✅ Prod est à jour :20 fonctions du catalogue ont été corrigées et vérifiées. Les95 autres fonctions phase1,77 services historiques fermés et17 anciennes tâches en pause sont conservés. Rafraîchissement du26novembre à18:19:51UTC : aucun écart sur192 fonctions, IAM, contrôles, règles ou index. Aucun déploiement serveur supplémentaire n’était requis pour le dernier correctif de cache.

✅ iOS **1.0.2(42)** est **WAITING_FOR_REVIEW**. Le build42 est attaché et valide, l’ancien35 est retiré. Examen0314e670-9478-4d40-9776-7aeb93af2427 ; publication `AFTER_APPROVAL`. Preuve : `APPLE42_REVIEW_SUBMISSION_READBACK.json`.

✅ Google **1.0.2(21) est en cours d’examen**. À18:46:43UTC, les vérifications rapides sont terminées et le message confirme « Vos modifications sont en cours d’examen ». La seule modification de production est21,17 est exclu et19 reste seulement dans la bibliothèque. Publication gérée désactivée et déploiement100% après approbation. L’erreur transitoire5DC56788 n’a pas provoqué de second envoi : le premier avait été accepté.16 reste live tant que Google n’a pas approuvé21.

✅ Cette passation et les preuves accompagnent le code dans la branche de publication. Toutes les actions de publication autorisées sont réalisées. Seules les validations externes des stores restent attendues ; ne jamais annoncer42/21 LIVE sans constat.

Commits utiles : f7cde982 (V1),4d6ff92a (photos/brouillons/prix),2d21bae8 (preuves mémoire),17d8b315 (SDK57),4bea3d0a (catalogues/profil absent),a4e83382 (caches de disponibilité).

## À lire en priorité

Rapports dans `_audit-reports/v1-local-qa-2026-11-25/` :

| Fichier | Ce qu’il établit |
|---|---|
| `IPHONE_SDK57_FINAL_OBSERVATIONS.json` | Gestes physiques observés,11 captures sûres, quatre SHA du code et limites des replays |
| `WITHDRAW_CACHE_FINAL_APP_CHECKS.json` | Résultats réels des suites app complètes |
| `WITHDRAW_CACHE_HYBRID_PRODUCTION_COMPILED_ARTIFACT_PROOF.json` |8 contrôles statiques réussis par plateforme, sans prétendre à une exécution des binaires Prod |
| `APPLE42_REVIEW_SUBMISSION_READBACK.json` | État Apple réel :42 attaché, attente d’examen, publication après approbation |
| `GOOGLE21_FINAL_REVIEW_READBACK.json` | Google21 en cours d’examen, vérifications rapides terminées |
| `PRODUCTION_METADATA_REFRESH_20261126T181951Z.json` | Dernier état Prod lu à18:19:51UTC, sans mutation ni lecture de comptes |
| `WITHDRAW_CACHE_CLIENT_ERASURE_INVARIANTS.json` | Invariants du nouveau client, archives et cohortes serveur ; preuve compilée séparée |
| `CATEGORY_PRODUCTION_DEPLOYMENT_VERIFICATION.json` | Déploiement ciblé,20 vrais ZIP/revisions et172 autres fonctions préservées |
| `CATEGORY_PRODUCTION_WRITER_PROVENANCE_SUPPLEMENT.json` | Cohortes115 et distinction entre nouveaux20writers et moteurs d’effacement conservés |
| `DEV_NATIVE_QA_LOG_CHECK_20261126T173943Z.json` et `METRO_USB8094_FINAL_LOG_ADDENDUM.json` | Logs Dev bornés et correction du chemin du Metro final |

## Baseline de santé

Sur le candidat final : typecheck app, frontières et diffcheck réussis. **Jest :224 suites/2218 tests/0 échec/0skip/openHandles[]/sortie normale0. Vitest :356 tests/33 fichiers/0échec/0skip/sortie0.** Ciblés :60Jest+19Vitest, également réussis. Bruts privés : `final-availability-{jest,vitest}.json/log` dans le dossier canonique ci-dessous. Ne pas répéter ces tests sans modification ou nouveau problème.

Backend inchangé par le commit de cache : précédent ciblé catalogue253 tests/5 fichiers, typecheck/build réussis. **La suite backend globale était historiquement rouge** (fixtures swaps.addItem counterfeitStatus) : ne pas la déclarer verte. Les règles401 et SDK32 sont des qualifications historiques. Doctor21/21 et installcheck en ligne ont été exécutés sur17d8, dépendances identiques depuis. Tout nouvel écart doit être attribué et investigué ; distinguer les défaillances héritées.

## Ce qui reste à faire

1. Avant une reprise, vérifier le git log/status et le remote de cette branche. Le commit documentaire contient seulement les rapports et captures sûrs ; la source expédiée restea4e.
2. Pour une reprise après ce commit, contrôler le git log/status avant toute nouvelle action. Les deux demandes sont soumises : ne pas renvoyer, retirer ou reconstruire sans motif nouveau.
3. Attendre les validations externes. Publication automatique après approbation des deux côtés. Aucun nouveau consentement utilisateur ni déploiement nécessaire en l’état.

## Artefacts et provenance

Dossier privé canonique : `/tmp/seconde-v1-withdraw-cache-release-20261126`.

- IPA `ios-production-local.ipa` :50 441 220 octets, SHA `57c5e8ed02e5ded6a8412cf56b92f8fdb1f765f214bf7953054f4dc73bc72d81`, version1.0.2(42).
- AAB `production-2bae2621-c5ea-4064-8bca-a49e0ab312a2.aab` :143 662 725 octets, SHA `5c876a313d14d5bff6ff0520538f566efb03cfaf3194606c53786cd94974da4b`, version1.0.2(21).
- Preuve compilée finale SHA `b3b12c4248f43ec0f67dd007d8c341fa7b3f94a8dfaf9044fc5d016f18471f72`. Root a rehashé les deux artefacts et relu les16 contrôles.58/58 ELF64bits alignées/congruentes16KiB ;34 exceptions32bits documentées ; ZIP Play final non certifié.
- QA source `feec8e907cd7a15f64737ea14fc7e11702ee5b6fc7d54c92612744a9b61f44cd`,1064 fichiers runtime. Source Prod `462d042b42ce42a9f0f96876b63be177ace0b5fc0213fe5b55b30f0cf87d8a0c`. Inventaire des2079 fichiers d’archives identiques : `c1b85e823f4452cb79c76d65578ff9ef1646afb6f649d321982e6ff40a55658b`.
- Archive canonique immuable SHA `2e789260b043a99d09614f2fbe8e24246bc5646d9ed12135032620f15515e293`. Source hybride SHA `fb038b698496451ca36bab48fa329d0a8749851226090278a5ad70c958894cb2` : un job cloud Android21 et un vrai build local iOS42, aucun UUID cloud iOS inventé.

Le quota gratuit iOS Expo a empêché le job40. Le premier essai local41 s’est arrêté avant compilation, à cause d’un conflit GEM_PATH entre Fastlane et CocoaPods. Le second essai42 a terminé normalement0 (session77105), après préflight des deux outils et séparation de leurs environnements. Aucun abonnement payant ajouté. Requête2 SHA `3a8ae212a82fe4bfe89a9b15af96464613bb5ddf17aa5bfc0604e19315bb79a5` ; reçu de fin SHA `ab77041bd2201d25b026d012aa0d325a3bf361fdca08a13b62b663bd69d1f59e`. Dossier de compilation et tar d’entrée supprimés, nettoyage des credentials constaté. Le wrapper n’a pas écrit de payload de credentials ni passé ce payload en argv ; EAS gère ses fichiers temporaires privés de signature.

Soumission EAS iOS94bcb77b-370e-4ca7-90ff-e96af6f59ea0 terminée à18:14:56.312UTC. Android2bae2621-c5ea-4064-8bca-a49e0ab312a2 terminé à18:19:17.121UTC. Les anciens37/18,38/19 et39/20 sont retenus ;40 n’a aucun job et41 aucune IPA. Ne jamais les envoyer en examen.

Apple app6757828492, versioned2f8189-8646-4d9a-b3f8-34e5f0a00497, build42 ID8b90880d-c660-4d21-acc9-ca4ec1e4bac0. Adaptateur réel : `/tmp/seconde-v1-production-release-20261125/replace-apple-local-ios.cjs`, SHA `62e745d6d609e3ddf2efbd57e69316ce14e9a9e9b827bf0dd2b232befd10c7e7`,122 gardes hors réseau réussis. Ready schema5 et journal présents dans ce même dossier ; prepare et les quatre mutations sont terminés, readback WAITING_FOR_REVIEW. **Ne plus muter Apple ni renouveler inutilement le Ready.** Utiliser seulement `--inspect` si un nouvel état est demandé. Accords Apple et âge16+ sont déjà autorisés/enregistrés.

## Pièges, sessions et limites

Les essais physiques utilisent `com.seconde.app.dev` sur Dev avec le même code final, **pas l’IPA signée Prod**. Aucun OAuth réel ni mesure mémoire longue n’est qualifié par les preuves statiques. Login11/11 est le seul replay physique complet déclaré. Les parcours83 étapes et disponibilité18 étapes sont observés/non rejoués ; SimA82 étapes et Android119/163 sont aussi des diagnostics, avec leurs waits échoués conservés.

Metro USB8094, session83613, log `metro-8094-final.log`, hostname169.254.147.79, reste disponible depuis le candidat. Ne pas toucher au Metro utilisateur8081. Ancien8094 arrêté130, serveur de logo8095 arrêté ;8093 partagé SDK57 conservé. Fichier temporaire de secrets Dev du successeur supprimé, source Root intacte.

Le premier rapport de logs final relisait l’ancien `metro-8094-usb.log` arrêté : l’addendum lit bien `metro-8094-final.log`. Cloud35 services17:00→17:38 sansERROR/index ; vrai Metro final32lignes sansERROR/index/Keychain,9 avertissements Reanimated. Un avertissement Android Commit unreadCount/updateTime a été tracé au réconciliateur transactionnel, protégé par une barrière et les retries du SDK. Aucun catch terminal/indexerror observé ; nombre exact de retries et valeur finale du compteur non mesurés.

La fixture physique398c5e2b3455c23352c8 est retirée ; l’ancienne Androidd3de77c864067cc9637a aussi. Le Troc `swap_15c23837e6142ff9f3497ac326b5389b83f9d035bdfcc4c9ab2fae58ae16d960` est terminé/évalué, ses articles A976d3a547293860e5d43 et B2a689db10205c5ae9c77 sont consommés/inactifs. Ne pas forcer leur remise en vente ni rejouer un retrait terminal. Anciens vendus préservés ; un seul logo public importé, aucune photo personnelle. Captures de photothèque/notifications restent privées.

Le Mac s’est verrouillé mais le flux Chrome DOM a fonctionné via un onglet frais. L’ancien1731993233 renvoie Debugger unattached ; ne pas insister dessus ni demander un déverrouillage tant que le nouvel onglet fonctionne. Aucun takeover manuel n’est en attente. Une ancienne demande de redémarrage des services SimA a été refusée par auto-review : aucun service iOS stoppé, ne pas réessayer.

Les agents peuvent se tromper : vérifier avant action, toujours avant suppression. tsc ne voit pas les mock strings/imports type/assertions UI, les vérifier après déplacement. Hooks laissés actifs ; pas de git destructif, reset, amend, force-push ou firebase--force. Ne jamais copier secrets/données Prod vers Dev. Aucun Datadog, Observe, OTA ou nouveau service annexe ajouté. Aucun Goal ni Automation de suivi de jobs créé.

## Décisions et exploitation

Aucune nouvelle décision fondateur requise. Autorisations tests/corrections/Prod/stores/push persistantes dans ce chat.

Le reçu d’effacement Prod3eb0e7fd3ed7d8c73a699f086e43a21fc62b96a3a2f66db3d339ad1a8c933fa4, génération1795696554296081, expire le25décembre2026 à22:55:33.429113UTC : point d’exploitation à suivre. Contrôle1795639824843632 normal/unconfigured. Client211 historique ne constitue pas une whitelist binaire ; moteurs3e, matrice800c, inventaire48d6 et registre2d8 conservés. Aucun renouvellement effectué ici.

## Skills et agents

Déjà appliqués : expo-deployment, upgrading-expo, expo-dev-client, second-handoff, guides Argent vendor et native-data-fetching. Réutiliser production_binary_verification pour les artefacts, sdk57_erasure_readiness pour Prod readonly, withdrawn_home_cache_fix pour un éventuel bug cache et v1_jest_repair pour l’adaptateur Apple. Tous leurs travaux sont terminés ; pas d’édition concurrente du candidat.

## Attente du fondateur

« Teste les flows sur l’iPhone », « consulte les logs », puis « commit et push » et publication de la V1. Les corrections, tests, push du code, mise à jour Prod et soumissions des deux stores sont faits. Répondre simplement : V1 de test sur l’iPhone, correctifs poussés, iOS42 en attente d’examen, Google21 en cours d’examen et publication automatique après approbation.
