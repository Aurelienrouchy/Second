# Dépendances : correctifs compatibles et alertes restantes

Le suivi GitHub a rendu visibles des avis de dépendances supplémentaires au
périmètre métier. Les deux lockfiles ont été examinés et mis à jour par npm
officiel, avec le runtime Node 20.20.2, le registre `https://registry.npmjs.org`
et un cache dans `/tmp`. Les manifestes `package.json`, les frameworks, les
plages de versions directes et les fonctionnalités financières sont inchangés.
Le commit est `419ab1835be894ec9d5f6d4e8347b36c171db690`.

| Dépendance transitive | Avant | Après | Chaîne / source du correctif |
| --- | --- | --- | --- |
| fast-xml-parser | 4.5.3, app et Functions | 4.5.7 | Google Cloud Storage, plage `^4.4.1` ; [avis XML](https://github.com/advisories/GHSA-m7jm-9gc2-mpf2) |
| shell-quote | 1.8.3, app | 1.12.0 | react-devtools-core, plage `^1.6.1` ; [avis quote](https://github.com/advisories/GHSA-w7jw-789q-3m8p) |
| websocket-driver | 0.7.4, app et Functions | 0.7.5 | faye-websocket, plage `>=0.5.1` ; [avis protocole](https://github.com/advisories/GHSA-xv26-6w52-cph6) |
| protobufjs | 7.6.2 app, 7.5.4 Functions | 7.6.6 | Firebase/Google SDK, plages major 7 existantes ; [avis codegen](https://github.com/advisories/GHSA-xq3m-2v4x-88gg) |
| proxy-addr | 2.0.7, Functions | 2.0.8 | Express, plage `~2.0.7` ; [avis subnet](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) |

La mise à jour protobufjs actualise aussi ses dépendances codegen,
eventemitter, fetch et utf8, et retire inquire devenu inutilisé. Les changements
de métadonnées npm sur des versions inchangées ont été retirés pour conserver
un diff ciblé. Les installs `npm ci` ont ensuite réussi sur les deux lockfiles.

Les avis concernent des versions installées ; ils ne constituent pas une
preuve d'exploitation par un parcours Seconde. Les avis XML, codegen et
shell-quote décrivent des conditions d'entrée particulières. Les patchs
compatibles sont appliqués sans essayer ces entrées contre une application
déployée ou un service externe.

## Qualité des mesures npm audit

Les comptages portent sur les groupes signalés par npm, avec propagation
transitive : ils ne dénombrent pas des failles métier indépendantes.
`dependency-audit.json` conserve les versions, comptes avant/après, avis
critiques et SHA-256 des résultats locaux disponibles. À commande et périmètre
identiques (`--package-lock-only`), l'app passe de **108 groupes, dont 3
critiques, à 105, dont 0 critique** ; Functions passe de **32, dont 4 critiques,
à 28, dont 0 critique**. L'audit séparé de l'arbre installé signale 108 groupes
pour l'app et 28 pour Functions, également sans critique. La CI initiale
signalait 111 groupes app lors de l'installation : ce snapshot n'est pas
substitué à la comparaison contrôlée des deux lockfiles.

Une première commande sans cache writable a produit des plages vides et une
propagation excessive sur des packages parents. Ce résultat dégradé a été
écarté. Les comptages de base sont recoupés par `npm audit --package-lock-only`
sur les manifestes/lockfiles précédant le correctif, copiés dans `/tmp`, avec
le même registre et le même cache que la mesure finale. Aucun ancien fichier
sensible du dépôt n'est lu pour ce contrôle.

Les alertes restantes des lockfiles **75 high, 29 moderate et 1 low pour l'app**, et
**12 high, 15 moderate et 1 low pour Functions**, doivent être qualifiées
par chemin d'entrée et compatibilité de mise à jour. Cet audit ne certifie
pas leur absence d'exposition ; les cinq mises à jour ciblées ne remplacent
pas cette revue. Il s'agit d'une limite supplémentaire explicite avant une
livraison externe, distincte des résultats des suites métier.

## Vérification sur les lockfiles corrigés

La CI [37408695175](https://github.com/Aurelienrouchy/Second/actions/runs/37408695175)
sur ce commit passe les trois jobs exécutables : **735 Jest**, **606 Functions
+ 2 tests de contention explicitement ignorés**, **205 règles Firestore/Storage**,
et les trois typechecks. Maestro reste désactivé.

La validation locale Node 20 réexécute les **608 Functions avec les deux tests
SDK réels**, les **735 Jest**, les **118 Vitest app**, les **185 règles Firestore**,
les trois typechecks, lint/frontières et les exports iOS/Android/web. Ses
résultats et empreintes sont séparés dans `postDependencyValidation` de
[verification.json](verification.json). Les captures web restent limitées à
la page statique ; caméra, gestes et push nécessitent un appareil.
