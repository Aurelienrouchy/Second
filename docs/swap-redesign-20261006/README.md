# Refonte de l’Espace échanges — 6 octobre 2026

Home, le catalogue, la proposition et le suivi des échanges utilisent désormais le même vocabulaire et une hiérarchie lisible. Le catalogue conserve son identité sombre ; la proposition et le suivi reprennent les surfaces claires du design system. La refonte corrige aussi l’attribution des articles donnés/reçus et l’affichage des compléments historiques.

Branche : `audit/seconde-security-ux-20261006`. Référence avant refonte : `581d08f2f9dfdf65f7cfd1a501b7fa295705614c`. Commit des sources et tests : `102f57410cd1433f6b4b102272c0fe77a9a238f2`. Les **41 fichiers modifiés** sont recensés avec leurs empreintes dans [source-manifest.json](source-manifest.json).

Le périmètre initial d’audit reste documenté séparément dans [../audit-20261006](../audit-20261006/README.md), sur la base `main b79d0c8e47a18ec9b405b13e8229a63f5ef02980`. Ce rapport ajoute des preuves sur les échanges ; il ne revendique pas une revue exhaustive du dépôt.

## Changements

- Home : « Espace échanges », aperçu des médias réellement disponibles, stock total et action « Découvrir les articles ». Le nombre de nouveautés d’un petit échantillon ne représente plus le catalogue entier.
- Catalogue : distinction entre vos articles et ceux à découvrir, accès à « Mes échanges », cartes 4:5 et libellés sans marque fictive. Vos articles sont repliés par défaut pour que le catalogue reste visible, même avec un inventaire important. Les ajouts en cours restent visibles.
- Dépôt : sélection, états chargement/erreur/vide, retry et publication d’un article lorsqu’aucun inventaire n’est disponible. Les feuilles restent montées uniquement lorsqu’elles sont ouvertes.
- Proposition : contexte du membre, sélection explicite des deux côtés, valeurs indicatives, message facultatif et envoi distinct. La sélection est conservée à la fermeture et lors d’une erreur ; un verrou synchrone bloque les envois répétés.
- Suivi : photos compactes, filtres sur une ligne défilante, statut et prochaine action. « Vous donnez » et « Vous recevez » restent corrects pour l’initiateur et le receveur.
- Détail : titre neutre, proposition envoyée/reçue selon le rôle, actions de réponse visibles en bas et confirmation avant refus/annulation. Les libellés distinguent remise, envoi postal manuel et réception.
- Compléments historiques : centimes convertis en dollars, payeur réel identifié, montant et devise insécables. Les commandes de paiement restent masquées lorsque `PAYMENTS_ENABLED=false`.

Aucune règle économique, aucun tarif, callable, service serveur ou feature flag n’est modifié dans cette refonte. Le choix existant d’un envoi postal manuel est conservé ; il n’active pas les étiquettes de livraison payantes. Les correctifs transactionnels précédents restent en place.

## Couverture des parcours

| Entrée réelle | Examiné et corrigé | Preuves | Limites |
| --- | --- | --- | --- |
| Home : composants Home et wrapper de feature | Photos, stock, action, chargement, erreur/retry, absence de stock | Jest Home ; captures avant/après, 320/390/768 px | Bandeau réel dans un contexte Home réduit, pas l’intégralité du feed |
| `/swap-zone` | Catalogue, invité, retour, vendeur unique, sélection multiple, filtre vide, dépôt, retrait, articles repliables | Jest `SwapPartyUI`, `useSwapZoneFilters` ; captures catalogue et dépôt ; interactions isolées | Contenus des 7 feuilles de filtres inchangés, remplacés par un adaptateur dans la revue web |
| `/propose-swap` | Paramètres invalides, article cible absent/vendu/inactif, inventaires, sélection, fermeture, envoi/erreur/succès, invité | Jest `proposeSwapUX`, `ValueComparisonBox` ; captures normal/prêt/envoyé et sélecteur loading/error/vide ; interactions isolées | Clavier et comportement des modales natifs non exécutés |
| `/my-swaps` | Invité, chargement, erreur/retry, absence de propositions, filtres et perspectives | Jest `MySwaps`, `SwapPresentation` ; captures 320/390 px et police agrandie ; interactions isolées | Défilement et recyclage FlashList natifs non exécutés |
| `/swap/[id]` | Invité, chargement, indisponible/retry, deux rôles, acceptation/refus/annulation, modes, photos, remise/envoi/réception, litige, évaluation, complément historique | Jest `SwapDetail`, `SwapActions`, `SwapPresentation` ; captures des 10 statuts et des deux rôles ; interactions isolées | Picker, upload réel, alertes natives, abonnement réseau réel et transitions sur appareil non exécutés |
| `/swap-parties`, `/swap-party/[id]` | Sources inspectées : redirection vers `/swap-zone` conservée | Inspection de ces deux petits fichiers | Pas de nouvelle page autonome à capturer |

Les tests des services d’échanges existants sont conservés et passent dans la suite Jest complète. Les tests Functions et règles sont exécutés par le workflow de la PR ; cette passe locale de refonte ne les présente pas comme nouvellement exécutés.

## Captures avant/après

Les images proviennent des **composants et routes React Native réels**, rendus par React Native Web avec des données fictives locales. Les vêtements SVG servent uniquement de médias de test. Aucune annonce réelle, compte, Firebase ou Stripe n’a été consulté dans cet aperçu.

