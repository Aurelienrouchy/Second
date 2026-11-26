## 17. Conformité & légal (Loi 25 / Canada)

> Cette section décrit ce que l'application Second fait **réellement** en matière de protection des renseignements personnels, conformément à la **Loi 25 du Québec** (loi modernisant le régime québécois de protection des renseignements personnels) et à la **LPRPDE (PIPEDA)** fédérale. Chaque affirmation ci-dessous a été vérifiée dans le code. Les écarts entre ce que la loi attend, ce que nos textes annoncent et ce que le code fait sont signalés explicitement — ils sont regroupés en fin de section (17.12).

Second se positionne comme une entreprise québécoise (« Seconde Inc. », Montréal, Québec) qui traite des renseignements personnels de Canadiens. La conformité Loi 25 n'est pas un module isolé : elle est tissée dans le parcours d'inscription, les réglages de confidentialité, la gestion des décisions automatisées de la place de marché, et l'outillage d'administration. Les traitements sensibles (consentements, incidents, suppression de compte) sont exécutés **côté serveur** (Cloud Functions, région de Montréal `northamerica-northeast1`), jamais laissés au client, car les garde-fous côté application sont contournables.

**Contexte produit à garder en tête** : la livraison et les paiements sont **désactivés** aujourd'hui (`config/featureFlags.ts` → `SHIPPING_ENABLED = false`, `PAYMENTS_ENABLED = false`). Le seul parcours d'achat actif est la **rencontre (meetup)**, sans argent qui transite par la plateforme. Plusieurs mécanismes décrits ci-dessous existent et sont corrects, mais **ne se déclenchent pas encore en production** ; c'est dit à chaque fois.

---

### 17.1 Vue d'ensemble des droits couverts

