## 15. Notifications & temps réel

Cette section décrit comment Second informe l'utilisateur de ce qui se passe sur son compte : centre de notifications dans l'app, notifications push sur le téléphone, et redirection automatique vers le bon écran quand on tape une notification. Tout est en français, monnaie en dollars canadiens ($), et l'expérience diffère sur certains points entre Android et iOS — ces différences ont un impact produit concret, détaillé ci-dessous.

### 15.1. Vue d'ensemble : deux canaux complémentaires

L'app gère **deux canaux distincts** qui fonctionnent ensemble :

1. **Notification in-app** (centre de notifications) : un message stocké durablement, consultable à tout moment depuis l'écran « Notifications ». C'est l'historique persistant.
2. **Notification push** : l'alerte qui apparaît sur l'écran verrouillé / dans la barre de notifications du téléphone, même app fermée. C'est l'alerte temps réel.

Règle de gestion centrale : **la notification in-app est créée quoi qu'il arrive**, même si l'utilisateur a coupé le push ou n'a pas d'appareil joignable. Le push, lui, peut ne pas partir (préférence désactivée, pas d'appareil enregistré, ou limite iOS — voir 15.6). L'historique reste donc toujours complet dans l'app, et c'est le filet de sécurité de toute la mécanique.

Le décompte de notifications non lues alimente un **badge** affiché dans l'app. À noter : le badge de l'onglet « Messages » (barre du bas) reflète les **messages de chat** non lus, pas les notifications. Le centre de notifications est ouvert depuis l'**icône cloche de l'en-tête de l'accueil** (Home), qui mène à l'écran `/notifications`.

### 15.2. Le centre de notifications (écran `/notifications`)

C'est la liste chronologique (du plus récent au plus ancien) de toutes les notifications de l'utilisateur.

**Ce que l'utilisateur voit pour chaque ligne :**
- Une **icône ronde colorée** propre au type (cœur pour favoris, étiquette pour baisse de prix, billet pour offre, sac pour vente, etc.).
- Un **titre** et un **message** (ex. « Baisse de prix ! » / « "Robe en lin" est passé de 60 $ à 45 $ (-25%) »).
- Un **horodatage relatif** en français : « À l'instant », « Il y a 12 min », « Il y a 3h », « Il y a 2j », puis la date courte (ex. « 14 mai ») au-delà de 7 jours.
- Un **point bleu** et un **fond légèrement teinté** tant que la notification n'est pas lue.

**Actions disponibles :**

| Action | Comment | Effet |
|---|---|---|
| Lire une notification | Taper dessus | Marquée comme lue + redirection vers l'écran cible (voir 15.5) |
| Tout marquer comme lu | Bouton « Tout lire » dans l'en-tête (visible seulement s'il reste des non-lues) | Toutes passent en « lues », badge remis à zéro |
| Supprimer | Glisser la ligne vers la gauche → bouton corbeille | Suppression définitive de la notification |
| Rafraîchir | Tirer la liste vers le bas (pull-to-refresh) | Recharge depuis le serveur |

**État vide :** si l'utilisateur n'a aucune notification, un écran dédié explique : « Vous recevrez des notifications pour les favoris, baisses de prix, et propositions d'achat. »

**Détail de cohérence visuelle :** d'anciennes notifications stockées pouvaient contenir un emoji en début de titre/message. L'app **retire automatiquement l'emoji de tête** à l'affichage, pour rester alignée sur la charte (pas d'emoji dans le texte). Les données historiques restent donc présentables sans migration.

**Mise à jour optimiste :** quand on lit, supprime ou marque tout comme lu, l'écran se met à jour immédiatement (sans attendre le serveur), puis le compteur du badge est rafraîchi. L'utilisateur n'attend jamais.

### 15.3. Les types de notifications

Le système couvre un large éventail d'événements métier. Voici l'inventaire concret de ce qui déclenche une notification, regroupé par domaine.

**Messagerie & offres**
- **Nouveau message** : reçu quand un autre utilisateur écrit (texte ou photo). Le titre est le nom de l'expéditeur ; le corps rappelle l'article concerné (« À propos de "…" ») ou un extrait du message.
- **Offre reçue** : le vendeur est prévenu quand un acheteur propose un montant en $ sur un de ses articles.
- **Réponse à une offre** : l'acheteur est prévenu quand le vendeur **accepte**, **refuse** ou fait une **contre-offre**. La contre-offre couvre trois variantes : nouveau **prix**, nouveau **lieu** de rencontre, ou nouvel **horaire**.

**Vente & commande**
- **Nouvelle vente** : le vendeur est notifié dès qu'un achat est payé (« Nouvelle vente ! Vous avez vendu … Préparez l'envoi. »). Déclenché par le webhook de paiement Stripe à la confirmation du paiement.
- Le système prévoit aussi des notifications **expédiée / livrée / annulée / remboursée** (commandes), routées vers l'écran « Mes commandes ».

