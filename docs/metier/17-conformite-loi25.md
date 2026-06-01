## 17. Conformité & légal (Loi 25 / Canada)

> Cette section décrit ce que l'application Second fait concrètement en matière de protection des renseignements personnels, conformément à la **Loi 25 du Québec** (loi modernisant le régime québécois de protection des renseignements personnels) et à la **LPRPDE (PIPEDA)** fédérale. Toutes les fonctionnalités décrites existent dans le code et sont, sauf mention contraire, opérationnelles.

Second se positionne comme une entreprise québécoise (« Seconde Inc. », Montréal, Québec) qui traite des renseignements personnels de Canadiens. La conformité Loi 25 n'est pas un module isolé : elle est tissée dans le parcours d'inscription, les réglages de confidentialité, la gestion des décisions automatisées de la place de marché, et l'outillage d'administration. Les traitements sensibles (consentements, incidents, suppression de compte) sont exécutés **côté serveur** (Cloud Functions, région de Montréal `northamerica-northeast1`), jamais laissés au client, car les garde-fous côté application sont contournables.

---

### 17.1 Vue d'ensemble des droits couverts

| Droit / obligation (Loi 25) | Implémentation Second | Où, pour l'utilisateur |
|---|---|---|
| Consentement éclairé à l'inscription (art. 12) | Cases à cocher CGU + Politique de confidentialité obligatoires, opt-in marketing facultatif, journalisés serveur | Écran d'inscription (email et connexion sociale) |
| Barrière d'âge (mineurs) | Date de naissance exigée, âge ≥ 16 ans pour s'inscrire/acheter, ≥ 18 ans pour vendre | Inscription |
| Retrait du consentement marketing (art. 14 / LCAP) | Interrupteur « Communications marketing », retrait journalisé en mode append-only + coupure serveur des envois | Réglages › Confidentialité |
| Confidentialité par défaut (art. 9.1) | Photo de profil, profilage IA et marketing tous **désactivés par défaut** | Réglages › Confidentialité |
| Droit à la portabilité (art. 27) | Export de toutes les données personnelles en fichier JSON | Réglages › Confidentialité › Exporter mes données |
| Droit à l'effacement | Suppression de compte avec nettoyage exhaustif + garde-fous financiers serveur | Réglages › Confidentialité › Supprimer mon compte |
| Décisions automatisées (art. 12.1) | Information, explication des critères, et droit de contester (révision humaine) | Suivi de commande / fiche transaction |
| Registre des incidents (art. 3.5–3.8) | Collection serveur d'incidents, escalade vers la CAI, notification des personnes touchées | Outillage admin (callables) |
| Rétention/destruction (art. 23) | Tâche planifiée quotidienne de purge des données périmées | Automatique (serveur) |
| Pages légales accessibles | CGU + Politique de confidentialité, lisibles **avant** consentement (sans être connecté) | Liens d'inscription + Réglages |

---

### 17.2 Consentement à l'inscription

#### Parcours
À l'inscription, qu'elle se fasse par **email** (formulaire `SignUpForm`) ou par **connexion sociale** Google/Apple (formulaire `SocialConsentForm`), l'utilisateur voit un bloc de consentement partagé (`ConsentFields`) comprenant :

1. **Date de naissance** (trois champs JJ / MM / AAAA).
2. Case **« J'ai lu et j'accepte les Conditions d'utilisation »** — obligatoire.
3. Case **« J'ai lu et j'accepte la Politique de confidentialité »** — obligatoire.
4. Case **« J'accepte de recevoir des offres, baisses de prix et nouveautés »** — facultative (opt-in marketing).

Les libellés des CGU et de la Politique sont des **liens cliquables** vers les pages légales publiques. Le bouton de validation reste **désactivé** tant que la date de naissance ne donne pas un âge ≥ 16 ans **et** que les deux cases obligatoires ne sont pas cochées.

