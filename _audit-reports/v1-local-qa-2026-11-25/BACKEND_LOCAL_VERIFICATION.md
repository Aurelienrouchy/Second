# Backend V1 — vérifications locales du 25 novembre 2026

**Dernier état (26 novembre, 03:19 UTC) :** 449/449 tests ciblés dans 19 fichiers, sécurité 401/401 et cœur SDK 32/32. Dev contient 115 fonctions : 23 source DD, 89 source 6b et 3 source 3e3094 ; index historique DESC READY. Les deux effacements synthétiques autorisés ont réellement terminé 7/7 : Auth et profils absents, huit générations exactes absentes, deux annonces neutralisées, contrats et preuves privées conservés, pairs préservés. Voir BACKEND_ERASURE_NATIVE_POSTCONDITIONS.json et BACKEND_ERASURE_COMPLETION_DEV.json. **Le dernier écran physique P11 reste à relire par root après reconnexion USB** ; le dernier constat physique antérieur montrait 2/7. Aucun succès UI final ni exit0 du harness interrompu n’est inventé. Les sections suivantes conservent les jalons antérieurs datés.

Le travail local ne qualifie ni ne modifie la production/store 35/16. Le micro-lot Dev initial de 22, puis la cohorte finale de 24 fonctions autorisée par root, sont déployés et relus nativement : 24 ACTIVE, 91 autres fonctions phase1 et tous les autres endpoints existants conservés, IAM/paramètres/secrets vérifiés. Voir BACKEND_POSTAL_DEV_DEPLOYMENT.json et BACKEND_V1_FINAL24_DEV_DEPLOYMENT.json. Aucun Git stage/commit/push effectué par cet agent.

## Résultats réels

| Contrôle | Résultat |
|---|---|
| TypeScript functions + build avec registre | PASS |
| Plan additif strict | 5/5 PASS ; 36 aliases / 115 sélectionnées |
| Montage complet isolé Dev + rebuild predeploy | 115 métadonnées PASS, sources/compiled identiques, Montréal, mémoire >=512 MiB, runtime exact, aucun secret financier |
| Checkpoints V1 finaux, dont admission durable et favoris consommés | 386/386 PASS dans 16 fichiers ; vrai adapter natif, transport externe substitué seulement |
| Périmètre inclus dans les 386 | produits/offres/médias, payout refusé/unconfigured, boutique/admin, faits vendeur, lifecycle, chat déclaratif et trois suites triggers articles |
| Checkpoint initial cœur SDK | 22/22 PASS, 4 fichiers, vrais émulateurs demo-second |
| Élargissement courant SDK V1 | 6 fichiers / 32 PASS / 0 FAIL / 0 SKIP, vrais émulateurs ; inclut refus admission et révisions natives |
| Intégrations SDK complètes activées | 17 fichiers : 4 PASS / 13 FAIL ; 186 tests : 26 PASS / 160 FAIL / 0 SKIP |
| Sécurité Firestore/Storage/Auth | 401/401 PASS, 24 fichiers, vrais émulateurs demo-second |
| Dernière suite fonctions globale | 175 fichiers : 116 PASS / 59 FAIL ; 2 881 tests : 1 634 PASS / 1 061 FAIL / 186 non activés |

Les 186 non activés du run unitaire sont les 17 suites SDK. Elles sont activables explicitement par la commande du dépôt ci-dessous, avec leurs 11 opt-ins. Le run complet natif est conservé séparément ; les échecs ne sont pas masqués par le sous-ensemble cœur. Un premier passage cœur a produit une erreur Admin SDK « Transaction invalid or closed » sur la course offres ; le recheck et la commande portable ont ensuite donné 22/22. La trace initiale reste conservée, sans modification du runtime pour la masquer.

Baseline initiale : 173 fichiers, 105 PASS / 68 FAIL ; 2 763 tests = 1 333 PASS / 1 244 FAIL / 186 non activés. La hausse du nombre total provient notamment de fichiers auparavant non chargeables et des nouveaux tests postaux ; ce n’est pas un changement de dénominateur caché.

## Corrections

