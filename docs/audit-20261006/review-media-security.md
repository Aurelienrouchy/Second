# Revue indépendante — règles, médias et favoris

Revue du commit `7551244971b19efb0269df15a35e48763c273bc3` contre `b79d0c8e47a18ec9b405b13e8229a63f5ef02980`, réalisée le 2026-10-06. Les constats ci-dessous décrivent cette version, avant les correctifs complémentaires demandés par l’orchestrateur. Aucun accès aux données Firebase/Stripe, modification de permission distante, opération sur média historique, rotation ou déploiement. Revue ciblée, sans revendication de couverture exhaustive.

## Constats confirmés par le code

### R1 — P1 : les nouveaux médias privés émettent encore des capacités bearer

`services/chatService.ts:437-454` appelle `getDownloadURL` pour chaque nouvelle image de chat et sa miniature. `app/swap/[id].tsx:330-335` fait de même pour les nouvelles preuves. `services/aiService.ts:194-196` construit les nouvelles URL de draft avec le token retourné par Storage. Les nouvelles règles de lecture (`storage.rules:60-64`, `76-79`, `88-94`) contrôlent les requêtes SDK authentifiées, mais ces URL donnent une capacité transmissible de téléchargement. Ce problème concerne aussi les fichiers nouvellement créés ; la seule réserve sur les anciens liens du rapport `media-rules.md:34` est insuffisante.