| Droit / obligation (Loi 25) | Implémentation Second | Où, pour l'utilisateur |
|---|---|---|
| Consentement éclairé à l'inscription (art. 12) | Cases à cocher CGU + Politique de confidentialité obligatoires, opt-in marketing facultatif, journalisés serveur | Écran obligatoire **après** création du compte (« Complétez votre profil ») |
| Barrière d'âge (mineurs) | Date de naissance exigée, âge ≥ 16 ans revalidé **serveur** pour s'inscrire/acheter ; ≥ 18 ans pour vendre (barrière **écran** aujourd'hui, voir 17.2) | Même écran |
| Retrait du consentement marketing (art. 14 / LCAP) | Interrupteur « Communications marketing », retrait journalisé en mode append-only + coupure serveur des envois | Réglages › Confidentialité |
| Confidentialité par défaut (art. 9.1) | Photo de profil, profilage IA et marketing **désactivés par défaut**. Exception assumée : les statistiques d'usage sont en **opt-out** (activées par défaut) | Réglages › Confidentialité |
| Droit à la portabilité (art. 27) | Export de toutes les données personnelles en fichier JSON | Réglages › Confidentialité › Exporter mes données |
| Droit à l'effacement | Suppression de compte avec nettoyage exhaustif + garde-fous financiers serveur | Réglages › Confidentialité › Supprimer mon compte (ou Réglages, en bas) |
| Décisions automatisées (art. 12.1) | Information, explication des critères, et droit de contester (révision humaine) | Fiche de suivi dans la conversation liée à la commande |
| Registre des incidents (art. 3.5–3.8) | Collection serveur d'incidents, escalade vers la CAI, avis aux personnes touchées | Fonctions admin uniquement — **aucun écran** |
| Rétention/destruction (art. 23) | Tâche planifiée quotidienne de purge des données périmées | Automatique (serveur) |
| Pages légales accessibles | CGU + Politique de confidentialité + Mentions légales, lisibles **avant** consentement (sans être connecté) | Liens de l'écran de consentement + Réglages › À propos |

---

### 17.2 Consentement à l'inscription

#### Parcours réel
Le consentement n'est **pas** un bloc à l'intérieur du formulaire d'inscription. C'est un **écran dédié et obligatoire** (`app/complete-profile.tsx`), atteint **après** que le compte Firebase a été créé, et qui vaut pour les deux modes d'entrée :

- **inscription par email** : le compte est créé « nu », sans date de naissance ni consentement ;
- **connexion sociale Google/Apple** : le compte est créé par le fournisseur, puis l'écran s'impose.

Cet écran demande, dans cet ordre :

1. Le **@pseudo** choisi (vérification de disponibilité en direct).
2. La **date de naissance** (trois champs JJ / MM / AAAA).
3. Case **« J'ai lu et j'accepte les Conditions d'utilisation »** — obligatoire.
4. Case **« J'ai lu et j'accepte la Politique de confidentialité »** — obligatoire.
5. Case **« J'accepte de recevoir des offres, baisses de prix et nouveautés (vous pouvez vous désabonner à tout moment) »** — facultative (opt-in marketing).

Les libellés des CGU et de la Politique sont des **liens cliquables** vers les pages légales publiques (`app/legal/terms`, `app/legal/privacy-policy`). Le bouton **CONTINUER** reste **désactivé** tant que le pseudo n'est pas valide et disponible, que la date de naissance ne donne pas un âge ≥ 16 ans, et que les deux cases obligatoires ne sont pas cochées.

#### Le compte existe avant le consentement — et il est verrouillé
**Correction importante par rapport aux versions précédentes de ce document : il n'y a pas d'annulation (rollback) du compte si l'utilisateur abandonne.** Le mécanisme réel est un **verrou** :

- Un compte sans date de naissance est marqué `pendingConsent` : il n'est **ni** connecté (aucune capacité de l'app ne s'ouvre), **ni** simple visiteur.
- Un garde de démarrage (`features/auth/hooks/useConsentGuard.ts`) **renvoie systématiquement** cet utilisateur sur l'écran de consentement, à chaque lancement, tant que le consentement n'est pas enregistré. Le retour arrière est bloqué (y compris le bouton « retour » Android). Seules les pages légales restent accessibles depuis cet écran.
- Conséquence produit à assumer : un compte Firebase et une fiche `users/{uid}` existent donc **avant** tout consentement, pour un utilisateur qui n'a peut-être jamais accepté quoi que ce soit. Ces comptes « en attente de consentement » **ne sont purgés par aucune tâche automatique** (voir 17.8 et 17.12).
- Un pseudo déjà pris est une **erreur de champ** sur l'écran — le compte n'est pas détruit, l'utilisateur en choisit un autre.

#### Règle d'âge (calcul côté serveur)
La date de naissance n'est pas seulement validée côté écran : la fonction serveur `recordSignupConsent` la revalide (`functions/src/callable/consent.ts`).

- Format attendu : ISO `AAAA-MM-JJ` ; les dates impossibles (ex. 30 février) sont rejetées.
- L'âge est calculé en tenant compte du **fuseau America/Toronto** (marché cible), pour aligner le calcul serveur sur l'heure locale canadienne.
- **Minimum 16 ans pour s'inscrire et acheter** (`MIN_AGE_REGISTER`). En dessous : refus avec le message « Vous devez avoir au moins 16 ans pour utiliser Second ».
- **Minimum 18 ans pour vendre** (`MIN_AGE_SELL`, `utils/age.ts`) : un 16-17 ans peut acheter et naviguer, la vente lui est refusée avec la copie `COPY_SELL_GATE` (« La vente d'articles est réservée aux personnes de 18 ans et plus, car notre partenaire de paiement Stripe exige cet âge… »).

> **Trou à connaître (barrière 18 ans)** : la barrière de vente est appliquée **à l'écran** (onglet Vendre, `app/(tabs)/_layout.tsx`) et **côté serveur uniquement à l'ouverture du compte de versement Stripe** (`functions/src/callable/payments/connectAccount.ts`, refus si âge < 18 au jour près). La fonction serveur qui **publie un article** ne vérifie que l'email vérifié, **pas l'âge**. Et comme les paiements sont désactivés, l'écran Stripe est aujourd'hui inaccessible. Autrement dit : aujourd'hui, la barrière 18 ans repose sur l'écran seul et serait contournable par un appel direct. À corriger avant d'ouvrir les paiements.

#### Ce qui est enregistré (preuve de consentement)
`recordSignupConsent` écrit, en **une seule transaction** (tout ou rien : réservation du pseudo + date de naissance + preuves de consentement) :

- Sur la fiche utilisateur (`users/{uid}`) : la **date de naissance** (chaîne ISO) et le **@pseudo** réservé.
- Dans la sous-collection `users/{uid}/consents`, un document par consentement accordé :
  - `terms` (CGU) — toujours,
  - `privacy_policy` (Politique) — toujours,
  - `marketing` — uniquement si l'opt-in a été coché.

  Chaque document porte : `type`, `version` (la **version de politique** `POLICY_VERSION = '2026-05-31'`, qui correspond bien à la date affichée « 31 mai 2026 » sur les pages légales), `acceptedAt` (horodatage serveur), et `channel: 'app'`.

**Règle de gestion clé — preuve immuable** : les documents de consentement sont écrits **exclusivement côté serveur** (Admin SDK). Les règles Firestore interdisent toute écriture, mise à jour ou suppression côté client (`allow create, update, delete: if false`, `firestore.rules`). Le propriétaire peut seulement **lire** son propre historique. L'horodatage et la version restent donc faisant foi et infalsifiables.

---

### 17.3 Consentement marketing : retrait append-only + coupure serveur

Le marketing repose sur un **double mécanisme** exigé par la Loi 25 (art. 14) et la Loi canadienne anti-pourriel (LCAP).

Dans **Réglages › Confidentialité**, un interrupteur « Communications marketing » permet d'accorder ou de retirer le consentement à tout moment. La bascule n'écrit **pas** directement la préférence côté client : elle appelle la fonction serveur `setMarketingConsent`, qui réalise deux actions en un seul lot :

1. **Journalisation append-only (preuve)** : un **nouveau** document est ajouté dans `users/{uid}/consents` (`type: 'marketing'`, `granted: true|false`, `version`, `acceptedAt`, `channel`). Les documents existants ne sont **jamais** modifiés — chaque octroi et chaque retrait laisse une trace datée distincte.
2. **Application serveur (effet)** : trois drapeaux de notification sont mis à `true`/`false` — `priceDrops` (baisses de prix), `articleFavorited` (article mis en favori) et `swapZoneReminder` (rappel Swap Zone). Ce sont **eux** qui coupent réellement les envois : avant chaque notification, le serveur vérifie le drapeau correspondant et supprime **à la fois** la notification dans l'app et la notification poussée (`functions/src/utils/notifications.ts`). Le champ `preferences.marketingConsent` est également mis à jour, mais il sert à afficher l'état de l'interrupteur — la coupure vient des trois drapeaux.

Le retrait est réversible à tout moment (réactivation par la même bascule).

---

### 17.4 Confidentialité par défaut (privacy by default)

Conformément à l'art. 9.1, les réglages de confidentialité **sensibles** sont désactivés par défaut (source de vérité unique `UserService.PRIVACY_DEFAULTS`). L'écran en compte **quatre**, dont un qui suit volontairement un modèle inverse :

| Réglage | Défaut | Effet |
|---|---|---|
| Afficher ma photo de profil | **OFF** (opt-in) | La photo n'est pas visible des autres tant qu'elle n'est pas activée |
| Recommandations personnalisées par IA | **OFF** (opt-in) | Pas de profilage IA tant que non activé |
| Communications marketing | **OFF** (opt-in) | Pas d'offres, baisses de prix ni nouveautés tant que non opt-in |
| **Données d'utilisation** (statistiques) | **ON** (opt-out) | Statistiques d'usage anonymisées activées par défaut ; désactivables à tout moment |

L'écran Confidentialité explique que le profilage IA s'appuie sur des outils Google (Gemini, Vertex AI) dont le traitement a lieu **aux États-Unis**, qu'il est désactivé par défaut, et qu'il peut être activé/désactivé à tout moment **sans incidence** sur le reste de l'application. La photo, le profilage IA et les statistiques d'usage s'écrivent en préférence client simple ; seul le marketing passe par le callable serveur.

Le même écran donne accès aux **droits** : Exporter mes données, Supprimer mon compte, Politique de confidentialité, Utilisateurs bloqués.

> **Deux réserves factuelles sur les statistiques d'usage.**
> 1. Le refus est appliqué **sur l'appareil** : il coupe l'outil de mesure côté application (PostHog) et est mémorisé localement. Les **événements émis par le serveur** (une vingtaine d'événements de commande, de paiement, de litige, et jusqu'à `account_deleted`) sont envoyés **sans consulter ce refus** (`functions/src/lib/analytics.ts`). Un utilisateur qui désactive le réglage continue donc d'alimenter les statistiques côté serveur.
> 2. L'outil de mesure envoie vers **PostHog Cloud (États-Unis)** par défaut, et **PostHog ne figure pas** dans la liste des destinataires hors Québec de la Politique de confidentialité (voir 17.10). C'est une omission de transparence à corriger.

---

### 17.5 Portabilité : export des données personnelles

**Réglages › Confidentialité › Exporter mes données** matérialise le droit à la portabilité (art. 27, présenté à l'écran comme « Loi 25 / LPRPDE (PIPEDA) »).

#### Parcours
1. L'écran présente l'encadré « Droit à la portabilité » et la liste des catégories annoncées (profil, articles, favoris, notifications, messages).
2. Au clic sur « Exporter mes données », l'application collecte l'ensemble des données de l'utilisateur, écrit un fichier **JSON** local (`seconde_data_{uid}_{horodatage}.json`) puis ouvre la **feuille de partage native** du téléphone (enregistrer, envoyer par courriel, AirDrop, etc.). Le fichier temporaire est supprimé une fois le partage effectué (le partage en a déjà fait une copie).
3. **Si le partage n'est pas disponible sur l'appareil**, aucun fichier n'est remis : l'utilisateur voit le message « Le partage de fichiers n'est pas disponible sur cet appareil. Réessayez depuis un appareil prenant en charge le partage. » (le fichier resterait dans le bac à sable de l'app, inaccessible — on ne montre donc pas de chemin inutilisable).

#### Contenu réel de l'export
L'export agrège **douze** catégories : profil utilisateur, articles publiés, favoris, notifications, conversations (avec **les messages envoyés par l'utilisateur**), avis rédigés, achats, ventes, brouillons d'annonces, recherches sauvegardées, historique de recherche, et l'**historique des consentements** (preuve Loi 25). Toutes les dates sont sérialisées en ISO-8601. Le format JSON est annoncé comme « lisible par la plupart des applications et services ».

#### Limites connues (factuelles)
- L'export est calculé **côté application** (`services/userService.ts`, `exportUserData`). Un commentaire de code signale un risque de dépassement de délai pour les très gros comptes (500+ articles) et prévoit une migration vers une Cloud Function.
- Deux catégories restent **absentes** du fichier, signalées en `TODO` dans le code : les **swaps** et le **porte-monnaie** (wallet). L'écran ne les annonce pas non plus, mais l'export n'est donc pas complet au sens de l'art. 27.
- L'export couvre les messages **envoyés** par l'utilisateur, pas l'intégralité des fils (les messages des autres participants ne sont pas exportés, ce qui est cohérent avec la portabilité des données « de la personne »).
- L'écran annonce cinq catégories alors que le fichier en contient douze : l'utilisateur reçoit **plus** que ce qui est promis, pas moins.

---

### 17.6 Suppression de compte : droit à l'effacement + garde-fous financiers

**Réglages › Confidentialité › Supprimer mon compte** (également accessible depuis le bas de l'écran Réglages) implémente le droit à l'effacement. Le nettoyage est effectué intégralement côté serveur par la fonction `deleteUserAccount` (`functions/src/callable/users.ts`).

#### Parcours utilisateur (écran à deux étapes)
1. **Étape information** : avertissement « action irréversible », liste de ce qui sera supprimé (profil, articles en vente, favoris et recherches sauvegardées, notifications, historique de swaps) et de ce qui sera **conservé sous forme anonymisée** (les conversations restent visibles pour l'autre participant). Rappel Loi 25 / LPRPDE.
2. **Étape confirmation** : **ré-authentification** selon le fournisseur, puis saisie obligatoire du mot « **SUPPRIMER** » (en toutes lettres) avant que le bouton ne s'active.

#### Ré-authentification par fournisseur (impact iOS / Android)
La sécurité de l'effacement exige une preuve d'identité récente, qui dépend du mode de connexion :

| Cas | Comportement |
|---|---|
| Compte **email + mot de passe** | Saisie du mot de passe actuel |
| Compte **Google** | Bouton « Se reconnecter avec Google » |
| Compte **Apple sur iOS** | Bouton « Se reconnecter avec Apple » |
| Compte **Apple sur Android** | **La ré-authentification Apple n'est pas disponible sur Android.** L'utilisateur doit utiliser un mot de passe : s'il en a déjà un, il vérifie via mot de passe ; sinon, il est invité à **« Ajouter un mot de passe »** d'abord |
| Fournisseur **indéterminé** | Suppression bloquée : l'utilisateur doit se déconnecter puis se reconnecter |

C'est une **différence produit iOS vs Android** réelle : un utilisateur « Sign in with Apple » sur Android ne peut pas supprimer son compte sans d'abord rattacher un mot de passe.

#### Garde-fous financiers (côté serveur, avant toute destruction)
Avant de toucher la moindre donnée, `deleteUserAccount` exécute des **vérifications bloquantes** (les garde-fous client étant contournables). La suppression est **refusée** (`failed-precondition`, message FR remonté tel quel à l'utilisateur) si :

- **Dette envers la plateforme** (`sellerDebt > 0`) : « Vous avez une dette de X $ envers la plateforme. Veuillez la régler… »
- **Porte-monnaie non vide** — solde disponible, solde en attente, ou **fonds retenus** (fonds livrés encore dans la fenêtre de réclamation de 7 jours) : l'utilisateur doit attendre la libération et retirer ses fonds.
- **Litige ouvert à exposition financière** (acheteur ou vendeur) : il gèle la transaction liée ; supprimer le compte orphelinerait le recours de l'autre partie. Bloque tout dossier ouvert dont le `type` n'est pas `meetup_no_show` — le **problème de transaction** signalé par l'acheteur après livraison (colis marqué livré mais jamais reçu, article non conforme ou endommagé) et le **retour non livré**, escaladé automatiquement après 21 jours sans scan de livraison. **Exception : un signalement d'absence de rencontre (`meetup_no_show`) ne bloque plus**, pas plus que la rencontre gelée qui l'accompagne. Une rencontre est un échange comptant — aucun argent n'a transité par la plateforme, il n'y a donc rien à protéger financièrement — alors qu'ouvrir un tel litige ne coûte qu'un clic : faire accepter une offre puis signaler une absence suffisait à geler indéfiniment le droit à l'effacement de sa cible, jusqu'à ce qu'un administrateur tranche. Le dossier n'est pas perdu pour autant : il est anonymisé lors du nettoyage (identité pseudonymisée, récit en texte libre effacé, squelette d'audit conservé).
- **Transaction active** : tout statut non terminal bloque la suppression. Les statuts **terminaux** sont au nombre de **quatre** : `completed`, `cancelled`, `refunded` et **`meetup_completed`**. Ce dernier est essentiel aujourd'hui : sans lui, toute personne ayant conclu une seule rencontre serait bloquée à vie (le parcours meetup ne va jamais plus loin que `meetup_completed`). **Une exception s'ajoute** : une rencontre gelée par un signalement d'absence — statut `disputed` **et** `deliveryType: 'meetup'` — est ignorée elle aussi. `reportMeetupNoShow` écrit le dossier de litige `meetup_no_show` et le gel de la transaction dans la **même** écriture atomique : excepter l'un sans excepter l'autre laisserait la suppression bloquée malgré tout.
- **Retrait bancaire en cours de traitement** : tant qu'un virement est parti mais non réglé (1 à 3 jours ouvrés), la suppression est refusée — si le virement échouait ensuite, il n'y aurait plus ni demande de retrait ni porte-monnaie pour re-créditer l'argent.
- **Échange (swap) non terminé, ou complément en argent payé mais non réglé** : la suppression détruit les swaps ; supprimer un swap en cours détruirait le chemin de remboursement du payeur et gèlerait définitivement les fonds du bénéficiaire.

Ces règles évitent qu'une suppression serve à échapper à une obligation financière ou prive l'autre partie de recours. Quatre des six garde-fous portent sur de l'argent : ils sont donc **sans effet pratique aujourd'hui**, les paiements étant désactivés. Ils redeviendront actifs à l'ouverture des paiements.

#### Ce qui est supprimé vs anonymisé
Une fois les garde-fous passés, le nettoyage distingue **suppression dure** et **anonymisation** (pour préserver l'intégrité des échanges des autres utilisateurs) :

- **Supprimé** : fiche utilisateur et ses sous-collections (recherches sauvegardées, historique de recherche, **et l'historique des consentements**), favoris, notifications, swaps, articles du Swap Zone (avec décrément des compteurs de la zone), porte-monnaie + son grand-livre, demandes de retrait, brouillons, entrées du `search_index`, fichiers Storage (avatars, dossier personnel, photos d'articles). Les vecteurs de recherche (`embeddings`) des articles sont désactivés. La **réservation du @pseudo** (`usernames/{pseudo}`) est libérée si elle pointe bien sur cet utilisateur. Le compteur « likes » des vendeurs que l'utilisateur suivait est décrémenté — pour les seuls vendeurs encore existants, et un échec de ce décrément purement cosmétique ne bloque plus l'effacement : un vendeur suivi ayant lui-même supprimé son compte faisait auparavant échouer toute la suppression de son abonné (droit à l'effacement bloqué par l'action d'un tiers).
- **Anonymisé (conservé)** : les **articles** deviennent inactifs, non vendus, et leur vendeur est remplacé par « Utilisateur supprimé » ; les **conversations et messages** voient le nom/photo de l'utilisateur remplacés par « Utilisateur supprimé » (l'autre participant garde son fil), et les **offres encore vivantes** de la personne (`pending` et les trois contre-offres) sont éteintes — `offer.status: 'expired'`, motif `sender_account_deleted` — pour qu'un vendeur ne puisse plus accepter le lendemain l'offre d'un acheteur qui n'existe plus et verrouiller son article 48 h ; les **avis** écrits ou reçus sont anonymisés ; les **dossiers de litige** sont pseudonymisés — partout où l'uid de la personne apparaît (`buyerId`, `sellerId`, `reportedBy`, `reportedAgainst`), il devient `deleted_xxxxxxxx`, et le récit libre `details` est **supprimé** — en conservant le squelette d'audit : type, statut, résolution, horodatages, `transactionId` (à assumer : le récit d'une contre-déclaration, `counterDetails` et `counterReportedBy`, n'est pas encore couvert par ce nettoyage). Les **transactions**, elles, ne sont **pas** pseudonymisées : `buyerId` et `sellerId` sont **conservés** (pièce comptable soumise à sept ans de rétention — `retentionPurge` ne touche jamais cette collection — et la partie survivante doit continuer de voir sa commande dans « Mes achats » / « Mes ventes », écrans dont la lecture s'appuie sur ces deux champs) ; seul le texte libre `noShowReport.details` y est effacé. L'ancienne étape écrivait `buyerName`, `buyerEmail` et `sellerName` — trois champs que rien d'autre n'écrit ni ne lit sur une transaction, donc **créés** par l'opération : elle n'anonymisait rien. Les transactions ne sont **jamais supprimées** car soumises à une rétention comptable/fiscale (voir 17.8).

> Point à assumer : l'historique des consentements est **détruit** avec le compte. C'est cohérent avec le droit à l'effacement, mais cela signifie qu'après suppression la plateforme ne peut plus prouver que la personne avait consenti.

#### Suppression du compte de paiement (Stripe Connect Custom)
Comme Second exploite des comptes **Stripe Connect Custom** en marque blanche (la plateforme contrôle le compte), la suppression de l'utilisateur entraîne la **suppression du compte connecté Stripe**. Cette opération est en « meilleur effort » : si elle échoue, elle **ne bloque pas** le reste de la suppression, mais un **incident de confidentialité** de gravité « high » (type `deletion_failed`) est automatiquement enregistré, afin que le compte Stripe orphelin soit réconcilié manuellement (reddition de comptes Loi 25).

#### Étape finale
Un événement statistique `account_deleted` est émis, puis le compte **Firebase Auth** est supprimé en dernier (en meilleur effort : un échec ne fait pas échouer le nettoyage déjà réalisé). Côté application, l'utilisateur est **déconnecté complètement** (une simple remise à zéro des états ne suffirait pas — une session fantôme ressusciterait le compte au démarrage suivant) et redirigé vers l'accueil.

---

### 17.7 Décisions automatisées : transparence & contestation (art. 12.1)

La place de marché prévoit **trois décisions sans intervention humaine** ; la Loi 25 (art. 12.1) impose d'en **informer** la personne, de lui rendre **compréhensibles les critères**, et de lui permettre de demander une **révision humaine**.

| Type de décision | Quand elle se produit | Active aujourd'hui ? |
|---|---|---|
| `transaction_expired` — annulation automatique de la commande | Rencontre non confirmée par le vendeur sous **48 h** (`meetup_pending`), ou rencontre confirmée jamais finalisée sous **7 jours** (`meetup_confirmed`). Aucun argent ne bouge. | **Oui** — c'est la seule décision automatisée qui se déclenche réellement |
| `funds_released` — libération automatique des fonds | À l'expiration de la **fenêtre de réclamation de 7 jours** après livraison confirmée (fonds retenus → solde disponible) | Non — dépend des paiements/livraison, désactivés |
| `label_refund` — remboursement automatique | Une commande payée dont l'étiquette d'expédition n'a jamais pu être créée est remboursée | Non — dépend de la livraison, désactivée |

#### Journalisation transparente
Chaque tâche planifiée journalise la décision **après** que l'effet s'est produit (le journal est purement additif : un incident de journalisation ne doit jamais annuler ou bloquer une annulation, libération ou remboursement réussi). Le journal `automatic_decisions_log` consigne : la transaction, l'utilisateur concerné, le type de décision, les **critères lisibles** (statut, délai appliqué — 48 h ou 7 jours —, motif d'annulation, date de libération prévue, etc.) et un résumé de résultat. Les identifiants acheteur/vendeur sont recopiés sur l'entrée pour que la lecture par les parties reste peu coûteuse.

#### Côté utilisateur
Le bloc de transparence est affiché **dans la conversation liée à la commande** (`app/chat/[id].tsx`, composant `ShipmentTracking`) — y compris pour les commandes en **rencontre (meetup)**, qui n'ont pas de suivi de transporteur mais peuvent subir une annulation automatique. Pour une rencontre, **seul** ce bloc s'affiche (pas de chronologie d'expédition ni d'étiquette, qui n'auraient pas de sens) ; s'il n'y a aucune décision automatisée, rien ne s'affiche.

Il comporte :

1. Un **titre** clair (« Annulation automatique de la commande », « Libération automatique des fonds », « Remboursement automatique »).
2. Un **texte explicatif** daté.
3. Un dépliant **« Pourquoi cette décision ? »** qui expose les critères en français lisible.
4. Un bouton **« Contester cette décision »**.

Le journal n'est interrogé que lorsqu'une décision automatisée est plausible pour la transaction (fonds déjà libérés, ou statut `completed` / `cancelled` / `refunded` / `refund_in_progress`), pour éviter un appel serveur à chaque ouverture de conversation. Une rencontre expirée passe en `cancelled` : elle est donc bien couverte.

L'utilisateur reçoit par ailleurs une **notification** au moment de la décision, dont le texte dit explicitement qu'elle est automatique et qu'elle peut être signalée.

#### Contestation = révision humaine, sans rien renverser
La contestation ouvre une **demande de révision humaine** : l'utilisateur choisit un motif prédéfini et peut ajouter un texte libre. La fonction crée une demande (`automated_decision_contestations`, statut `open`) et alerte l'équipe support (via une entrée de registre de gravité « low »). **Aucun mouvement d'argent n'est inversé automatiquement** : un agent humain tranche hors bande. L'utilisateur reçoit le message « Votre contestation a été transmise. Notre équipe procédera à une révision humaine… ». Seules les parties (acheteur/vendeur) de la transaction peuvent consulter le journal ou contester ; les règles Firestore le vérifient.

> **Trou opérationnel** : la contestation n'a **pas d'écran de traitement**. Elle se matérialise par une entrée dans le registre des incidents et un journal serveur ; il n'existe aucune interface pour lister les contestations ouvertes, y répondre, ou les clore. Le suivi est donc manuel et dépend de la surveillance des journaux.

---

### 17.8 Rétention et destruction des données (art. 23)

La tâche planifiée `retentionPurge` (`functions/src/scheduled/retentionPurge.ts`) s'exécute **toutes les 24 heures** (fuseau America/Toronto) et supprime définitivement les données personnelles devenues inutiles. Elle traite chaque cible indépendamment (un échec sur l'une n'arrête pas les autres) et applique un **plafond par exécution** (2000 documents par cible) pour drainer un arriéré sur plusieurs jours sans dépasser le délai d'exécution.

| Donnée purgée | Seuil de conservation |
|---|---|
| Articles inactifs | > **3 ans** depuis la dernière modification |
| Préférences de visiteurs non inscrits (`guest_preferences`) | > **90 jours** depuis la **création** de l'enregistrement |
| Notifications | > **180 jours** (6 mois) |
| Historique de recherche | > **12 mois** |
| Brouillons d'annonces abandonnés | > **90 jours** sans modification |

**Exclusion explicite** : la collection `transactions` n'est **jamais** purgée — rétention légale de **7 ans** (obligations comptables et fiscales). C'est cohérent avec l'anonymisation (plutôt que suppression) des transactions lors de la fermeture de compte (17.6).

Ces durées sont reflétées dans la Politique de confidentialité affichée à l'utilisateur (transactions jusqu'à 7 ans ; navigation/préférences ≤ 12 mois ; notifications ≤ 6 mois ; visiteurs non inscrits supprimés après 90 jours). Le délai de réponse aux demandes d'accès/rectification/suppression est annoncé à **30 jours maximum**.

> **Deux écarts à connaître.**
> 1. La Politique dit « après 90 jours **d'inactivité** » pour les visiteurs non inscrits ; le code purge en réalité **90 jours après la création** de l'enregistrement, quelle que soit l'activité. La formulation de la Politique est donc plus généreuse que la règle appliquée.
> 2. Aucune tâche ne purge les **comptes créés mais jamais consentis** (voir 17.2), ni les conversations, messages, avis ou porte-monnaie d'un compte inactif. Seule la suppression volontaire du compte les traite.

---

### 17.9 Registre des incidents de confidentialité (art. 3.5–3.8)

Second tient un **registre des incidents** (`privacy_incidents`), écrit exclusivement côté serveur et lisible par les **administrateurs** uniquement (vérifié à la fois par les règles Firestore et par un garde admin dans le code). Quatre fonctions admin l'animent (`functions/src/callable/privacyIncidents.ts`) :

- **`reportPrivacyIncident`** — créer un incident (type, gravité, description, utilisateurs touchés, champs concernés, mesures, statut). Horodatage serveur `detectedAt`.
- **`getPrivacyIncidentsLog`** — lire le registre, trié du plus récent au plus ancien (par défaut 200 entrées, plafond 500).
- **`escalatePrivacyIncidentToCAI`** — consigner la notification de la **Commission d'accès à l'information (CAI)** : pose `notifiedCAI = true`, `notifiedCAIAt`, une référence CAI, et fait avancer un incident `open` vers `investigating` (sans jamais régresser un statut plus avancé).
- **`notifyAffectedUsers`** — envoyer un avis **dans l'application** à chaque utilisateur listé dans l'incident (notification de type `privacy_incident`, jamais supprimable par une préférence utilisateur), en meilleur effort par utilisateur, puis horodater `notifiedUsersAt`.

#### Seuils d'escalade (ancrage de l'obligation légale)
La CAI **et** les personnes concernées doivent être avisées en cas d'**incident présentant un risque de préjudice sérieux**. Le code ancre ce devoir :

| Gravité | Notification CAI |
|---|---|
| `critical` | **Obligatoire** |
| `high` | **Obligatoire** |
| `medium` | À la discrétion du responsable (évaluation cas par cas) |
| `low` | Registre seulement, pas de notification externe |

**Délai cible** : notification CAI + personnes concernées « sans délai indu », avec un objectif de **72 heures** depuis la détection. Les horodatages (`detectedAt` → `notifiedCAIAt` / `notifiedUsersAt`) rendent ce délai **auditable** a posteriori.

#### Alimentation automatique du registre
Une fonction interne réutilisable côté serveur (qui ne lève jamais d'erreur, pour ne jamais bloquer le flux appelant) alimente automatiquement le registre dans deux cas déjà en place : l'échec de suppression d'un compte Stripe lors d'une fermeture de compte (`deletion_failed`, gravité « high », voir 17.6) et l'ouverture d'une contestation de décision automatisée (gravité « low », voir 17.7).

> **Trois limites factuelles.**
> 1. **Aucun écran d'administration** n'existe pour consulter, escalader ou clore un incident : les quatre fonctions sont prêtes mais ne sont pilotables que depuis un outil interne ou un appel direct. Aucun écran de l'application ne les appelle.
> 2. **Le cycle de vie annoncé n'est pas complètement outillé.** Les statuts prévus sont `open` → `investigating` → `contained` → `resolved`, mais seule l'escalade CAI fait avancer `open` → `investigating`. **Aucune fonction ne permet de passer un incident à `contained` ou `resolved`** (autrement qu'en le créant directement dans cet état).
> 3. **L'avis aux personnes touchées est un message dans l'application uniquement** — pas de courriel, pas de notification poussée. Une personne qui n'ouvre plus l'app ne verra jamais l'avis, et cet avis est lui-même purgé au bout de 180 jours (17.8). Insuffisant si un incident sérieux survenait : prévoir un canal courriel.

---

### 17.10 Pages légales

**Trois** pages légales existent, rédigées en français, toutes datées ou cohérentes avec la version de politique `2026-05-31` :

- **Politique de confidentialité** (`features/legal/components/PrivacyPolicyContent.tsx`) — datée « 31 mai 2026 », structurée en 10 sections : responsable de la protection des renseignements personnels, renseignements recueillis, finalités, **destinataires et communications hors Québec** (Stripe, ShipEngine/Auctane, Google Vertex AI/Gemini, Firebase — tous principalement aux États-Unis, avec le rappel que les Cloud Functions sont hébergées dans la **région de Montréal**), profilage et technologies, durée de conservation, droits de la personne (accès, rectification, portabilité, suppression, retrait du consentement), consentement et retrait, **incidents de confidentialité**, et coordonnées pour plainte (y compris l'adresse de la CAI, 525 boul. René-Lévesque Est, Québec). Mention répétée : « Nous ne vendons jamais vos données personnelles à des tiers. »
- **Conditions d'utilisation** (`features/legal/components/TermsContent.tsx`) — également datées du 31 mai 2026.
- **Mentions légales** (`app/settings/legal-notice.tsx`) — éditeur (Seconde Inc., société par actions constituée au Québec), siège social à Montréal, directeur de la publication, hébergement, propriété intellectuelle, droit applicable (tribunaux du district judiciaire de Montréal).

**Adresse de contact unique** : `contact@seconde.ca` (et non une boîte dédiée « privacy@ »). C'est cette adresse qui figure partout : responsable de la protection des renseignements personnels, exercice des droits, plainte, support, mentions légales.

#### Accessibilité au moment du consentement (art. 12)
Point de conformité important : la Politique et les CGU existent en **version publique** sous `app/legal/*`, accessibles **sans être connecté**. C'est délibéré — la Loi 25 (art. 12) exige que la politique soit lisible **au moment du consentement**, avant que l'utilisateur ne coche les cases. Les liens des cases de l'écran de consentement pointent donc vers ces routes publiques, et le garde de consentement laisse explicitement passer la navigation vers `legal`. Le **même corps de texte** est réutilisé par la route authentifiée (Réglages › À propos › Politique de confidentialité, et Réglages › Confidentialité) et par la route publique, sans duplication, pour éviter toute divergence.

> **À corriger avant toute diffusion externe** : les Mentions légales contiennent un **NEQ fictif (`1234567890`)** et une adresse de siège social qui reste à confirmer. Publier une mention légale avec un numéro d'entreprise inventé est un risque juridique direct.

---

### 17.11 Spécificités Canada & points produit à retenir

- **Marché et localisation** : entreprise présentée comme québécoise (Montréal), copie 100 % FR, calcul d'âge serveur en fuseau **America/Toronto**, devise CAD, hébergement des Cloud Functions en **région de Montréal** (`northamerica-northeast1`). La CAI (et non un régulateur étranger) est l'autorité de référence.
- **Transferts hors Québec** : la Politique liste les sous-traitants états-uniens (Stripe pour le paiement/KYC, ShipEngine pour l'expédition, Google pour l'IA et l'infrastructure). **PostHog (statistiques d'usage, hébergement États-Unis) manque à cette liste.**
- **Double référence légale** : l'application cite systématiquement la **Loi 25** (Québec) **et** la **LPRPDE/PIPEDA** (fédéral), plus la **LCAP** pour le marketing.
- **Différence iOS / Android la plus impactante** : la suppression de compte d'un utilisateur **« Sign in with Apple » sur Android** nécessite d'abord d'ajouter un mot de passe (la ré-auth Apple n'existe pas sur Android). Aucune autre divergence de conformité notable entre les deux plateformes.
- **Principe de conception transversal** : tous les traitements sensibles (consentement, retrait marketing, incidents, suppression, journal des décisions automatisées) sont **autorité serveur**, avec des règles Firestore qui interdisent l'écriture client sur les collections de preuve (`consents`, `privacy_incidents`, `automatic_decisions_log`, `automated_decision_contestations`). Les preuves de consentement sont **append-only** et infalsifiables.

---

### 17.12 Écarts connus — à traiter

Récapitulatif des points où le code ne fait pas (encore) ce que la conformité voudrait. Aucun n'est bloquant pour la bêta meetup ; tous doivent être traités avant l'ouverture des paiements ou avant un audit externe.

| # | Écart | Conséquence | Priorité |
|---|---|---|---|
| 1 | NEQ fictif (`1234567890`) dans les Mentions légales | Mention légale fausse publiée | **Haute** |
| 2 | PostHog absent de la liste des destinataires hors Québec | Manquement de transparence (art. 8/17) | **Haute** |
| 3 | Le refus des statistiques d'usage n'est pas appliqué aux événements émis par le serveur | Le refus utilisateur est partiellement inopérant | **Haute** |
| 4 | Barrière 18 ans pour vendre : appliquée à l'écran seulement (la publication d'article ne vérifie pas l'âge côté serveur) | Contournable ; à corriger avant d'ouvrir les paiements | **Haute** |
| 5 | Export incomplet : swaps et porte-monnaie absents | Portabilité partielle (art. 27) | Moyenne |
| 6 | Avis d'incident aux personnes touchées : dans l'app uniquement, purgé à 180 jours | Obligation d'aviser mal servie en cas d'incident réel | Moyenne |
| 7 | Aucun écran d'administration pour le registre d'incidents ni pour les contestations ; pas de fonction pour clore un incident (`contained` / `resolved`) | Traitement manuel, traçabilité incomplète | Moyenne |
| 8 | Comptes créés mais jamais consentis : conservés indéfiniment, jamais purgés | Données conservées sans finalité ni consentement (art. 23) | Moyenne |
| 9 | Purge des visiteurs non inscrits : 90 jours après **création**, alors que la Politique annonce 90 jours d'**inactivité** | Écart entre le texte publié et la règle appliquée | Basse |
| 10 | L'export est calculé côté application (risque de dépassement de délai sur les gros comptes) | Export susceptible d'échouer pour un vendeur très actif | Basse |

---

#### Décision en attente — pseudonymiser ou non les transactions à la fermeture d'un compte

**Ce qui se fait aujourd'hui** (choix par défaut, retenu le 2026-09-06) : `buyerId` et `sellerId`
sont **conservés** sur les transactions d'un compte supprimé. Seul le texte libre d'un signalement
d'absence (`noShowReport.details`) est effacé. Les dossiers de litige, eux, sont bien pseudonymisés
et leur récit supprimé (§17.6).

**Pourquoi ce choix par défaut.** Une transaction est une **pièce comptable** : la Politique annonce
sept ans de rétention et le balayage de purge exclut explicitement cette collection. Par ailleurs la
**partie survivante** — celle qui n'a pas supprimé son compte — doit continuer de voir sa commande
dans « Mes achats » / « Mes ventes », deux écrans dont les règles de lecture s'appuient précisément
sur `buyerId` et `sellerId`.

**L'autre option.** Remplacer les deux identifiants par un pseudonyme stable (`deleted_xxxxxxxx`),
comme c'est déjà fait pour le vendeur d'un article et pour la cible d'un avis. C'est plus proche de
l'esprit de l'art. 23, mais cela impose de :
1. revoir les règles de lecture des transactions, qui n'autoriseraient plus la partie survivante ;
2. revoir « Mes achats » et « Mes ventes », qui perdraient la commande concernée ;
3. décider si la traçabilité comptable est préservée autrement (registre séparé, ou conservation du
   seul identifiant de transaction).

**Ce qu'il faut trancher** : la rétention comptable prime-t-elle sur la pseudonymisation, ou
faut-il pseudonymiser en acceptant de perdre l'affichage côté partie survivante ? Tant que ce n'est
pas tranché, le comportement décrit en §17.6 est celui qui s'applique.