- Bug V1 de déduplication offres : nouvelle requestId avec les mêmes termes touchait le reçu sans checkpoint ; ajouté le checkpoint exact avant cette écriture, vérifié par handler/adaptateur réels et contention SDK.
- Bug V1 postal : le contrat local refusait les modes/états prévus par le produit. Trois transports V2 additifs, déclaration de photos/envois/réceptions sans prestataire ou argent ; participant, stock, termes gelés, witness, replay et injections vérifiés.
- Preuves postales : générations/CRC/MIME/taille natives figées côté serveur, révocation CAS des tokens et relecture des en-têtes privés ; URLs retournées sans token. Aucun nouvel upload public ni RPC client supplémentaire.
- Effacement postal : nouvel inventaire explicite ; les preuves exactes sont conservées sous la politique existante du contrat local (3 ans), les seuls orphelins de l’auteur sont supprimés. Le finalizer distingue génération contractuelle retenue et absence réelle. Objet absent/altéré, token présent, hold ou source inconnue interdisent une fin fictive.
- Fixtures : auth_time/current Auth natifs, claims administrateur exacts, dossier préalable aux flags, snapshots/révisions, contrats/stock produits réellement par les callables, exports Firestore partiels complets. Aucune garde de production supprimée. Les anciens libellés de chat prétendaient un état métier ; les attentes correspondent maintenant aux déclarations de participant déjà implémentées.

## Restes globaux

Les 1 061 RED ne sont pas déclarés tous hors V1. De nombreuses suites paiement/taxes/refund/shipping/Connect exigent désormais des preuves financières qu’anciennes fixtures ne fournissent pas ; ces rails restent fermés dans le profil V1. Restent aussi des fixtures de surface V1 (sold/stock/admission/absence/photos) avec ancien DTO ou source native absente. Elles restent visibles dans les logs globaux ; les checkpoints actuels correspondants ont leurs preuves dédiées ci-dessus. Cette note ne prétend pas une suite globale verte ni une recette UI complète.

Deux défauts V1 supplémentaires ont leur RED puis correctif local :

- Admission : une acceptation par un acteur inactif rendait `internal` au lieu d’un refus durable. La paire exacte quota propre + décision propre est maintenant qualifiée dans la même transaction, seulement pour acceptMeetupOffer/proposeMultiSwap/acceptSwap. Auth/profil/raisons/quota sont relus, contrôle normal revérifié avant commit ; injections étranger/stock/contrat/notification et révocation/draining/source changée refusées. Rejeu après épuisement du quota sans nouvel effet. Les 32 tests SDK natifs sont verts, dont les deux suites d’admission/standing.
- Favoris D07 : `isSold` sert aussi de réservation cash. Le trigger ne distinguait pas réservation et consommation, et ignorait true→true à la fin. Il exige maintenant la projection native inventory_article_availability_v1 jointe à l’unité et au contrat courant. Engagé/ambigu/incohérent préserve ; consommé est recontrôlé dans chaque transaction de retrait. Cash/troc, manuel, rejeu, évènement retardé et changement de source testés ; aucun stock/contrat modifié, aucun nettoyage des seuls anciens booléens. Le correctif client de pagination relève de RN.

Ces correctifs sont déployés sur Dev : BACKEND_V1_FINAL24_DEV_PLAN.json décrit la cohorte exacte de 24 (22 précédentes + acceptMeetupOfferV2 + onArticleSold), 91 conservées. Source réelle dd32855661871f6d5f0c75c811a0cd4744c97518d6453f20c9b5d5d16fb2ac4f, inventaire inchangé 48d6f6313c9d5e77cca62191ee7e4ef86f15e0e9e3a2d1727d97fc5380fbe617. Préflight et readback natifs verts ; ancien pin toujours fermé.

Les tests documentaires utilisaient Timestamp.now() comme faux serverTimestamp à chaque appel, créant parfois des instants de commit distincts. Les seuls appels de triggers de notification utilisent désormais le vrai sentinel, matérialisé par l’adapter réel ; aucune garde runtime modifiée. Le runner SDK dormant exige maintenant 36 contrats, dont les trois postaux ; son lancement sans --run affiche cloudActions=0.

## Commandes reproductibles

```bash
cd functions && npm run build
cd functions && npx tsc --noEmit
cd functions && npx vitest run
JAVA_HOME=/opt/homebrew/opt/openjdk@21 npm run test:security
JAVA_HOME=/opt/homebrew/opt/openjdk@21 firebase emulators:exec --project demo-second --only firestore,storage,auth 'npm --prefix functions run test:integration:v1'
JAVA_HOME=/opt/homebrew/opt/openjdk@21 firebase emulators:exec --project demo-second --only firestore,storage,auth 'npm --prefix functions run test:integration'
```

`testEmulatorIntegrations.cjs` refuse un projet autre que demo-second ou des hosts non loopback ; aucune lecture .env/credential cloud. Les ports des processus possédés sont libérés à la fin ; aucun backend UI d’autrui n’a été arrêté.

## Impact Dev préparé

