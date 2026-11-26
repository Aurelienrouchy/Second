# Backend V1 — vérifications locales du 25 novembre 2026

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
