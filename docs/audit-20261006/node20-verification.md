# Validation locale du runtime Node 20

La première livraison avait exécuté les tests sur Node **24.19.0**, seul runtime Node présent dans l'environnement. `functions/package.json` déclare pourtant `engines.node = "20"`. La preuve manquante était donc l'exécution des suites critiques et du compilateur avec le major effectivement déclaré pour Functions, et non un test déjà échoué ou une panne de production.

La passe complémentaire installe uniquement dans `/tmp/second-node20` la distribution officielle Linux x64 **Node 20.20.2** :

- Archive : `https://nodejs.org/dist/v20.20.2/node-v20.20.2-linux-x64.tar.xz`.
- Sommes officielles : `https://nodejs.org/dist/latest-v20.x/SHASUMS256.txt`, téléchargées dans `/tmp/second-node20-SHASUMS256.txt`.
- SHA-256 attendue et calculée : `df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d`.
- Binaire vérifié : `/tmp/second-node20/bin/node --version` → `v20.20.2` ; npm embarqué `10.8.2`.

Aucun runtime système, configuration de compte, lockfile ou dépendance n'est modifié. Les tests réutilisent les dépendances déjà installées depuis npm officiel. Les commandes invoquent explicitement ce binaire ; les workers Vitest héritent de son `process.execPath`, et le `PATH` local est placé en tête uniquement pour la commande concernée.

## Périmètre de la passe

Le code applicatif est inchangé depuis `617ec865d8414a39abd9ba25fa58900eb13150c8`. La branche à l'entrée de cette passe est `audit/seconde-security-ux-20261006`, HEAD `69b47f5d997e162f160428e670ae6bc22898fd73`, qui n'ajoutait que les rapports à ce code. Aucune publication n'est autorisée dans ce complément.

Les suites critiques couvrent toutes les Functions, notamment offres/acceptations, gardes de phase, remboursements, payout inconnu, conservation des fonds, annulations périmées, bordereau tardif, médias et compteurs. Les deux tests de contention emploient le SDK Admin réel et le serveur Firestore officiel Google Cloud 1.22.0 déjà vérifié, sur `127.0.0.1:8080` et `demo-second`. Stripe, ShipEngine, IA, notifications et les autres gateways externes restent mockés. Les tests Firestore client/règles sont exécutés séparément des tests Admin.

Le runtime Storage reste indisponible à cause du refus réseau canonique déjà documenté. Cette passe ne télécharge aucun binaire Storage par un autre canal et ne tente aucun accès de production. Les règles Storage, l'accès HTTP privé, les appareils et la réception push ne sont pas couverts par la réussite des suites Node 20.

Les résultats et empreintes finaux sont consignés dans [verification.json](verification.json), section `node20Validation`. Les logs de ce complément sont `/tmp/second-node20-*.log`. Cette validation démontre la compatibilité locale du code et de ses dépendances avec Node 20.20.2 ; elle ne constitue pas une exécution d'une Function déployée ni une certification de l'environnement cloud, qui n'a pas été touché.

| Vérification sous Node 20.20.2 | Résultat |
| --- | --- |
| Functions | **608/608**, 51 fichiers ; deux tests SDK Firestore inclus, zéro ignoré, exit 0 |
| Jest app | **735/735**, 91 suites ; sortie normale sans forceExit, exit 0 |
| Vitest app | **118/118**, 15 fichiers, exit 0 |
| Règles Firestore seulement | **185/185**, 12 fichiers, exit 0 ; Storage exclu explicitement |
| Typecheck Functions / app / tests | Trois exits 0, sorties vides |

Aucun blocage de compatibilité locale Node 20 ne subsiste dans ces contrôles. Les tests et leur configuration restent inchangés. Lint et exports de la passe précédente sont conservés comme preuves sous Node 24 ; ils ne sont pas présentés comme réexécutés sous Node 20.

Commande critique Functions :

```sh
cd functions
PATH=/tmp/second-node20/bin:$PATH \
METADATA_SERVER_DETECTION=none GCLOUD_PROJECT=demo-second \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 \
/tmp/second-node20/bin/node node_modules/vitest/vitest.mjs run --maxWorkers=2
```

Les deux derniers hôtes sont des garde-fous de configuration ; ils n'affirment pas qu'un serveur Auth ou Storage a été démarré. Aucun test n'est retiré ni modifié pour cette passe.