`BACKEND_POSTAL_DEV_PLAN.json` contient les 22 noms exacts et les sources. Le préflight natif confirme 19 existantes ACTIVE au runtime dédié, aucune référence secrète sur ces 19, plus 3 nouveaux aliases attendus. Deux profils privés conservent tous les paramètres natifs : 17 core, 5 erasure avec leurs pins historiques explicitement maintenus mais désormais incompatibles avec le nouvel inventaire/source. Les variables réservées Firebase sont régénérées et doivent être relues par fonction.

Les 93 autres fonctions conservent leur déploiement. Les modules de projection/documentaire, adapter natif, privacy, preview et notifications comparés au snapshot Dev112 sont byte-identiques ; les vrais triggers sont exercés sur les six progressions postales et leur replay, et le retrait public laisse le contrat postal exploitable. Aucun ancien cron TEST ni fonction canonique TEST n’est réouvert/remplacé. Aucun index nouveau : les parcours de médias réutilisent les requêtes propriétaire + __name__ de l’inspection existante.

L’ancien pin ne qualifie pas ces nouvelles racines : nouveau reçu d’admission, source/client QA réel sans collecte, drainage des véritables anciennes invocations, puis vrai événement tardif et reçu d’achèvement requis avant qualification destructive. Aucun compte review Prod n’est utilisé.

Logs finaux : `final24-focused.json` (386/386), `v1-core-six-final.log` (32/32 SDK), `final24-tsc.log`, `final24-build.log`, `final24-stage-check-after-rebuild.json` (115), `final24-plan-tests.log` (5), `final24-runner-prepared.json` (aucune action cloud).

Preuves détaillées privées : `/tmp/seconde-v1-local-backend-20261125/` ; sauvegardes/préflight Dev : `/tmp/seconde-v1-dev-postal-deployment-20261125/`. Aucun secret, UID personnel ou contenu cloud n’est publié dans ce rapport.

## Déploiement Dev et borne

Relecture à `2026-11-26T00:50:30.075359Z` : les 22 fonctions sont ACTIVE, source `de9309e63ac80f61ce7cd2be3c10f0715b4effabd2f4618a8fab2c1445b0cf4b`, inventaire `48d6f6313c9d5e77cca62191ee7e4ef86f15e0e9e3a2d1727d97fc5380fbe617`. Tous les autres endpoints existants sont inchangés ; les filtres Eventarc sont comparés comme ensembles (ordre de retour API non significatif). Les 19 Eventarc restent privés et les 5 cron conservent leur OIDC exact. Aucune référence secrète native ne fut perdue/ajoutée dans le lot.

Dernière mise à jour réelle `00:48:36.036832Z`, timeout maximum 540 secondes : aucune future attestation de drainage avant `2026-11-26T00:57:36.037832Z`. Le reçu GCS historique a été lu à sa génération/SHA exacts : source ET inventaire diffèrent, donc il ne peut autoriser ni admission ni fin destructive pour cette nouvelle version. Aucun contrôle ni pin n’a été changé. GO UI postal Dev transmis à root/RN ; événement tardif/qualification destructive des nouvelles identités restent à établir.

## Cohorte Dev finale24 et nouvelle recette effacement

Relecture du 26nov à01:31:41.379741Z :24ACTIVE, source dd32855661871f6d5f0c75c811a0cd4744c97518d6453f20c9b5d5d16fb2ac4f ;91acteurs restent à6b16e9a8f80fddb8031d9b132817b8fa4750ec2e09b0540fbdd3f6dc97bb85a0. Paramètres utilisateur et références secrètes natives conservés,19Eventarc/5cron privés exacts, tous les autres endpoints inchangés. Deux variables Firebase-managed FUNCTION_SIGNATURE_TYPE ont varié entre absence et http ; équivalence qualifiée selon le défaut officiel du FunctionsFramework Node, sans assouplir les contrôles des paramètres utilisateur.

Borne réelle01:38:15.299474Z /20:38:15.299474Toronto le25nov, après dernière update01:29:15.298474Z +540s. Les acteurs UIA/B antérieurs ne peuvent pas devenir de nouvelles admissions par supposition et ne seront pas effacés. BACKEND_ERASURE_PRECONDITIONS.json relit les deux rulesets réellement publiés et le contrôleDev normal génération1795627289652833 ; collecte serveur fermée115/115, aucun nouveau pin publié.

