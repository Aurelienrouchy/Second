# Émulateurs officiels et tests de concurrence — seconde passe

La première passe ne pouvait démarrer les émulateurs Firebase. La seconde passe a trouvé un canal officiel Google Cloud accessible pour **Firestore**, sans modifier les règles déployées, utiliser une base distante ou contourner un contrôle d'accès de compte.

## Diagnostic de téléchargement

L'URL canonique publiée par la Firebase CLI installée, `https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.22.0.jar`, échoue avec `curl: (56) CONNECT tunnel failed, response 403` et une réponse de tunnel `HTTP/1.1 403 Forbidden`. La requête n'établit donc pas la connexion HTTPS au serveur d'objet. Cela atteste un refus du transport réseau dans cet environnement, pas une erreur des règles Firebase du projet ni un refus de lecture d'un objet privé du dépôt. Les tentatives antérieures avec réseau supplémentaire n'ont pas changé le résultat. Aucun refus d'auto-review n'a été contourné.

La recherche de JARs déjà présents sous `/tmp`, `/opt`, `/usr`, `/home/agent` et `/workspace` n'a trouvé aucune installation de serveur utilisable ; `gcloud` n'est pas installé. Node et Java sont disponibles.

La [documentation Google Cloud](https://cloud.google.com/firestore/native/docs/emulator) propose aussi le serveur Firestore via Google Cloud CLI. Le manifeste officiel `https://dl.google.com/dl/cloudsdk/channels/rapid/components-2.json` indique le composant `cloud-firestore-emulator` 1.22.0 dans la distribution 587.0.0. Le paquet officiel relatif `components/google-cloud-sdk-cloud-firestore-emulator-20260717053915.tar.gz` a été téléchargé depuis ce même canal HTTPS public autorisé, puis sa SHA-256 vérifiée contre le manifeste : `e962450b637827664094959571fd92c3680de863936bd481bd0a050f76ca91ba`.

Le JAR extrait est `/tmp/second-official-firestore.jar`, SHA-256 `6262939c48d3d6b08495931706b8920399e57d5f5918e6af133a3d30cb3ae369`. Il s'agit du paquet Google Cloud, pas du JAR Firebase de taille/empreinte différentes ; aucune substitution non officielle ni désactivation de vérification n'est revendiquée. Son launcher officiel utilise la classe `com.google.cloud.datastore.emulator.firestore.CloudFirestore`, plutôt qu'un manifeste exécutable `java -jar`. L'interface confirme `--rules`, `--project_id`, `--host` et `--port`.

Commande locale employée :

```sh
java -cp /tmp/second-official-firestore.jar \
  com.google.cloud.datastore.emulator.firestore.CloudFirestore \
  --host=127.0.0.1 --port=8080 --project_id=demo-second
```

Le serveur écoute uniquement en loopback, données en mémoire, projet démo. Les tests de règles chargent leur fichier local via `initializeTestEnvironment`. Le serveur est arrêté après la validation finale ; aucune donnée de production n'est importée.

## Pourquoi deux tests étaient ignorés

`functions/src/callable/offers.emulator.test.ts` emploie explicitement `describe.skipIf(!FIRESTORE_EMULATOR_HOST)`. Aucun hôte d'émulateur n'était disponible dans la première passe, donc deux tests étaient ignorés avant exécution. Ce saut ne provenait ni du flag paiements, ni d'un échec d'assertion, ni d'un timeout.

Le fichier refuse un hôte non loopback et un projet explicite autre que `demo-second`, et impose ce projet à son application Admin nommée. Les fixtures articles/chats/messages/transactions/threads/requêtes/utilisateurs ont des IDs UUID propres et un cleanup borné à ces IDs. Stripe, ShipEngine, notifications et analytics sont mockés. La détection metadata cloud du SDK est désactivée dans ces tests : aucun probe ADC n'est nécessaire pour le serveur local.

Les tests portent sur les vraies transactions du SDK Admin, et donc sur les conflits/retries du serveur local, sans passer par le mock sérialisé des unitaires. Admin contourne les règles : ces tests ne prouvent pas leurs ACL.

1. Deux propositions différentes simultanées, une seule pending ; replay de l'ancienne requête et refus périmé sans modification de la gagnante.
2. Deux acheteurs acceptés simultanément, un seul accord/verrou article ; double acceptation rejoue cet accord exact.

Après installation officielle : **2/2 passent, exit 0**, log `/tmp/second-offers-real-contention.log`. Ils passent aussi dans la suite Functions finale **608/608, 51 fichiers, aucun ignoré**, log `/tmp/second-final-functions.log`.

## Règles Firestore et limite Storage

Le mode explicite `npm run test:security:firestore:run` charge Firestore seulement et exclut la suite Storage ; le mode par défaut `test:security` conserve toutes les suites et exige le runtime Storage. Il ne transforme pas ce contrôle partiel en réussite de la suite complète.

Validation finale : **185/185 tests Firestore passent**, 12 fichiers, exit 0, log `/tmp/second-final-firestore-rules.log`. Une première exécution avait passé 167 tests avant les ajouts de revue. Le premier rerun a signalé un cas de liste imbriquée refusé par le SDK avec `invalid-argument` avant les règles ; l'assertion a été adaptée à cette couche de rejet, sans retirer ce scénario. Les autres identifiants malformés sont refusés par les règles avec `permission-denied`.

Le runtime **Storage** canonique reste `cloud-storage-rules-runtime-v1.1.3.jar`, distribué par la Firebase CLI depuis le même hôte `storage.googleapis.com` bloqué. Le manifeste Google Cloud consulté n'offre pas ce composant Firebase Storage ; le JAR Firestore ne remplace pas son protocole. La consultation shell des assets officiels GitHub Firebase a également reçu HTTP403. Aucune copie tierce, réécriture de DNS/proxy, route alternative vers un objet interdit, connexion de compte ou permission distante n'est utilisée. Tests Storage inter-comptes et HTTP bearer restent **non exécutés**.

La [documentation Firebase](https://firebase.google.com/docs/emulator-suite/install_and_configure) décrit la CLI, les caches de JAR et le projet explicite d'émulation. Le refus réseau restant exige une disponibilité normale du binaire officiel dans l'environnement ou son cache autorisé ; il ne doit pas être remplacé par des tests contre production.