Spécificité **connexion sociale** : une connexion Google/Apple ne contourne **jamais** la barrière d'âge ni le consentement. Un nouveau compte social qui n'a pas encore consenti n'a aucune preuve de consentement ; si l'utilisateur abandonne l'étape de consentement, le compte fraîchement créé est annulé (rollback). Le consentement social est donc une étape obligatoire post-connexion.

#### Règle d'âge (calcul côté serveur)
La date de naissance n'est pas seulement validée côté écran : la fonction serveur `recordSignupConsent` la revalide.

- Format attendu : ISO `AAAA-MM-JJ` ; les dates impossibles (ex. 30 février) sont rejetées.
- L'âge est calculé en tenant compte du **fuseau America/Toronto** (marché cible), pour aligner le calcul serveur sur l'heure locale canadienne.
- **Minimum 16 ans pour s'inscrire et acheter** (`MIN_AGE_REGISTER`). En dessous : refus avec le message « Vous devez avoir au moins 16 ans pour utiliser Second ».
- **Minimum 18 ans pour vendre** (`MIN_AGE_SELL`) : un 16-17 ans peut acheter et naviguer, mais la vente est bloquée car le partenaire de paiement Stripe exige 18 ans pour ouvrir un compte de versement (la barrière de vente est rappelée par la copie `COPY_SELL_GATE` lors de l'onboarding Stripe).

#### Ce qui est enregistré (preuve de consentement)
`recordSignupConsent` écrit, en une seule opération atomique (batch) :

- Sur la fiche utilisateur (`users/{uid}`) : la **date de naissance** (chaîne ISO).
- Dans la sous-collection `users/{uid}/consents`, un document par consentement accordé :
  - `terms` (CGU) — toujours,
  - `privacy_policy` (Politique) — toujours,
  - `marketing` — uniquement si l'opt-in a été coché.
  
  Chaque document porte : `type`, `version` (la **version de politique** `POLICY_VERSION = '2026-05-31'`), `acceptedAt` (horodatage serveur), et `channel: 'app'`.

**Règle de gestion clé — preuve immuable** : les documents de consentement sont écrits **exclusivement côté serveur** (Admin SDK). Les règles Firestore interdisent toute écriture, mise à jour ou suppression côté client (`allow create, update, delete: if false`). Le propriétaire peut seulement **lire** son propre historique. L'horodatage et la version restent donc faisant foi et infalsifiables.

---

### 17.3 Consentement marketing : retrait append-only + coupure serveur

Le marketing repose sur un **double mécanisme** exigé par la Loi 25 (art. 14) et la Loi canadienne anti-pourriel (LCAP).

Dans **Réglages › Confidentialité**, un interrupteur « Communications marketing » permet d'accorder ou de retirer le consentement à tout moment. La bascule n'écrit **pas** directement la préférence côté client : elle appelle la fonction serveur `setMarketingConsent`, qui réalise deux actions :

1. **Journalisation append-only (preuve)** : un **nouveau** document est ajouté dans `users/{uid}/consents` (`type: 'marketing'`, `granted: true|false`, `version`, `acceptedAt`, `channel`). Les documents existants ne sont **jamais** modifiés — chaque octroi et chaque retrait laisse une trace datée distincte.
2. **Application serveur (effet)** : les préférences relues par les déclencheurs d'envoi (`preferences.marketingConsent`, et les drapeaux de notifications `priceDrops`, `articleFavorited`, `swapZoneReminder`) sont mises à `true`/`false`. Couper ces drapeaux garantit qu'**aucune** notification marketing ne part après un retrait — la coupure est effective côté serveur, pas seulement masquée à l'écran.

Le retrait est réversible à tout moment (réactivation par la même bascule).

---

### 17.4 Confidentialité par défaut (privacy by default)

Conformément à l'art. 9.1, **tous les réglages de confidentialité sensibles sont désactivés par défaut** (source de vérité unique `PRIVACY_DEFAULTS`) :

| Réglage | Défaut | Effet |
|---|---|---|
| `showProfilePhoto` | OFF | La photo de profil n'est pas visible des autres tant qu'elle n'est pas activée |
| `aiProfilingConsent` | OFF | Pas de recommandations personnalisées par IA tant que non activé |
| `marketingConsent` | OFF | Pas de communications marketing tant que non opt-in |

L'écran Confidentialité explique notamment que le profilage IA s'appuie sur des outils Google (Gemini, Vertex AI) dont le traitement a lieu **aux États-Unis**, qu'il est désactivé par défaut, et qu'il peut être activé/désactivé à tout moment **sans incidence** sur le reste de l'application. La photo et le profilage IA s'écrivent en préférence client simple ; seul le marketing passe par le callable serveur.

---

### 17.5 Portabilité : export des données personnelles

**Réglages › Confidentialité › Exporter mes données** matérialise le droit à la portabilité (art. 27, présenté comme « Loi 25 / LPRPDE (PIPEDA) »).

#### Parcours
1. L'écran présente l'encadré « Droit à la portabilité » et la liste des catégories incluses (profil, articles, favoris, notifications, messages…).
2. Au clic sur « Exporter mes données », l'application collecte l'ensemble des données de l'utilisateur, écrit un fichier **JSON** local (`seconde_data_{uid}_{timestamp}.json`) puis ouvre la **feuille de partage native** du téléphone (enregistrer, envoyer par courriel, AirDrop, etc.).
3. Si le partage n'est pas disponible, l'utilisateur reçoit le chemin local du fichier.

#### Contenu de l'export
L'export agrège : profil utilisateur, articles publiés, favoris, notifications, conversations (avec **les messages envoyés par l'utilisateur**), avis rédigés, achats, ventes, brouillons d'annonces, recherches sauvegardées, historique de recherche, et l'**historique des consentements** (preuve Loi 25). Toutes les dates sont sérialisées en ISO-8601. Le format JSON est annoncé comme « lisible par la plupart des applications et services ».

