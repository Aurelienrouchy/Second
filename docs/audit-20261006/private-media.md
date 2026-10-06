# Nouveaux médias privés : références sans bearer token

Lot complémentaire de l'audit, demandé après revue indépendante. Branche
`audit/seconde-security-ux-20261006` ; changements locaux non déployés. Ce lot
couvre le client chat/swap et le contrat de rendu partagé. Le lot sell utilise
ce contrat pour les brouillons/IA ; les règles et la validation serveur des
preuves appartiennent à l'orchestrateur et aux agents backend.

## Inventaire et constat confirmé

Fichiers examinés : `services/chatService.ts`, `components/ChatBubble.tsx`,
`app/swap/[id].tsx`, `features/swap/components/SwapStatusView.tsx`,
`features/swap/components/SwapActions.tsx`, `types/index.ts`,
`utils/fixStorageUrl.ts`, `config/firebaseConfig.ts`,
`config/firebaseEnvironment.ts`, les tests de chat et les règles Storage.
Examen ciblé du SDK installé : `@firebase/storage` transport `getBytes`,
`makeRequestWithTokens` et connexion XHR ArrayBuffer ; types expo-image
`ImageSource`/`ImageProps` et `cachePolicy`. Aucun catalogue complet de fichiers
n'est revendiqué dans ce lot.

Le chat publiait `getDownloadURL()` pour l'image et la miniature. Le parcours de
preuve swap publiait également `getDownloadURL()` après l'upload. Ces nouvelles
URL contenaient un jeton de téléchargement donnant accès hors des contrôles
normaux de règles. Le durcissement des règles seul ne fermait donc pas le
parcours normal de publication de liens.

## Contrat et correctifs

`utils/privateMedia.ts` produit une référence canonique HTTPS stable :
`https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path-encodé>?alt=media`.
Il ne crée ni ne récupère de bearer URL. Le parseur accepte uniquement le bucket
configuré et les chemins privés `drafts/`, `chat_images/` et
`swaps/{id}/photos/`. Il sait lire une référence `gs://` ou une ancienne URL de
ce même bucket, en retirant les paramètres de jeton avant accès SDK. Hôtes
externes, autres buckets, chemins publics et chemins malformés sont refusés.
Les articles et avatars publics gardent leur rendu existant.

Les nouveaux uploads chat/swap demandent `contentType:image/jpeg`,
`cacheControl:private, no-store, max-age=0` et un champ de download token vide.
**Ce dernier est une demande de métadonnée, pas une garantie d'absence de token
sur l'objet : l'API Storage peut générer un token automatiquement.** Les
snapshots/réponses d'upload sont ignorés et aucune valeur `downloadTokens` ou
URL `getDownloadURL()` n'est retournée, loggée ou enregistrée dans les messages
et preuves. Le test de chat simule explicitement une réponse avec token
automatiquement généré et vérifie qu'il n'est pas propagé.

Les noms de fichiers utilisent un UUID afin que des envois simultanés ne
réutilisent pas un nom basé uniquement sur la milliseconde. Le chat vérifie
également la session avant de téléverser des octets ; une ancienne session ne
crée aucun média avant son rejet.

`hooks/usePrivateMediaSource.ts` utilise `getBytes(ref(storage,path),10 MiB)`.
Le SDK gère Auth, AppCheck éventuel et le routage émulateur ; aucun header
Authorization n'est construit par l'application ni passé à expo-image ou à un
hôte arbitraire. Les octets deviennent une data URI en mémoire. Le maximum SDK
limite les octets retournés ; un objet trop grand peut être tronqué par le SDK,
ce qui ne constitue pas une validation complète de sa taille.

Le hook observe les changements du token ID Firebase. Il vide la source et
relit via le SDK lors d'un refresh ; les refus de lecture n'ont aucun fallback
public. Le rendu vérifie UID et référence dès chaque render, avant les effets.
Les résultats tardifs sont rejetés après changement d'UID, de référence,
déconnexion ou démontage. Les octets d'un ancien compte ne redeviennent pas
visibles à la résolution d'une ancienne requête.