La [documentation officielle Firebase](https://firebase.google.com/docs/storage/web/download-files#download_data_via_url) montre le téléchargement direct d’une URL par GET sans en-tête Firebase, et distingue [le téléchargement SDK avec règles](https://firebase.google.com/docs/storage/web/download-files#download_data_directly_from_the_sdk). Cela ne permet pas de découvrir un token inconnu ; cela signifie qu’un tiers possédant le lien peut lire le média sans être participant.

Scénario test manquant : créer une **nouvelle** image de chat/proof/draft dans un environnement jetable, obtenir le lien par le parcours normal, puis faire un GET avec ce lien sans Authorization et avec un compte tiers. Vérifier parallèlement que `getBytes` hors participants échoue. Les tests `tests/security/storage.rules.test.ts:118-149` vérifient seulement ce second canal. Le test HTTP et les changements de livraison des nouveaux médias doivent rester distincts d’une éventuelle migration historique, non autorisée ici.

### R2 — P1 : une écriture Firestore directe contourne la promotion des images

`firestore.rules:149-151,178-192` permet encore au vendeur d’éditer directement tous les champs non présents dans la liste protégée ; `images` ne fait pas partie de cette liste. Une requête `updateDoc` peut donc réintroduire une URL `drafts/`, utiliser une URL arbitraire, supprimer les photos ou remplacer l’array par un objet. Le callable `updateArticle` (`functions/src/callable/products.ts:685-719`) applique les validations et la promotion uniquement si le client choisit de l’appeler. Les nouvelles publications server-only ne suffisent pas à préserver l’invariant après édition.

Impact : nouveaux médias publiés encore expirables, médias inexistants ou forme d’images cassant les consommateurs. En particulier, `publishedDraftPaths` itère sans validation à `functions/src/utils/articleMedia.ts:60` ; une valeur objet non itérable fait échouer le scan, puis le cleanup échoue fermé pour tout le lot. Il ne s’agit pas d’un accès à un fichier privé dont le lien est inconnu.

Scénario test : vendeur d’un article valide non vendu tente successivement `updateDoc({images:[{url: ownDraftUrl}]})`, `updateDoc({images:{}})` et `updateDoc({images:deleteField()})` ; ces écritures doivent être refusées, tandis qu’un titre valide reste modifiable. Une édition via callable doit promouvoir une image propre et refuser celle d’un autre compte.

### R3 — P2 : une URL sans objet peut être enregistrée comme preuve immutable

`functions/src/callable/swaps.ts:1143-1147` vérifie correctement le bucket configuré et le préfixe du swap/uploader, mais ne lit pas l’objet. `1173-1199` enregistre ensuite la preuve et peut faire avancer le swap. Un participant peut fournir une URL syntaxiquement valide vers `swaps/{swapId}/photos/{uid}/absent.jpg` sans rien téléverser ; il obtient une preuve enregistrée, non remplaçable, et le statut avance si l’autre participant a déjà soumis la sienne. Un chemin avec sous-répertoire passe aussi le préfixe alors que la règle d’upload nouvelle autorise un seul segment de nom de fichier. Le scénario autre bucket a été relu et est **déjà rejeté** à la ligne 1144.

Scénario test : swap `photos_pending` avec preuve de l’autre côté, participant soumettant URL propre inexistante ; attendre un refus et aucune mutation. Tester également objet non image, taille à la limite de 10 Mio, chemin autre UID/autre bucket, sous-répertoire, puis objet propre présent et valide. Aucun statut ni preuve ne doit changer en cas d’échec.

### R4 — P2 : le nettoyage supprime sans vérifier la génération inspectée

`functions/src/scheduled/cleanupDrafts.ts:40-46` lit une date de création puis supprime le nom sans condition de génération. Les propriétaires peuvent remplacer leurs drafts (`storage.rules:62-64`). Si un vieux fichier est remplacé après sa lecture de métadonnées mais avant `delete`, le nettoyage peut supprimer la nouvelle génération récente. Les noms honnêtes incluent un timestamp, ce qui réduit ce cas dans l’app, sans le rendre impossible pour le chemin autorisé.

Autre limite : la liste de références publiée est un snapshot pris une fois (`cleanupDrafts.ts:32`). Une nouvelle référence directe/legacy ajoutée après ce scan peut être supprimée. Le parcours canonique avec promotion prévient ce cas pour ses nouvelles publications ; fermer R2 réduit l’exposition, sans rendre la migration legacy atomique.

Scénario test : retourner des métadonnées âgées pour génération G1, simuler une ré-upload G2 avant delete, exiger `ifGenerationMatch=G1` et conserver G2. Ajouter une référence après le scan pour établir précisément la stratégie retenue pour les anciens liens. Tests actuels (`cleanupDrafts.test.ts:12-26`) couvrent les âges et références statiques, pas ces courses.

### R5 — P2 : favoris malformés empoisonnent le trigger désormais réessayé

`firestore.rules:380-385` accepte une liste sans valider ses éléments. `functions/src/triggers/favorites.ts:31-46` traite ceux-ci comme des identifiants, puis `doc(id)` rejette null, nombre, objet, chaîne vide ou identifiant comportant un chemin invalide. Le trigger a maintenant `retry:true` (`25`) et propage l’erreur (`118-120`). Une écriture autorisée telle que `{userId: uid, articleIds: [null, 'a']}` peut provoquer des tentatives répétées et empêcher la projection de l’article valide dans cet événement. Une correction ultérieure de la source n’efface pas l’entrée malformée de l’ancien événement réessayé.

Vérification locale exécutée sans réseau : `new Firestore({projectId:'demo-second'}).collection('articles').doc(id)` rejette les cinq formes ci-dessus dans le SDK installé. Les règles runtime n’ont pas été exécutées ; leur validateur visible contrôle seulement le type liste et sa longueur.

Scénario test : règle refusant éléments non string/ID vide/chemin ; trigger recevant malgré tout un ancien événement malformé doit ignorer/quarantainer ces éléments sans réessai permanent, et projeter les IDs valides. Tester également source live malformée. La source canonique et l’agrégation transactionnelle restent pertinentes ; ce constat ne remet pas en cause les tests valides de création/replay/désordre/multi-acheteur.

### R6 — P2 : la promotion précède le contrôle de propriété de l’article édité

`functions/src/callable/products.ts:709-719` copie les images avant de lire l’article et contrôler vendeur/réservation (`811-824`). Un compte authentifié peut appeler `updateArticle` sur l’ID d’un autre vendeur avec une image staged dont il est propriétaire. La requête est finalement refusée, mais un fichier a déjà été copié par Admin sous `articles/{foreignId}/…`. Les UUID évitent l’écrasement d’une photo existante et l’origine staged est bien contrôlée ; l’effet résiduel est une création de médias publics/orphelins dans le namespace d’un autre vendeur, y compris réservé.

Scénario test : image staged propre + article d’un autre vendeur (ou vendu), attendre refus **sans** appel Storage copy. Vérifier aussi refus d’article inexistant. Effectuer le contrôle de propriété/état avant la promotion, puis conserver le recontrôle transactionnel pour la course d’acceptation ; les orphelins dus à un échec de commit restent un problème distinct déjà documenté.

### R7 — P1 : le verrou de transaction des callables n’est pas équivalent aux règles directes

Les callables produits consultent toutes transactions non terminales et `activeTransactionId` (`functions/src/callable/products.ts:91-108`). Les règles article et Storage ne contrôlent que `isSold==false` (`firestore.rules:156-158,192`, `storage.rules:18`). Un article remis non vendu par un ancien flux/litige, tout en gardant une transaction non terminale, reste éditable/supprimable directement. Par exemple le serveur de signalement d’absence remet `isSold:false` (`functions/src/callable/payments.ts:3029`) sans rendre la transaction terminale. Les contrôles `deleteField` protègent correctement le champ de verrou lui-même, mais ne ferment pas ce chemin de mutation.

Scénario test : article `isSold:false`, `activeTransactionId` lié à une transaction `meetup_disputed` ; refuser titre, désactivation, hard delete et overwrite/delete Storage par son vendeur jusqu’à résolution explicite. Tester aussi un document legacy lié par `articleId` avec champ de lien manquant et documenter la migration requise. Aucun état distant de ce type n’a été consulté.

### R8 — P2 : les images de l’article courant ne vérifient pas l’objet

À HEAD, `functions/src/utils/articleMedia.ts:32` retourne une URL du namespace de l’article courant avant toute lecture Storage. Un vendeur peut donc demander au callable de conserver une URL de son article vers un objet absent ou non image ; le statut d’ownership du chemin ne prouve pas son existence. Le contrôle staged à la ligne 37 n’exclut pas non plus une taille absente/non numérique/égale à zéro. Les métadonnées privées de staging sont copiées et seul le token de téléchargement est modifié à la ligne 44, ce qui peut conserver la politique `no-store` du nouveau parcours privé même pour la copie publique.

Scénario test : URL `articles/{ownId}/missing.jpg`, puis objet non image et tailles absente/NaN/0/10 Mio ; refuser sans copy. Une photo existante valide doit être conservée sans rotation de token ni modification de métadonnées. Une nouvelle promotion publique doit définir sa politique cache publique explicitement.

## Ce que la relecture confirme

- Les champs serveur listés utilisent désormais `affectedKeys`, couvrant ajouts/modifications/suppressions ; la suppression d’`isSold` et des compteurs n’est plus un contournement visible de cette liste.
- Création d’articles, messages système/offres et projection de favoris réservés au serveur ; nouveaux messages ordinaires liés aux participants/receiver du chat.
- Upload article d’un autre compte refusé ; nouveaux proofs Storage liés à l’UID, création seulement au statut attendu, overwrite/delete interdits. La règle legacy refusant write n’annule pas l’autorisation de la règle précise : Firebase combine les autorisations qui correspondent.
- Promotion des nouvelles images par les callables vers `articles/` ; metadata image/taille et propriété staged contrôlées. Conservation des références legacy de brouillons, y compris annonces vendues/inactives, et échec fermé du cleanup quand le scan échoue.
- Premier favorite document couvert par `onDocumentWritten` ; agrégation de la source live, accusé individuel et compteur optimiste évitent le delta doublé et le 0 transitoire dans les scénarios testés.

## Inventaire et limites de validation

Relus : `storage.rules`, `firestore.rules`, `functions/src/utils/articleMedia.ts` et test, `functions/src/scheduled/cleanupDrafts.ts` et test, `functions/src/triggers/favorites.ts` et test, parties `products.ts`/`swaps.ts`/`payments.ts` citées, `services/articlesService.ts`, `services/aiService.ts`, `services/chatService.ts`, `services/draftService.ts`, `hooks/useFavorites.ts`, upload `app/swap/[id].tsx`, `tests/security/storage.rules.test.ts`, `tests/security/articles.rules.test.ts`, `docs/audit-20261006/media-rules.md`.

Vérification exécutée pendant cette relecture : validation synchrone des chemins d’identifiants par le vrai SDK Firestore installé, sans RPC. Lecture des tests existants et documentation primaire Firebase. Aucun test end-to-end, appareil, runtime de règles ou GET distant par token ; les jars officiels d’émulateur restent bloqués par HTTP403 dans cet environnement. Les scénarios ci-dessus sont les régressions recommandées, pas des affirmations de tests déjà verts.

## Suivi des correctifs complémentaires

Après ce rapport, l’orchestrateur autorise dans ce lot uniquement : fermeture de la mutation directe d’`images`, tests règles correspondants, contrôle des objets réels de preuves et tests unitaires. Les nouveaux liens privés, autres défauts et changements historiques restent coordonnés séparément. Les résultats seront ajoutés ici sans effacer les constats de la version relue.

Le périmètre a ensuite été élargi explicitement aux favoris malformés, au nettoyage avec génération, à la préautorisation de la promotion et aux verrous directs d’articles.

| Constat | Correctif complémentaire local | Preuve exécutée / limite |
|---|---|---|
| R1 | Livraison privée des **nouveaux** médias coordonnée par l’orchestrateur et les lots client ; aucun changement de ce canal par ce relecteur | Le constat HEAD reste conservé ; aucun test HTTP bearer distant ni migration historique revendiqué |
| R2 / R7 Firestore | Toutes écritures directes d’articles refusées. Les méthodes actives `ArticlesService.updateArticle` et `deleteArticle` utilisaient déjà `updateArticle` (suppression = `isActive:false`) ; les champs éditables restent disponibles via ce callable qui consulte aussi les transactions legacy sans lien | Tests règles ajoutés pour images/désactivation/delete/lien legacy ; test backend vérifie titre et soft delete légitimes via callable |
| R3 | Préflight participant/statut/preuve existante ; chemin exact bucket/swap/UID/fichier ; getMetadata de chaque objet, image, taille finie positive <10 Mio ; relecture transactionnelle après validation. Objet manquant ou invalide = aucune preuve et aucun statut modifiés | `uploadSwapPhotos.test.ts` : objet absent, metadata invalide, chemins/bucket/UID, non-participant avant lecture Admin, deux participants valides, double soumission concurrente, annulation pendant lecture |
| R4 | Delete avec `ifGenerationMatch` de la génération inspectée ; metadata sans génération = conservation | Course simulée G1 ancienne remplacée par G2 fraîche : G2 reste ; tests âge/référence/panne conservés. Le snapshot de références legacy n’est toujours pas atomique avec de nouvelles écritures Admin |
| R5 | Règles : roundtrip join/split refuse éléments non string et séparateurs, bornes d’IDs et rejet IDs réservés. Trigger : filtre défensivement les événements et source live legacy invalides, en conservant la projection des IDs valides | Test événement `[null,…,'a']` rejoué : compteur 1, aucune écriture sur chemin invalide ; source live malformée et anciens événements ne ressuscitent pas de like. Nouveaux tests rules attendent runtime |
| R6 | Propriété, existence, disponibilité et engagements vérifiés avant toute promotion d’images, puis même garde transactionnelle avant persistance | Refus article tiers/inexistant/vendu/inactif/legacy engagé sans appel de promotion ; acceptation pendant promotion refusée au commit ; publication propre validée. Copies orphelines si un accord arrive **après** le préflight demeurent la limite Storage/Firestore non atomique documentée |
| R7 Storage | `isSold:false` complété par lien absent/null ou transaction explicitement terminale ; lien manquant/inconnu/non terminal refuse write/delete | Tests Storage ajoutés dispute/pending/processing/lien manquant et statuts terminaux. Storage ne peut rechercher une transaction legacy par query : un vieil article sans champ de lien et avec isSold faux nécessite toujours migration/fermeture serveur de l’édition des objets |
| R8 | Même contrôle existence/MIME/taille finie positive <10 Mio pour staged et images déjà dans l’article ; image courante valide conservée sans copie ni modification de metadata/token. Nouvelle copie uniquement : cache `public, max-age=3600`, remplaçant le cache privé hérité du staging | `articleMedia.test.ts` : manque d’objet, mauvaise MIME et cinq tailles invalides pour les deux modes, absence de copy/setMetadata pour images courantes, cache public appliqué aux nouvelles copies ; promotion de draft sans token maintenue |

Validation locale complémentaire finale : **65/65 Vitest**, cinq fichiers (`uploadSwapPhotos`, `articleCommitmentGuards`, `favorites`, `cleanupDrafts`, `articleMedia`), exit 0 ; `functions/node_modules/.bin/tsc --noEmit -p functions/tsconfig.json` et `node_modules/.bin/tsc --noEmit -p tsconfig.test.json` passent ; `git diff --check` passe. ESLint configuré ignore `functions/**` et `tests/**` ; son exit 0 avec avertissements d’exclusion n’est pas revendiqué comme lint backend.

L’orchestrateur a depuis trouvé un runtime **Firestore officiel**. Son run intermédiaire des nouvelles règles a passé 183/184 cas ; le seul échec provenait de la catégorie d’assertion : un ID array imbriqué est refusé par le SDK avant une requête de règles, avec `invalid-argument`. Le cas est conservé en test dédié de ce rejet SDK ; les autres IDs invalides restent des assertions permission-denied. Exécution finale après cet ajustement coordonnée par l’orchestrateur. Runtime Storage toujours indisponible, donc tests Storage non exécutés ici. Aucun commit/publication par ce relecteur.