#### Limites connues (factuelles)
- L'export est aujourd'hui calculé **côté client** (`UserService.exportUserData`). Un commentaire de code signale un risque de timeout pour les très gros comptes (500+ articles) et prévoit une migration future vers une Cloud Function.
- Deux catégories restent annoncées comme à ajouter (commentaires `TODO`) : les **swaps** et le **porte-monnaie** (wallet). Elles ne figurent donc pas encore dans le fichier exporté.
- L'export couvre les messages **envoyés** par l'utilisateur, pas l'intégralité des fils (les messages des autres participants ne sont pas exportés, ce qui est cohérent avec la portabilité des données « de la personne »).

---

### 17.6 Suppression de compte : droit à l'effacement + garde-fous financiers

**Réglages › Confidentialité › Supprimer mon compte** implémente le droit à l'effacement. Le nettoyage est effectué intégralement côté serveur par la fonction `deleteUserAccount`.

#### Parcours utilisateur (écran à deux étapes)
1. **Étape information** : avertissement « action irréversible », liste de ce qui sera supprimé (profil, articles en vente, favoris, recherches sauvegardées, notifications, historique de swaps) et de ce qui sera **conservé sous forme anonymisée** (les conversations restent visibles pour l'autre participant). Rappel Loi 25 / LPRPDE.
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
- **Porte-monnaie non vide** — solde disponible, solde en attente, ou **fonds retenus** (`heldBalance`, fonds livrés encore dans la fenêtre de réclamation de 7 jours) : l'utilisateur doit attendre la libération et retirer ses fonds.
- **Litige ouvert** (acheteur ou vendeur) : un litige gèle la transaction liée ; supprimer le compte orphelinerait le recours de l'autre partie.
- **Transaction active** : tout statut non terminal (les statuts terminaux étant `completed`, `cancelled`, `refunded`) bloque la suppression (en transit, en attente de rencontre, en fenêtre de litige, remboursement en cours, retour demandé…).

Ces règles évitent qu'une suppression serve à échapper à une obligation financière ou prive l'autre partie de recours.

#### Ce qui est supprimé vs anonymisé
Une fois les garde-fous passés, le nettoyage distingue **suppression dure** et **anonymisation** (pour préserver l'intégrité des échanges des autres utilisateurs) :

- **Supprimé** : fiche utilisateur et sous-collections (recherches sauvegardées, historique de recherche, consentements), favoris, notifications, swaps, articles du Swap Zone (avec décrément des compteurs), porte-monnaie + son grand-livre, demandes de retrait, brouillons, entrées du `search_index`, fichiers Storage (avatars, photos d'articles). La **réservation du @pseudo** (`usernames/{username}`) est libérée si elle pointe bien sur cet utilisateur.
- **Anonymisé (conservé)** : les **articles** deviennent inactifs et leur vendeur est remplacé par « Utilisateur supprimé » ; les **conversations et messages** voient le nom/photo de l'utilisateur remplacés par « Utilisateur supprimé » (l'autre participant garde son fil) ; les **avis** écrits ou reçus sont anonymisés ; les **transactions** sont anonymisées (nom remplacé, courriel acheteur vidé) — elles ne sont **jamais supprimées** car soumises à une rétention comptable/fiscale (voir 17.8).

#### Suppression du compte de paiement (Stripe Connect Custom)
Comme Second exploite des comptes **Stripe Connect Custom** en marque blanche (la plateforme contrôle le compte), la suppression de l'utilisateur entraîne la **suppression du compte connecté Stripe** (`accounts.del`). Cette opération est en « meilleur effort » : si elle échoue, elle **ne bloque pas** le reste de la suppression, mais un **incident de confidentialité** de gravité « high » (type `deletion_failed`) est automatiquement enregistré, afin que le compte Stripe orphelin soit réconcilié manuellement (reddition de comptes Loi 25 / RGPD).

#### Étape finale
Le compte **Firebase Auth** est supprimé en dernier (en meilleur effort : un échec ne fait pas échouer le nettoyage déjà réalisé). Côté application, les stores sont réinitialisés et l'utilisateur est redirigé immédiatement vers l'accueil.

---

### 17.7 Décisions automatisées : transparence & contestation (art. 12.1)

La place de marché prend **trois décisions sans intervention humaine** ; la Loi 25 (art. 12.1) impose d'en **informer** la personne, de lui rendre **compréhensibles les critères**, et de lui permettre de demander une **révision humaine**.

| Type de décision | Quand elle se produit | Tâche planifiée à l'origine |
|---|---|---|
| `funds_released` — libération automatique des fonds | À l'expiration de la **fenêtre de réclamation de 7 jours** après livraison confirmée (heldBalance → balance) | `releaseHeldFunds` |
| `transaction_expired` — annulation automatique de la commande | Une commande orpheline / non honorée dans le délai imparti est annulée | `transactionExpiration` |
| `label_refund` — remboursement automatique | Une commande payée dont l'étiquette d'expédition n'a jamais pu être créée est remboursée | `sweepPendingLabels` |

#### Journalisation transparente
Chaque tâche planifiée appelle `logAutomatedDecision` **après** que l'argent a bougé (le journal est purement additif : un incident de journalisation ne doit jamais annuler ou bloquer une libération/remboursement réussi). Le journal `automatic_decisions_log` consigne : la transaction, l'utilisateur concerné, le type de décision, les **critères lisibles** (statut, date de libération prévue, délai de réclamation, motif d'annulation, tentatives d'étiquette, etc.) et un résumé de résultat.

#### Côté utilisateur
Dans le **suivi de commande** (composant `ShipmentTracking`, visible dans la conversation de la transaction), dès qu'une décision automatisée existe pour la transaction, un bloc dédié s'affiche — y compris pour les commandes en **rencontre (meetup)**, qui n'ont pas de suivi de transporteur mais peuvent subir une annulation/libération automatique :

1. Un **titre** clair (ex. « Libération automatique des fonds »).
2. Un **texte explicatif** daté (ex. fonds libérés le … car l'échange est confirmé et le délai de 7 jours est écoulé).
3. Un dépliant **« Pourquoi cette décision ? »** qui expose les critères en français lisible.
4. Un bouton **« Contester cette décision »**.

#### Contestation = révision humaine, sans rien renverser
La contestation (`contestAutomatedDecision`) ouvre une **demande de révision humaine** : l'utilisateur choisit un motif prédéfini (ex. « Je ne suis pas d'accord avec cette décision ») et peut ajouter un texte libre. La fonction crée un document `automated_decision_contestations` (statut `open`) et alerte l'équipe support (via une entrée de registre de gravité « low »). **Aucun mouvement d'argent n'est inversé automatiquement** : un agent humain tranche hors bande. L'utilisateur reçoit le message « Votre contestation a été transmise. Notre équipe procédera à une révision humaine… ». Seules les parties (acheteur/vendeur) de la transaction peuvent consulter le journal ou contester ; les règles Firestore le vérifient.

---

### 17.8 Rétention et destruction des données (art. 23)

La tâche planifiée `retentionPurge` s'exécute **chaque jour** (fuseau America/Toronto) et supprime définitivement les données personnelles devenues inutiles. Elle traite chaque cible indépendamment (un échec sur l'une n'arrête pas les autres) et applique un **plafond par exécution** (2000 documents/cible) pour drainer un arriéré sur plusieurs jours sans dépasser le délai d'exécution.

| Donnée purgée | Seuil de conservation |
|---|---|
| Articles inactifs (`isActive == false`) | > **3 ans** depuis la dernière modification |
| Préférences de visiteurs non inscrits (`guest_preferences`) | > **90 jours** |
| Notifications | > **180 jours** (6 mois) |
| Historique de recherche (`users/{uid}/searchHistory`) | > **12 mois** |
| Brouillons d'annonces abandonnés (`drafts`) | > **90 jours** sans modification |

**Exclusion explicite** : la collection `transactions` n'est **jamais** purgée — rétention légale de **7 ans** (obligations comptables et fiscales). C'est cohérent avec l'anonymisation (plutôt que suppression) des transactions lors de la fermeture de compte (17.6).

Ces durées sont reflétées dans la Politique de confidentialité affichée à l'utilisateur (transactions jusqu'à 7 ans ; navigation/préférences ≤ 12 mois ; notifications ≤ 6 mois ; visiteurs non inscrits supprimés après 90 jours). Le délai de réponse aux demandes d'accès/rectification/suppression est annoncé à **30 jours maximum**.

---

### 17.9 Registre des incidents de confidentialité (art. 3.5–3.8)

Second tient un **registre des incidents** (`privacy_incidents`), écrit exclusivement côté serveur et lisible par les **administrateurs** uniquement (vérifié à la fois par les règles Firestore et par un garde admin dans le code). Quatre fonctions admin (callables) l'animent :

- **`reportPrivacyIncident`** — créer un incident (type, gravité, description, utilisateurs touchés, champs concernés, mesures, statut). Horodatage serveur `detectedAt`.
- **`getPrivacyIncidentsLog`** — lire le registre, trié du plus récent au plus ancien (plafond 200, max 500).
- **`escalatePrivacyIncidentToCAI`** — consigner la notification de la **Commission d'accès à l'information (CAI)** : pose `notifiedCAI = true`, `notifiedCAIAt`, une référence CAI, et fait avancer un incident `open` vers `investigating` (sans jamais régresser un statut plus avancé).
- **`notifyAffectedUsers`** — envoyer un avis **dans l'application** à chaque utilisateur listé dans l'incident (notification de type `privacy_incident`), en meilleur effort par utilisateur, puis horodater `notifiedUsersAt`.

#### Seuils d'escalade (ancrage de l'obligation légale)
La CAI **et** les personnes concernées doivent être avisées en cas d'**incident présentant un risque de préjudice sérieux**. Le code ancre ce devoir :

| Gravité | Notification CAI |
|---|---|
| `critical` | **Obligatoire** |
| `high` | **Obligatoire** |
| `medium` | À la discrétion du responsable (évaluation cas par cas) |
| `low` | Registre seulement, pas de notification externe |

**Délai cible** : notification CAI + personnes concernées « sans délai indu », avec un objectif de **72 heures** depuis la détection. Les horodatages (`detectedAt` → `notifiedCAIAt` / `notifiedUsersAt`) rendent ce délai **auditable** a posteriori.

#### États d'un incident
`open` → `investigating` → `contained` → `resolved`. Une fonction interne `recordPrivacyIncident` (réutilisable côté serveur, ne lève jamais d'erreur) sert aussi à journaliser automatiquement les échecs (ex. `deletion_failed` lors d'une suppression de compte Stripe ratée — voir 17.6) et les contestations de décisions automatisées.

> Note factuelle : l'outillage du registre est aujourd'hui exposé via des **callables admin** ; il n'existe pas d'écran d'administration dédié dans l'application mobile pour consulter/escalader les incidents (les fonctions sont prêtes à être pilotées par un back-office ou un outil interne).

---

### 17.10 Pages légales

Deux pages légales existent, rédigées en français :

- **Politique de confidentialité** (`PrivacyPolicyContent`) — datée « 31 mai 2026 », structurée en 10 sections : responsable de la protection des renseignements personnels (privacy@seconde.app), renseignements recueillis, finalités, **destinataires et communications hors Québec** (Stripe, ShipEngine/Auctane, Google Vertex AI/Gemini, Firebase — tous principalement aux États-Unis, avec le rappel que les Cloud Functions sont hébergées dans la **région de Montréal**), profilage et technologies, durée de conservation, droits de la personne (accès, rectification, portabilité, suppression, retrait du consentement), consentement et retrait, **incidents de confidentialité**, et coordonnées pour plainte (y compris l'adresse de la CAI). Mention répétée : « Nous ne vendons jamais vos données personnelles à des tiers. »
- **Conditions d'utilisation** (CGU).

#### Accessibilité au moment du consentement (art. 12)
Point de conformité important : ces pages existent en **version publique** sous `app/legal/*`, accessibles **sans être connecté**. C'est délibéré — la Loi 25 (art. 12) exige que la politique soit lisible **au moment du consentement**, avant que l'utilisateur ne coche les cases. Les liens des cases d'inscription pointent donc vers ces routes publiques. Le **même corps de texte** est réutilisé par la route authentifiée (Réglages › Politique de confidentialité) et par la route publique, sans duplication, pour éviter toute divergence.

---

### 17.11 Spécificités Canada & points produit à retenir

- **Marché et localisation** : entreprise présentée comme québécoise (Montréal), copie 100 % FR, calcul d'âge en fuseau **America/Toronto**, devise CAD, hébergement des Cloud Functions en **région de Montréal** (`northamerica-northeast1`). La CAI (et non un régulateur étranger) est l'autorité de référence.
- **Transferts hors Québec** : la Politique liste explicitement les sous-traitants états-uniens (Stripe pour le paiement/KYC, ShipEngine pour l'expédition, Google pour l'IA et l'infrastructure) — exigence de transparence sur les communications hors Québec (art. 8/17).
- **Double référence légale** : l'application cite systématiquement la **Loi 25** (Québec) **et** la **LPRPDE/PIPEDA** (fédéral), plus la **LCAP** pour le marketing.
- **Différence iOS / Android la plus impactante** : la suppression de compte d'un utilisateur **« Sign in with Apple » sur Android** nécessite d'abord d'ajouter un mot de passe (la ré-auth Apple n'existe pas sur Android). Aucune autre divergence de conformité notable entre les deux plateformes.
- **Principe de conception transversal** : tous les traitements sensibles (consentement, retrait marketing, incidents, suppression, journal des décisions automatisées) sont **autorité serveur**, avec des règles Firestore qui interdisent l'écriture client sur les collections de preuve (`consents`, `privacy_incidents`, `automatic_decisions_log`). Les preuves de consentement sont **append-only** et infalsifiables.
