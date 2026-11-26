# Revue de sélection du candidat Git V1

Revue en lecture seule du candidat intermédiaire `/tmp/seconde-v1-git-release-20261125` et du sélecteur `/tmp/seconde-v1-git-snapshot-plan.py`. Aucun changement du candidat, aucune commande de commit/push/déploiement, aucun fichier d'environnement privé ou de signature ouvert. Cette revue ne remplace pas la synchronisation et les vérifications finales.

## Écart à corriger dans la sélection

Le sélecteur omet `.maestro/flows/buy-checkout-meetup.yaml`. Le candidat conserve donc l'ancienne assertion **Meetup confirmé**, alors que la source courante vérifie **Demande envoyée** et précise qu'une proposition ne réserve pas encore l'article. Inclure ce fichier précis après relecture pour conserver cette correction de recette. Les autres fichiers Maestro déjà présents sont identiques à la source au moment de la revue.

## Fermeture des références observée

- Aucun import relatif ou alias `@/` manquant dans les onze racines client inspectées : `app`, `features`, `components`, `hooks`, `services`, `store`, `lib`, `utils`, `types`, `constants`, `config`. Aucun asset littéral manquant trouvé dans leurs `require`. Ce contrôle statique ne constitue pas une compilation native.
- Les dépendances et devDependencies déclarées correspondent aux entrées racine des deux `package-lock.json`, application et fonctions. Aucun paquet local `file:` ni hook d'installation manquant n'a été relevé dans les manifestes inspectés. `yarn.lock` est exclu de l'envoi EAS ; le lock npm est bien sélectionné.
- Les commandes du README courant utilisent des scripts existants : `scripts/start-dev.cjs`, les scripts npm de frontières/sécurité, et les outils installés dans les manifestes. Le README du candidat était encore ancien lors de la revue : il doit recevoir la resynchronisation prévue.
- `config/featureFlags.ts` importe `firebaseEnvironment.ts`, qui importe `firebaseProjects.json` ; les trois sont sélectionnés. `catalogueCallableContracts.ts`, `functions/phase1-release.json` et `functions/dev-deploy.json` sont également sélectionnés. Le mapping client est déclaré dans le code, pas importé depuis le manifeste serveur ; leur cohérence relève des tests dédiés.
- `firebase.json`, les règles et index, les ressources de `public/`, les scripts de staging/déploiement et le garde `functions/scripts/checkFinancialWriterRegistry.cjs` sont présents et sélectionnés. Les fichiers générés `.expo` et `expo-env.d.ts` sont absents du candidat, conformément à leur génération par Expo.
- Les trois scripts npm historiques `reset-project`, `test-auth`, `test-firebase-auth` visent des fichiers absents aussi dans la source courante. Ce n'est pas une omission du snapshot et ces scripts ne sont pas utilisés par le README ni par l'installation/build vérifiés ici.

## Fichiers hérités de la base distante

La sélection ne représente pas à elle seule tout le checkout : les fichiers déjà suivis hors périmètre restent hérités de `origin/main`. C'est notamment le cas des anciennes configurations d'agents/éditeur/MCP, des dossiers natifs et des archives sous `docs/`. Ils ne sont pas de nouveaux ajouts de cette livraison ; aucune qualification de leur contenu sensible n'est revendiquée. Ne pas décrire le candidat comme un checkout intégralement expurgé sur la seule foi du scan des fichiers sélectionnés.

Les configurations Firebase natives publiques racine et `vinted-brands.txt`, non sélectionnés par le sélecteur, sont présents via la base et ont exactement le même contenu que la source courante. Ils ne constituent donc pas une omission de build observée. Les dossiers natifs hérités sont exclus de l'envoi EAS, qui les régénère depuis `app.config.js`.

Aucun fichier de credentials, archive applicative ou sauvegarde privée manifeste n'a été trouvé dans les noms sélectionnés. Les noms contenant « private » correspondent à du code/types/tests métier. Cette observation et le scan de signatures du sélecteur ne garantissent pas l'absence de tout secret arbitraire ; le contrôle doit être répété sur la sélection finale et son diff réellement préparé.
