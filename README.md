# Seconde

Application Expo / React Native de seconde main au Canada. Les références produit sont dans `docs/metier/`, l'index du code dans `CODEBASE_INDEX.md` et l'état de la livraison dans `_audit-reports/HANDOFF.md`.

## Développement et recette V1

```sh
npm ci
# Développement habituel : Seconde Dev, commerce TEST et livraison simulée.
npm start
# Recette V1 : application locale, serveur Seconde Dev distant, commerce fermé.
EXPO_NO_DOTENV=1 NODE_OPTIONS=--dns-result-order=ipv4first npm start -- --phase1 --port 8091 --localhost
```

Le profil `--phase1` choisit explicitement les contrats serveur V1 déployés sur Seconde Dev. Il ferme les paiements, la livraison intégrée, la création d'annonces avec livraison, Square et les outils de simulation commerciale. Il ne change pas le profil de production. `--phase1 --emulators` est refusé : l'autorité de contrôle et la qualification d'effacement utilisent des services Dev distants.

Les simulateurs doivent utiliser le client `com.seconde.app.dev`, scheme `seconde-dev`. Les projets natifs sont générés par Expo ; pour une compilation locale, utiliser une copie isolée et `expo prebuild`, sans modifier à la main les dossiers natifs. Le lancement local ne doit jamais ouvrir le bundle de production. Android doit pouvoir joindre le port Metro choisi, par exemple avec `adb reverse tcp:8091 tcp:8091`.

`npm run start:emulators` reste disponible pour les tests entièrement locaux compatibles avec `demo-second`. Ce mode ne qualifie pas à lui seul la suppression de compte et ses dépendances externes.

## Expo MCP et vérifications

Le fournisseur officiel `expo-mcp` est une dépendance de développement. Pour activer ses capacités locales, lancer Metro avec `EXPO_UNSTABLE_MCP_SERVER=1` en conservant le profil `--phase1` ci-dessus. La connexion distante se configure suivant la [documentation Expo MCP](https://docs.expo.dev/mcp/). Reconnecter le client MCP après démarrage ou arrêt de Metro. Les capacités disponibles dépendent de la version du fournisseur ; une capture ou un appui réussi ne valide pas tout un parcours.

```sh
npx tsc --noEmit
npm run lint:boundaries
npx vitest run
npx jest --runInBand --watchman=false
# Dans functions/ :
npx tsc --noEmit
npx vitest run
# À la racine, JDK 21 installé :
JAVA_HOME=/opt/homebrew/opt/openjdk@21 npm run test:security
```

La matrice `_audit-reports/v1-local-qa-2026-11-25/JOURNEY_MATRIX.md` distingue les tests UI natifs, SDK, unitaires et les dépendances externes non validées. Les données de recette et identifiants restent synthétiques et privés. Ne copier aucun compte, média ou secret de production vers Dev.
