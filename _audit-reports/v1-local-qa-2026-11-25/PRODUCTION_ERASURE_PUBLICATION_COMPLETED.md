# Qualification d’effacement Prod rétablie

État relu le 2026-11-26T12:40:33.339609+00:00 : le reçu approuvé 3eb et ses cinq références sont actifs sur `seconde-b47a6`. L’accord utilisateur ciblé a précédé cette publication. Aucun appel métier d’effacement n’a été émis pour la vérifier, aucun compte n’a été créé ou supprimé manuellement.

- Reçu exact `3eb0e7fd3ed7d8c73a699f086e43a21fc62b96a3a2f66db3d339ad1a8c933fa4`, génération `1795696554296081`, créé sous précondition génération zéro ; octets relus et SHA identique, `temporaryHold=true`, cache privé sans stockage.
- Une seule liaison a été ajoutée : rôle existant limité à `storage.objects.get`, sous condition du seul objet exact, au seul runtime Seconde Prod existant. Les autres permissions et l’ancien reçu sont conservés.
- Seules les trois variables de référence du reçu ont changé sur `deleteUserAccountV2`, `manageAccountErasure`, `continueAccountErasure`, `resumeAccountErasures` et `eraseLateAccountStorage`. Les cinq sont ACTIVE, au dernier déploiement à 100 %, à Montréal et 512 MiB. Sources, paramètres, secrets et IAM sont préservés.
- Les 115 sources et profils ont été relus : 26 source 3e et 89 source 819 ; les 110 autres révisions n’ont pas changé pendant cette opération. Les 19 Eventarc et 5 cron restent privés avec leurs acteurs exacts ; les 77 anciens services restent privés et les 17 tâches obsolètes en pause.
- Contrôle toujours normal/unconfigured, génération `1795639824843632`, sans changement d’epoch ni de règles. Aucune finance ou livraison API ouverte.
- Journaux limités aux cinq services, du 26 novembre 12:35:54 à 12:40:33 UTC : zéro entrée ERROR, résultat non tronqué. Aucun contenu utilisateur ni secret dans les preuves.

## Limites des preuves

La matrice 800c, le reçu 3eb et la provenance client 211 restent immuables. L’archive 211 atteste le client Production audité à cette date ; elle ne désigne pas les prochains binaires 37/18. Leur preuve complémentaire doit établir les invariants décrits dans `ACCOUNT_ERASURE_CLIENT_HASH_SEMANTICS.md`.

La base Storage combine le nettoyage réellement observé sous fence sur Dev, huit composants identiques et le transport Prod corrélé par un ACK 204 réel. Elle ne prétend pas un effacement métier ni une suppression Auth en Prod. La garde de collecte et les vérifications par sujet concernent PostHog Seconde, pas toute la télémétrie Google/Firebase. Les intentions déjà confirmées peuvent reprendre naturellement sous leurs contrôles ; aucun état de commande n’a été fabriqué.

Les anciens documents de préparation ou de blocage sont conservés comme historique. Le présent état et `PRODUCTION_ERASURE_PUBLICATION_COMPLETED.json` constatent leur remplacement opérationnel par le reçu actif.

## Échéance et renouvellement

Le reçu expire le **25 décembre 2026 à 22:55:33 UTC** (17:55:33 à Toronto). Cette date est un choix opérateur du reçu, pas une durée fixe exigée par le runtime, et la publication du 26 novembre ne la repousse pas. Le runtime impose une date future valide (`accountErasureQualification.ts:55`). À expiration, la qualification échoue fermée : admission ou finalisation destructrice attendent une nouvelle qualification ; les reçus de suppressions déjà terminées restent des faits observables.

Avant cette échéance : relire les sources/inventaire/règles, contrôle et permissions réellement déployés ; vérifier la validité des gardes et des preuves de drainage/Storage pertinentes ; faire revoir un nouveau reçu à durée explicite. Publier ensuite ce nouveau reçu immuable, limiter sa lecture à l’objet exact et actualiser les mêmes trois références sur les seuls cinq consommateurs. Relire leurs états et protections. Ne pas simplement étendre une date en réutilisant une preuve devenue fausse, et ne pas redéployer un profil ancien qui écraserait les références natives actuelles.

Preuve machine principale : `PRODUCTION_ERASURE_PUBLICATION_COMPLETED.json`. Publication et préconditions : `PRODUCTION_ERASURE_RECEIPT_PUBLICATION.json`, `PRODUCTION_ERASURE_PUBLICATION_RECHECK.json`, `PRODUCTION_ERASURE_TRANSPORT_PRECHECK.json`.
