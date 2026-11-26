# Mise à jour V1 — état du 26 novembre 2026

Le code corrigé est poussé sur `codex/v1-local-qa-20261125`, commit `a4e833825810aee46b72e3bc8c85ba9198bd8e52`.

| Plateforme | Version corrigée | État constaté |
|---|---|---|
| Apple |1.0.2(42) | WAITING_FOR_REVIEW ; publication après approbation |
| Google Play |1.0.2(21) | En cours d’examen ; vérifications automatiques terminées à18:46UTC |

Les deux binaires correspondent au même code testé. iOS a été compilé avec Expo localement après épuisement du quota cloud ; Android a été compilé par EAS. Les8 contrôles statiques par plateforme passent. Aucun abonnement payant ajouté.

La V1 de test a été installée et exercée sur l’iPhone physique. Les preuves distinguent les observations natives, le replay de connexion11/11 et les diagnostics non rejoués. Les binaires signés de production n’ont pas été exécutés sur ce téléphone. Tests app complets :2218Jest et356Vitest, tous réussis ; typecheck et frontières réussis.

Les correctifs couvrent les photos/brouillons, les prix, les catégories et l’actualisation des cartes après retrait, vendu/remis en vente et Troc terminé. Prod est à jour et a été relu sans écart à18:19:51UTC. Aucun défaut d’index n’a été retrouvé dans les fenêtres de logs consultées ; les avertissements et limites sont conservés dans les rapports.

Références actuelles : `IPHONE_SDK57_FINAL_OBSERVATIONS.json`, `WITHDRAW_CACHE_FINAL_APP_CHECKS.json`, `WITHDRAW_CACHE_HYBRID_PRODUCTION_COMPILED_ARTIFACT_PROOF.json`, `APPLE42_REVIEW_SUBMISSION_READBACK.json`, `GOOGLE21_SUBMISSION_READBACK.json`, `GOOGLE21_FINAL_REVIEW_READBACK.json` et `PRODUCTION_METADATA_REFRESH_20261126T181951Z.json`.

Les preuves des versions précédentes sont historiques. Les builds37/18,38/19 et39/20 restent hors examen ; aucun job iOS40 ni IPA41 n’existe. Le build35 Apple a été remplacé, et17 n’est pas inclus dans la nouvelle release Google21.
