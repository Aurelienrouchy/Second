# V1 corrigée — lot serveur Prod exécuté

Le 26 novembre 2026, **26 fonctions ont été déployées sur seconde-b47a6** : 23 mises à jour et les trois ajouts `setSwapExchangeModeV2`, `uploadSwapPhotosV2`, `confirmSwapShippingV2`. Les cinq commandes Firebase ont terminé sans force ni suppression d’orphelin. Le préflight natif et les sauvegardes privées des 23 sources/configurations/IAM précèdent les mutations ; une restauration ancienne ne doit jamais être automatique après admission d’un nouveau contrat postal.

La relecture du 26 novembre à **04:41:53 UTC** a confirmé :

- 26 fonctions ACTIVE, sur leur nouvelle révision à 100 %, Montréal, 512 MiB ;
- les octets src, lib, wrapper, package et lockfile des **26 archives réellement envoyées** correspondent aux stages gelés ; aucun fichier .env n’a été lu ou extrait de ces archives ;
- source `3e30943772c19cf2314b42e716450437906b98ef8be13614afdbf590c5d7ddde` pour ces 26 fonctions, source819 conservée pour les 89 autres fonctions V1 ;
- trois profils natifs 21/3/2 : paramètres conservés, PostHog effacement true et secret existant version1 uniquement sur deleteUserAccountV2 / continueAccountErasure / resumeAccountErasures ; les deux autres moteurs restent sans secret ; aucune capture analytique ouverte ;
- les 19 Eventarc et cinq cron V1 conservent leurs invokers exacts et restent privés ;
- les 77 anciens services n’ont aucun principal public et les 17 anciens jobs restent PAUSED, sans invocation métier de contrôle ni modification de leurs permissions ;
- le seul index ajouté, searchHistory.timestamp / COLLECTION / DESCENDING, est READY depuis 04:39:20 UTC ; l’index GROUP_ASC existant est conservé ; aucune règle publiée ou autre configuration d’index modifiée.

Le contrôle a été relu à 04:43:30 UTC : normal/unconfigured, génération **1795639824843632**, SHA `4c2a5d43482be7bb49dd476a836e8fe403cd725d90952d5a945d00fa68596669`, inchangés. Les références PostHog sont restées à la version1, sans lecture de sa valeur. Aucun nouveau reçu, accès à un nouvel objet de qualification ou pin n’a été publié.

Le dernier rollout natif est daté **04:40:43.166020 UTC**. Avec le maximum précédent de 540 secondes, la borne conservatrice est **04:49:43.167020 UTC**, soit le 25 novembre à 23:49:43 à Toronto. Son passage a réellement été constaté à **04:50:12 UTC**, avec les 26 cibles Cloud Run à 100 % sur leur révision actuelle et aucune ancienne cible taguée. Cette borne ne prétend pas faire disparaître les sessions d’upload resumable : elles relèvent de la preuve du finalizer.

## Ce qui reste avant qualification de l’effacement et nouvelle publication corrigée

L’ancien pin d7e513… est volontairement conservé. Son SHA a été relu, mais son source654 et son inventaire8af ne qualifient pas le nouveau source3e / inventaire48d6. **Les nouvelles admissions et la validation finale d’effacement ne sont pas déclarées qualifiées.** Les commandes existantes ne sont pas réécrites ; le contrôle garde leur génération originale.

Root doit fournir et revoir l’archive du véritable nouveau client EAS Production et sa configuration. Un hash de client QA Dev, même gelé, n’est pas cette preuve. Il reste aussi à observer la réception Eventarc sur la nouvelle révision Prod pendant la recette bornée aux deux comptes review déjà autorisés, puis revoir la base inter-environnements et la matrice des écrivains. Les suppressions natives Dev et leurs effets ne sont pas relabellisés en suppressions Prod. Aucun effacement des deux comptes review n’est prévu.

Après ces preuves seulement, un GO root distinct sera nécessaire pour le nouveau reçu Prod immuable, son lecteur d’objet exact et les cinq pins. La permission d’exécuter ce lot de code/index ne vaut pas publication anticipée de cette qualification. Aucun nouveau projet, bucket, secret ou compte n’a été créé.

Preuves : `BACKEND_PROD_ALIGNMENT_DEPLOYMENT.json`, `BACKEND_PROD_ALIGNMENT_DRAIN.json`, `BACKEND_PROD_ERASURE_QUALIFICATION_PRECONDITIONS.json`. Le plan initial détaillé reste dans `BACKEND_PROD_ALIGNMENT_PLAN.{md,json}`. Toutes les sauvegardes et profils restent privés dans `/tmp/seconde-v1-prod-alignment-deployment-20261126/` ; ils ne doivent pas entrer dans Git.
