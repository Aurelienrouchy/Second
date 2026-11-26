# V1 corrigée — état de publication au 26 novembre 2026

Les derniers correctifs sont gelés dans la source QA `95b0942d120da4e6f596fd14cabbde12b07d376b19738482dacea0574b336a6b`. Ils ne sont pas encore dans un nouveau binaire store. Le commit/push et les nouveaux builds suivent la fin de la recette iOS du dernier delta. Le précédent commit poussé est `f7cde9825e0b29a55808b3d7a4b0da2863c18041` sur `codex/v1-local-qa-20261125`.

Les trois problèmes natifs trouvés pendant la recette sont corrigés : perte de photo au retour de galerie Android, double confirmation sans sortie réelle, et sauvegarde du prix lors du retour. Le delta runtime couvre seulement cinq fichiers du parcours de vente. Les anciennes preuves0454 et2c sont conservées comme historiques avec leurs échecs ; elles ne sont pas requalifiées en succès95b.

| Élément | État observé |
| --- | --- |
| Tests automatisés | Root sur95b : Jest224/224suites,2208/2208tests,0échec/0ignoré,sortie0/openHandlesvides ; Vitest329/329 dans31fichiers ; appTypeScript et frontières0. Typecheck étendu tests :104diagnostics hérités, pas globalement vert. Voir APP_FINAL_SELL_VERIFICATION.json. |
| Android natif95b | Photo persistante, sortie unique et reprise du brouillon, prix sauvegardé via retour matériel, publication12CAD, modification13CAD, vendu/remis en vente, retrait de la seule annonce de test et ancien lien indisponible. Rapport final/logs en cours de gel. |
| iPhone réel | Recette principale et effacement terminé7/7, suivi invité après deux redémarrages et correction de réouverture de connexion vérifiés sur clients antérieurs. Derniers changements communs95b en cours de smoke iOS ; iPhone appairé sans tunnel, reconnect demandé. Pas de recette physique du binaire store Prod prétendue. |
| Serveur Prod |115fonctions actives,26mises à jour/créées et89conservées ; index manquant de l'historique corrigé.77anciensservices fermés et17tâches suspendues conservés. |
| Suppression des comptes Prod | Accord ciblé reçu puis configuration appliquée : reçu privé3eb0e7fd… génération1795696554296081, GET exact au seul runtime existant et5références actives. Expiry25décembre22:55:33UTC inchangée.115profils/sources vérifiés et110autresrévisions inchangées. Logs bornés ERROR0. Aucun effacement métier Prod exécuté pour cette vérification. Voir PRODUCTION_ERASURE_PUBLICATION_COMPLETED.json. |
| Apple | Ancien35 retiré de l'examen après accord : version1.0.2 DEVELOPER_REJECTED, ancienreview COMPLETE/itemREMOVED. Lecture fraîche13:21UTC : releaseType AFTER_APPROVAL, donc publication automatique après acceptation déjà réglée.36valide mais obsolète/non attaché ; ne pas l'envoyer. Nouveau37 attendu, pas encore construit. |
| Google | Lecture Console fraîche :17 CorrectionsV1 encore non envoyé, une modification prête pour examen, publication gérée désactivée. Ancien16 publié25novembre. Nouveau18 attendu pour remplacer17, pas encore construit. |
| Artefacts | Les preuves PRODUCTION_ARCHIVE_PROOF.json et PRODUCTION_COMPILED_ARTIFACT_PROOF.json concernent uniquement les anciens36/17/f7. Nouveau complément archives/IPA/AAB obligatoire après build95b ; ne pas modifier la provenance211 ni le reçu3eb historique. |

Les connexions Apple et Google réelles sur l'iPhone restent non certifiées. La couverture des117identifiants, dont variantes non exécutées nativement, reste dans COVERAGE_AND_LIMITS.md. Les résultats automatisés ne valent pas preuve de gestes natifs. Aucun nouveau service de monitoring n'est ajouté.