`components/PrivateStorageImage.tsx` force `cachePolicy="none"` et remonte une
vue native vide quand la source est supprimée, afin d'éviter un ancien bitmap
visible. Son option explicite `allowLocalSource` sert uniquement aux previews
locales (file/content/ph/assets-library/blob/data image), et exige aussi
`localSourceOwnerUid`, capturé avec les octets, égal à l'UID Firebase courant.
`hooks/useFirebaseUserId.ts` observe ce dernier via `useSyncExternalStore` ;
une preview locale montée est vidée au logout ou changement de compte sans
attendre un reset de l'écran. Un propriétaire absent ou différent est refusé.
Le lot sell utilise aussi ce hook pour masquer le texte et les actions d'un
brouillon d'un ancien compte. Une URL distante ne peut jamais servir de
fallback anonyme. Aucune nouvelle copie de fichier, cache
disque applicatif ou cache partagé entre UID n'est créée. La maîtrise effective
des caches HTTP/native sur appareil reste à valider ; les nouveaux uploads
portent la politique HTTP no-store et les objets anciens ne sont pas modifiés.

Les miniatures et la modal du chat utilisent ce composant ; la grande photo
n'est chargée qu'à l'ouverture de la modal. Le parcours swap actuel n'a pas de
visualiseur des photos de preuve (seulement un indicateur d'upload) ; ses
références publiées sont corrigées et le composant est disponible pour les
consommateurs privés. Le lot sell raccorde ses previews au même composant.

## Matrice de vérification

| Parcours | Examiné/corrigé | Testé | Limite |
| --- | --- | --- | --- |
| Upload chat + miniature | Oui : UUID, session et références canoniques | 14 tests chatservice, dont 2 nouveaux de média | SDK/upload/Firestore mockés |
| Upload preuve swap | Oui : référence canonique et métadonnées no-store | Typecheck et lecture ; règles/proof serveur autre lot | Pas de tap appareil ou upload réel |
| URL legacy, gs, canonical, autre bucket/hôte, chemins publics | Oui | 5 tests parseur | Pas de révocation des anciens tokens |
| Octets image/mime/base64 | Oui | 2 tests couvrant padding et frontières de chunks | Décodage natif sur appareil non vérifié |
| Chargement privé, refus, logout, UID avant callback, refresh, résultat tardif | Oui | 8 tests hook | Auth/Storage mockés |
| Cache image natif, fallback externe, preview locale avec propriétaire, suppression au logout/changement UID | Oui | 7 tests composant | Bitmap/cache système réels non inspectés |
| Preview canonique de brouillon, texte/actions d'ancien compte, revue photos sell | Contrat partagé avec lot sell | 3 tests d'intégration sell | React/SDK mockés ; lot sell couvre le stockage local par UID |
| Accès intercomptes aux bytes et absence de distribution HTTP bearer | Contrat raccordé | Tests règles/proof dans rapport global parent | Runtime Storage officiel bloqué HTTP 403 ; aucune preuve d'absence de token sur objet |

## Vérifications exécutées

- `npx vitest run utils/privateMedia.test.ts` : **7/7**.
- Jest ciblé hook, composant et service chat : **29/29**, trois suites.
- Ensemble précédent plus preview de brouillon et revue photos sell : **32/32**, cinq suites (inclut les 29 tests précédents).
- `npx tsc --noEmit` app : **passé**.
- `npm run typecheck:tests` : **passé**.
- ESLint ciblé : **passé**.
- `git diff --check` : **passé**.
- Validation globale et lint:boundaries final : sous responsabilité du parent.

Aucun accès à Firebase/Stripe de production, envoi réel, mutation d'objet ancien,
révocation de token ou édition native. Les tests ne contiennent que des valeurs
fictives de token et des mocks de transport ; aucune valeur secrète réelle n'a
été lue ou reproduite.

## Restant à vérifier / action propriétaire

Le rendu réel iOS/Android, les performances de conversion mémoire, les caches
HTTP/native et l'envoi/lecture sur un bucket staging doivent être vérifiés sur
une application signée et des comptes de test. Le runtime Storage nécessaire
au test HTTP n'est pas disponible ici ; aucune réussite de ce test n'est
revendiquée. Les tests mocks et l'examen du SDK ne remplacent pas cette preuve.

Les anciens liens bearer déjà émis ou copiés restent utilisables tant que leurs
tokens existent. Leur révocation, les migrations historiques et une éventuelle
politique de suppression de tokens sur objets demandent une action externe
séparée du propriétaire ; elles n'ont pas été exécutées. Même les objets
nouveaux peuvent avoir un token auto-généré par l'API : ce correctif garantit
que le flux normal de l'application ne le distribue pas. Les destinataires
autorisés peuvent toujours conserver les octets qu'ils ont reçus.

La mise en production conjointe des règles et du code reste nécessaire avant
de considérer le parcours de production corrigé. Aucun déploiement autorisé
ou effectué dans ce mandat.