| Vue à 390 px | Avant | Après |
| --- | --- | --- |
| Home | [Image](captures/before-home.png) | [Image](captures/after-home.png) |
| Catalogue | [Image](captures/before-catalogue.png) | [Image](captures/after-catalogue.png) |
| Proposition | [Image](captures/before-proposal.png) | [Image](captures/after-proposal.png) |
| Mes échanges | [Image](captures/before-mine.png) | [Image](captures/after-mine.png) |
| Proposition envoyée | [Image](captures/before-detail-sent.png) | [Image](captures/after-detail-sent.png) |
| Proposition reçue | [Image](captures/before-detail-received.png) | [Image](captures/after-detail-received.png) |

Autres preuves utiles : [catalogue à 320 px](captures/after-catalogue-narrow.png), [proposition à 320 px](captures/after-proposal-narrow.png), [police agrandie](captures/after-proposal-font130.png), [erreur du sélecteur](captures/after-proposal-error.png), [dépôt en erreur](captures/after-catalogue-deposit-error.png), [complément historique](captures/after-detail-legacy.png), [réception déjà confirmée](captures/after-detail-reception-confirmed.png).

La revue initiale des images a conduit à compacter le catalogue et les cartes du suivi, regrouper les devises, corriger une ponctuation doublée, supprimer les prédictions d’arrivage et adapter l’icône de remise. Les nouvelles captures ont été relues après ces corrections.

## Vérifications locales

Sous Node **20.20.2**, sans service de production :

| Contrôle | Résultat |
| --- | --- |
| Jest complet | **805/805**, 95 suites, sortie normale |
| Vitest app | **118/118**, 15 fichiers |
| TypeScript app, tests, Functions | Réussis |
| `EXPO_NO_TELEMETRY=1 npm run lint` | **0 erreur, 91 avertissements** |
| Frontières du dépôt | Réussies |
| Lint de l’aperçu de revue | Réussi, aucune erreur ni avertissement |
| Export offline iOS et Android | Réussi ; compilation des bundles, pas exécution sur appareil |
| Export web et landing statique Chromium | Réussis, **3/3** ; entrée web produit préservée |
| `git diff --check` | Réussi |
| Revue web isolée | **6 captures avant, 49 variantes après**, aucune erreur JavaScript, aucun appel distant autorisé, aucune largeur de document supérieure au viewport |

Les résultats détaillés sont dans [before-visual-results.json](before-visual-results.json), [after-visual-results.json](after-visual-results.json) et [interaction-results.json](interaction-results.json). Les contrôles d’interactions utilisent les destinations et mutations enregistrées dans les adaptateurs ; ils ne remplacent pas un E2E natif.

La CI du commit publié est suivie dans la [PR brouillon #2](https://github.com/Aurelienrouchy/Second/pull/2). Les résultats de cette CI sont distincts des résultats locaux ci-dessus.

## Reproduire la revue isolée

Les dépendances Vite, React Native Web et React Query déjà prévues par le dépôt sont réutilisées ; aucune dépendance de production n’a été ajoutée. Python Playwright et Chromium doivent être disponibles dans l’environnement de revue.

1. Installer les dépendances selon les instructions du dépôt, sous une version Node prise en charge.
2. Extraire la référence dans un dossier temporaire :

   ```bash
   mkdir -p /tmp/second-swap-before
   git archive 581d08f2f9dfdf65f7cfd1a501b7fa295705614c app components features constants utils hooks types store services lib config data shared assets/fonts functions/src/shared/sizeCatalog.json | tar -x -C /tmp/second-swap-before
   ```

3. Lancer les deux serveurs dans deux terminaux :

   ```bash
   SWAP_PREVIEW_ROOT=/tmp/second-swap-before SWAP_PREVIEW_PORT=4173 node node_modules/vite/bin/vite.js --config docs/swap-redesign-20261006/preview/vite.config.mjs
   SWAP_PREVIEW_PORT=4174 node node_modules/vite/bin/vite.js --config docs/swap-redesign-20261006/preview/vite.config.mjs
   ```

4. Lancer les captures puis les interactions :

   ```bash
   python3 docs/swap-redesign-20261006/capture-preview.py --phase before
   python3 docs/swap-redesign-20261006/capture-preview.py --phase after
   python3 docs/swap-redesign-20261006/check-interactions.py
   ```

Les scripts bloquent toutes les requêtes hors du serveur local. Les services Firebase, les mutations et le router sont remplacés par des adaptateurs explicites. Le renderer reste un outil de revue sous `docs/` ; les points d’entrée Expo et la landing produit ne le chargent pas.

## Ce qui reste à vérifier

- Appareil iOS/Android : safe areas réelles, rotation, clavier, grandes polices système, lecteur d’écran, gestures, alertes, galerie, animations et virtualisation. Les insets de l’aperçu sont simulés à 24/20 px ; l’agrandissement web à 130 % ne prouve pas le comportement de Dynamic Type.
- Parcours entre deux comptes sur émulateurs/appareil : authentification réelle, abonnement réseau, preuve photo, confirmation et litige. Les contrôles serveur existants restent couverts séparément.
- Maestro natif : workflow du dépôt toujours désactivé, aucun appareil disponible dans cet environnement. Aucune exécution ni capture native revendiquée.
- Les risques et décisions propriétaire de l’audit initial restent listés dans son rapport : rotation/historique, anciens médias privés, données ou résultats financiers ambigus, APNs/EAS et dépendances restantes. La refonte n’effectue pas de migration ni de rapprochement externe.

Aucun merge, déploiement, paiement réel, modification de compte externe, rotation de secret ou réécriture d’historique distant n’a été effectué.
