# Publication autorisée et suivi de la CI

Le mandat initial réservait les changements à des commits locaux. Après examen
de la livraison, le propriétaire a explicitement autorisé la publication de la
branche dédiée et une PR en brouillon vers `main`, puis la poursuite jusqu'à
la fin des vérifications GitHub. Cette autorisation ne couvre ni fusion,
déploiement, migration de données, rotation de credentials ou réécriture de
l'historique distant.

- Branche : `audit/seconde-security-ux-20261006`.
- PR : [#2 — Corriger les parcours du MVP local et sécuriser offres, médias et fonds](https://github.com/Aurelienrouchy/Second/pull/2), ouverte et en brouillon.
- Base vérifiée lors de la création : `b79d0c8e47a18ec9b405b13e8229a63f5ef02980`.
- Première tête publiée : `1cbe3db1fa32380b44937533776ffc5cbac15e56`.
- GitHub Actions exécute uniquement les tests ; le workflow ne comporte pas de déploiement.
- Le checkout synthétique `refs/pull/2/merge` de GitHub sert aux tests et n'est pas une fusion dans `main`.

## Défaut Storage reproduit par la première CI

Le [run 37407926239](https://github.com/Aurelienrouchy/Second/actions/runs/37407926239)
sur cette première tête a passé Jest **735/735**, Functions **606 tests passés,
2 explicitement ignorés**, et les trois typechecks. Le job règles a démarré
normalement les runtimes officiels, dont Storage `1.1.3`, et exécuté **205 tests** :
**203 passent et 2 échouent**.

Ces deux échecs ont confirmé que `allow create` ne suffisait pas à interdire
un upload remplaçant un objet existant dans `chat_images/` et
`swaps/{id}/photos/{uid}/`. L'assertion attendait correctement un refus.
Le correctif `545a9fd6f9d295cf90de25917a1e06cba86949c9` exige également
`resource == null` avant d'autoriser la création, en conservant les contrôles
participants/UID, MIME, taille et état. **Les tests et assertions n'ont pas été
retirés ou assouplis.** La [documentation Firebase sur les ressources existantes](https://firebase.google.com/docs/storage/security/rules-conditions#resource_evaluation)
décrit la métadonnée `resource` pour ce contrôle.

Le refus de téléchargement Storage dans le workspace reste une limite locale,
distincte du résultat des tests sur GitHub. Les deux tests de contention réelle
Firestore sont ignorés dans le job Functions standard faute d'émulateur dans
ce job ; ils ont passé **2/2 localement**, puis dans les suites locales
**608/608**, sous Node 20 et 24. Aucun test E2E natif ne s'exécute : le job
Maestro conserve le guard `if: false` faute de build/appareil.

Le [run 37408183916](https://github.com/Aurelienrouchy/Second/actions/runs/37408183916)
sur `545a9fd6f9d295cf90de25917a1e06cba86949c9` est terminé avec **success** :
**205/205 règles** sur 13 fichiers, dont les **20 Storage**, **735/735 Jest**,
**606 Functions passées + 2 ignorées**, et les trois typechecks. Les trois jobs
exécutables passent ; Maestro est explicitement ignoré. Le téléchargement
Storage et les lectures SDK inter-comptes ont donc été vérifiés sur le runner
GitHub, sans contourner le refus local ni utiliser un bucket réel.

Le dernier commit documentaire ajoute ces résultats sans modifier le code.
Son SHA distant et ses propres checks sont suivis jusqu'à leur terminaison
dans la PR. [verification.json](verification.json) enregistre le résultat du
run de code et les empreintes disponibles. Le rapport local conserve ses
empreintes et son HEAD initial ; aucune exécution déployée n'est revendiquée.

## Complément de dépendances et conclusion suivante

Le commit `419ab1835be894ec9d5f6d4e8347b36c171db690` actualise les deux lockfiles
pour cinq dépendances transitives, dans leurs plages compatibles. La CI
[37408695175](https://github.com/Aurelienrouchy/Second/actions/runs/37408695175)
est elle aussi **completed / success** sur ce SHA : les mêmes **735 Jest,
606 Functions passées + 2 ignorées, 205 règles et trois typechecks** passent.
Les jobs Unit, Functions et Security rules sont tous terminés en succès ;
Maestro est explicitement ignoré. HEAD local, tête PR et branche distante ont
été recoupés. La PR reste ouverte, en brouillon et non fusionnée ; sa base
reste le commit audité.

Aucun blocage d'approbation, runner, quota ou configuration de démarrage n'a
été constaté. Aucun workflow n'a été relancé manuellement : les runs suivants
proviennent des pushes nécessaires aux correctifs. [dependencies.md](dependencies.md)
détaille les nouvelles preuves locales et les avis restant à qualifier.