**Intérêt sur un article**
- **Article ajouté en favori** : le vendeur est prévenu quand quelqu'un met un de ses articles en favori (« Nouvel intérêt pour votre article »).
- **Baisse de prix** : tous les utilisateurs qui ont l'article en favori sont prévenus si le prix baisse, avec l'ancien prix, le nouveau prix et le pourcentage de remise. Le vendeur lui-même n'est jamais notifié de sa propre baisse.

**Recherche sauvegardée**
- **Nouveaux articles correspondants** : quand de nouveaux articles correspondent à une recherche que l'utilisateur a enregistrée et dont il a activé l'alerte. Le titre indique le nombre de nouveautés (« 3 nouveaux articles »).

**Swap (échange d'articles)**
- Proposition d'échange reçue, échange accepté / refusé / annulé, **paiement requis** (quand un complément en $ est dû), **photos requises**, **prêt à expédier**, **échange terminé**, et **litige ouvert** (les deux parties sont prévenues). Couvre tout le cycle de vie d'un troc.

**Boutiques (offre payante)**
- Boutique en attente de validation (notification aux admins), **boutique approuvée**, **boutique refusée** (avec la raison). Ces notifications sont **in-app uniquement** et renvoient vers le centre de notifications.

**Avis**
- **Avis reçu** : l'utilisateur est prévenu quand on lui laisse une note/évaluation.

**Confidentialité (Loi 25 — Québec/Canada)**
- **Incident de confidentialité** : en cas d'incident touchant des données personnelles, un avis « Incident de confidentialité » est envoyé **uniquement aux utilisateurs affectés**, en in-app. C'est un canal de conformité réglementaire (obligation d'information de la Loi 25), déclenché côté serveur de façon contrôlée, jamais par un utilisateur.

### 15.4. Notifications push : Android vs iOS (point produit important)

L'envoi des push passe par l'infrastructure Firebase Cloud Messaging (FCM) côté serveur. Le comportement diffère selon la plateforme du téléphone, avec une **limite connue et assumée sur iOS**.

**Android — pleinement fonctionnel.**
- À la connexion, l'app demande l'autorisation d'envoyer des notifications. Si accordée, le téléphone obtient un jeton (token) que le serveur sait utiliser, et l'appareil est enregistré sur le compte.
- Les push arrivent en temps réel et déclenchent la redirection au tap.

**iOS — push non opérationnel à ce jour (limite documentée).**
- Sur iPhone, le jeton fourni par le système n'est pas dans le format que le serveur sait envoyer directement. Le serveur **détecte et ignore** ces jetons : il ne les enregistre pas comme exploitables et ne les supprime pas par erreur.
- **Conséquence produit concrète : un utilisateur iOS ne reçoit pas de notification push** pour l'instant. En revanche, **toutes ses notifications in-app sont bien créées** : il retrouve l'intégralité de son historique dans le centre de notifications dès qu'il ouvre l'app, et le badge se met à jour.
- C'est un choix de périmètre, pas un bug silencieux : activer le push iOS nécessite une étape native supplémentaire (intégration d'un vrai jeton FCM côté iOS), identifiée et planifiée (« TODO push-ios »).

**Tableau de synthèse :**

| | Android | iOS |
|---|---|---|
| Notification in-app (centre) | Oui | Oui |
| Badge non-lus | Oui | Oui |
| Push (écran verrouillé / hors app) | Oui | Non (limite connue) |
| Redirection au tap d'un push | Oui | Sans objet tant que le push n'arrive pas |

**Préférences utilisateur (push activable par type).** Dans Réglages → Notifications, l'utilisateur dispose d'interrupteurs :
- Interrupteur global **Notifications push** (et un interrupteur **email**, à vocation future).
- Interrupteurs par type : nouveaux messages, nouvelles ventes, baisses de prix, articles favoris, propositions d'achat, réponses aux offres.

Logique de **respect de la vie privée par défaut (opt-in)** : les notifications « marketing / secondaires » (baisses de prix, articles favoris) sont **désactivées par défaut** ; les notifications transactionnelles essentielles (messages, ventes, offres) sont activées par défaut. Si l'utilisateur coupe le push global, les push ne partent pas mais **l'historique in-app continue d'être alimenté**. L'interrupteur « rappel Swap Zone » existe en données mais est masqué dans l'UI : la Swap Zone est désormais une zone permanente (sans fenêtre temporelle), donc le rappel programmé est désactivé côté serveur.

### 15.5. Redirection (deep links) : taper une notification ouvre le bon écran

Chaque notification embarque l'information de destination. Taper dessus — que ce soit dans le centre in-app ou sur un push Android — ouvre directement l'écran pertinent.

| Type de notification | Écran ouvert |
|---|---|
| Message, offre, réponse d'offre | La conversation `/chat/{id}` |
| Article en favori, baisse de prix | La fiche article `/article/{id}` |
| Rappel Swap Zone | La zone d'échange `/swap-party/{id}` |
| Mise à jour de swap | L'échange `/swap/{id}` |
| Recherche sauvegardée | L'écran de recherche pré-rempli avec la requête et les filtres enregistrés |
| Vente / commande | « Mes commandes » `/my-orders` |
| Boutique, avis, incident confidentialité | Le centre de notifications |

**Cas particulier — recherche sauvegardée :** taper la notification ne fait pas que rouvrir la recherche ; ça **remet aussi à zéro le compteur de nouveaux articles** de cette recherche et relance la recherche avec la requête et les filtres exacts qui avaient été enregistrés (mots-clés, marques, catégories, prix, taille, couleur, etc.).

**App fermée (« killed ») :** si l'utilisateur ouvre l'app **en tapant un push alors qu'elle était complètement fermée**, l'app détecte la notification d'origine au démarrage et effectue la redirection une fois l'interface prête. (Ce scénario concerne Android, le push iOS n'étant pas encore actif.)

**Liens universels (Canada / web) :** les destinations sont aussi construites sous forme de liens `https://seconde.app/…` et du schéma `seconde://`. L'app est associée au domaine `seconde.app` (et `www.seconde.app`) sur iOS comme Android, ce qui permet à terme d'ouvrir l'app depuis un lien web — utile pour le partage d'articles et les campagnes.

### 15.6. Channels Android (catégories système)

Android 8+ exige de classer les notifications dans des **channels** (catégories). L'utilisateur peut, dans les réglages système d'Android, régler finement chaque catégorie (son, vibration, priorité, voire la couper). L'app crée à la connexion les channels suivants :

| Channel | Intitulé affiché | Contenu | Importance |
|---|---|---|---|
| `messages` | Messages | Nouveaux messages de chat | Haute (vibration + lumière) |
| `offers` | Offres | Offres et propositions | Haute |
| `orders` | Commandes | Ventes, expéditions, livraisons, remboursements | Haute |
| `swaps` | Swap Zones | Rappels et mises à jour d'échange | Normale |
| `saved_searches` | Recherches sauvegardées | Nouveaux articles correspondants | Normale |
| `notifications` | Notifications | Général (favoris, baisses de prix, avis, confidentialité) | Normale |

Détail technique à portée produit : **sans channel déclaré, Android jette silencieusement la notification** (et donc ni l'alerte, ni le tap, ni la remise à zéro du compteur n'auraient lieu). Le channel `saved_searches` est explicitement requis pour que l'alerte de recherche sauvegardée fonctionne de bout en bout.

### 15.7. Comment les notifications sont déclenchées (règles de gestion serveur)

Les notifications ne sont pas envoyées par le téléphone de l'expéditeur : elles sont générées **côté serveur**, automatiquement, en réaction à des événements de données. Cela garantit fiabilité et sécurité (un utilisateur ne peut pas forger une notification au nom d'un autre).

**Déclencheurs « en temps réel » (réaction immédiate à un événement) :**
- Nouveau message créé → notifie le destinataire. Garde-fou de sécurité : si l'un des deux utilisateurs a **bloqué** l'autre, le message est supprimé côté serveur et **aucune notification n'est envoyée**.
- Changement de statut d'offre → notifie l'acheteur.
- Article ajouté en favori → notifie le vendeur (sauf s'il a coupé cette préférence).
- Baisse de prix d'un article → notifie en lot tous ceux qui l'ont en favori (par paquets, en respectant chaque préférence individuelle).
- Création / changement de statut d'un swap → notifie la ou les bonnes parties.
- Paiement confirmé → notifie le vendeur de la nouvelle vente.

**Déclencheurs « programmés » (vérifications périodiques) :**
- **Recherches sauvegardées** : toutes les **15 minutes**, le serveur recherche les nouveaux articles correspondant aux recherches dont l'alerte est active et notifie les utilisateurs concernés, puis met à jour la date du dernier envoi et le compteur de nouveautés. Pour ne pas spammer, il ne considère que les articles créés depuis le dernier envoi.

**Nettoyage automatique des appareils morts :** quand le serveur tente un push et que le jeton est invalide ou expiré (utilisateur qui a désinstallé, etc.), ce jeton est **retiré automatiquement** du compte. Les jetons iOS « bruts » sont au contraire préservés (non envoyés mais non supprimés), pour ne pas casser le futur push iOS.

### 15.8. Données clés (en langage métier)

- **fcmTokens** (sur le profil utilisateur) : la liste des appareils enregistrés pour recevoir les push. Un utilisateur peut avoir plusieurs appareils ; chacun reçoit l'alerte. À la **déconnexion**, le jeton de l'appareil courant est retiré et le compteur de notifications est remis à zéro — l'appareil ne reçoit plus rien après logout.
- **notifications** (collection) : l'historique in-app. Chaque entrée porte le destinataire, le type, le titre, le message, des données de routage, un indicateur lu/non-lu et une date de création.
- **preferences.notifications** (sur le profil) : les interrupteurs de l'utilisateur (push global + par type). Consultés à chaque envoi côté serveur.
- **Compteur de non-lus** : calculé à partir des notifications non lues ; alimente le badge in-app. Rafraîchi à la connexion, à la réception d'une notification, et après chaque lecture/suppression.

### 15.9. Spécificités Canada

- **Devise** : tous les montants dans les notifications (offres, ventes, baisses de prix) sont en **dollars canadiens**, affichés avec le symbole « $ » (ex. « 45 $ », « -25% »).
- **Loi 25 (protection des renseignements personnels)** : le type de notification **« Incident de confidentialité »** est un canal de conformité — il permet d'informer formellement et uniquement les utilisateurs réellement concernés en cas d'incident, conformément à l'obligation québécoise/canadienne d'aviser les personnes touchées.
- **Opt-in par défaut** : la politique « vie privée par défaut » (notifications non essentielles désactivées tant que l'utilisateur ne les active pas) s'inscrit dans cette même logique de respect du consentement.
- **Infrastructure régionale** : toutes les fonctions serveur qui déclenchent les notifications sont hébergées dans la région canadienne (`northamerica-northeast1`).

### 15.10. Limites connues à retenir (synthèse)

- **Push iOS non actif** : les iPhone ne reçoivent pas (encore) d'alerte hors app ; l'historique in-app et le badge restent complets. Étape native requise et planifiée.
- **Badge onglet « Messages »** : il compte les messages de chat non lus, distinct du centre de notifications (ouvert via la cloche de l'accueil).
- **Recherches sauvegardées** : vérifiées par lots toutes les 15 minutes, donc une alerte peut arriver avec un léger délai (pas instantané) ; le filtrage fin (taille, couleur, matière, état) est appliqué côté serveur après une première sélection.