Le runner optionnel --completed-postal-erasure ajoute seulement une recette Dev : deux nouvelles identités, vrai contrat postal terminé par les RPC existantes, générations de preuves figées, upload orphelin partiel admis pendant photos_pending puis reprise après fence. Une réponse403 demeure un refus, pas une finalisation ; seul un objet opérateur distinct et un vrai reçu Eventarc+effet+absence peuvent compléter la preuve composite. Les médias contractuels retenus sont vérifiés séparément des générations supprimées. Les tests purs du contrat de fixture et du mode dormant passent17/17 ; aucune nouvelle identité, intention ou exécution n’a encore été lancée par ce mode.


## Effacement Dev final réel — 26 novembre, 03:19 UTC

Accord ciblé du fondateur : « Oui, terminer ces tests d’effacement sur Dev ». Deux reçus seulement ont été publiés dans le bucket de contrôle Dev existant, avec temporaryHold et génération/SHA épinglés. Le rôle custom existant contient exclusivement storage.objects.get, avec une condition par objet exact et le seul runtime dédié. Les cinq moteurs ont reçu uniquement leurs trois références de qualification ; leurs sources DD, runtime de 512 MiB, paramètres, références secrètes et transports ont été relus. Les trois fonctions de fond restent privées avec leurs invokers exacts. Aucun changement Prod ni nouvelle identité de test.

- Admission efa967… / génération 1795661701907655 : écrivains 0abd réellement admis, deux naissances Auth natives et commandes existantes exactes. Les deux fences sont devenues effectives par reprise du cron existant. La première revue d’exécution s’est résolue lors de la reprise native suivante, sans patch ni statut fabriqué ; les deux commandes ont atteint 5/7 en attendant honnêtement la preuve de fin.
- Vrai objet tardif postal réservé, distinct des photos contractuelles, créé avec CAS0 à 03:08:40.419 UTC ; Eventarc reçu à 03:08:43.156, effet exact absent, intention GCS exacte et génération 1795662520414213 réellement 404. L’ancienne tâche SDK est restée inobservable après interruption du harness : aucun refus 403 ou succès SDK n’est inventé.
- Completion 358a5d… / génération 1795662800939167, matrice 7200e5… : mêmes deux sujets, contrôle, inventaire 48d6 et cohortes. Les écrivains 0abd archivés sont séparés du lecteur 75b4 post-fence ; diff relu de trois fichiers de lecture uniquement, aucun nouveau writer, RPC ou autorité Auth. Cinq pins relus ACTIVE à 03:16:07 UTC. Expiration opérateur inchangée à 04:46:10.064 UTC ; ce n’est pas une qualification permanente ou générale de Dev.
- Le cron de 03:18 a repris les mêmes intentions : les deux reçus 7/7 ont été relus à 03:18:24–25 UTC, Auth réellement absente. Vérification indépendante finale à 03:19:20 : users absents ; deux tombstones publics stricts ; huit générations ordinaires ou orphelines absentes ; contrats postal et cash et witnesses inchangés hors overlay de confidentialité ; une preuve owner et une preuve peer postales conservées à leur génération, CRC, MIME, taille et en-têtes privés ; dossier privé non contractuel C disposed ; dossier d’article contractuel postal retenu sous le motif et l’échéance existants ; pairs Auth/profils préservés.

Les pièces privées retenues gardent leur échéance de réexamen en 2029. Aucune remise physique, expédition physique, transaction monétaire réelle ou révocation Apple n’est attestée par ces deux comptes password. Les métadonnées GCS des médias retenus ont été relues après effacement ; une nouvelle session peer SDK n’a pas été fabriquée pour prétendre un nouveau RPC de pixels. Les lecteurs privés étaient exercés sur les parcours UI A/B et la recette précédente ; les preuves de ce paragraphe restent distinctes.

Dernier relevé des logs, limité aux deux hashes de commandes et aux cinq moteurs, de 03:08 à 03:19:30 UTC : **2 WARNING native_scope_unqualified, 0 ERROR**. Les deux reçus et toutes les postconditions sont ensuite réellement terminaux, reasons=[] ; aucune assertion de logs globalement propres ni attribution spéculative n’est faite. Les trois codes initiaux de 03:03 restent conservés dans la preuve d’admission.

Preuves finales sanitizées : BACKEND_ERASURE_ADMISSION_DEV.json ; BACKEND_ERASURE_LATE_STORAGE_DEV.json ; BACKEND_ERASURE_COMPLETION_DEV.json ; BACKEND_ERASURE_NATIVE_POSTCONDITIONS.json ; BACKEND_ERASURE_FINAL_BOUNDED_LOGS.json. BACKEND_ERASURE_WRITER_MATRIX.json est conservé exactement au SHA 7200e5… publié. BACKEND_ERASURE_FINAL_PLAN.json porte l’état final backend et la limite physique. Aucun contrôle Prod, secret ou fichier privé n’est inclus.
