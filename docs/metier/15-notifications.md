## 15. Notifications & temps réel

Cette section décrit comment Second informe l'utilisateur de ce qui se passe sur son compte : centre de notifications dans l'app, notifications push sur le téléphone, et redirection automatique vers le bon écran quand on tape une notification. Tout est en français, monnaie en dollars canadiens ($), et l'expérience diffère fortement entre Android et iOS — ces différences ont un impact produit concret, détaillé ci-dessous.

Le contenu de cette section a été vérifié ligne à ligne dans le code : `app/notifications.tsx`, `app/settings/notifications.tsx`, `features/notifications/**`, `store/notificationStore.ts`, `functions/src/utils/notifications.ts`, `functions/src/triggers/**`, `functions/src/scheduled/**`, ainsi que les règles Firestore. Les trous constatés sont explicités, pas maquillés.

---

### 15.1. Vue d'ensemble : deux canaux, et ce qui les sépare vraiment

L'app gère **deux canaux distincts** :

1. **Notification in-app** (centre de notifications) : un message stocké durablement dans la base, consultable depuis l'écran « Notifications ». C'est l'historique persistant, et c'est lui qui alimente le badge de la cloche.
2. **Notification push** : l'alerte qui apparaît sur l'écran verrouillé / dans la barre de notifications du téléphone, même app fermée.

**Règle réelle (à ne pas confondre avec l'intention initiale).** La notification in-app est créée automatiquement **uniquement quand l'événement passe par la voie standard du serveur** (`sendPushNotification` dans `functions/src/utils/notifications.ts`). Trois familles d'événements y échappent aujourd'hui :

| Cas | Ce qui se passe réellement |
|---|---|
| L'utilisateur a désactivé **ce type précis** de notification | **Ni push ni in-app** — la notification est abandonnée avant création. Elle ne figurera nulle part, même pas dans l'historique. |
| **Tout le cycle Swap** (proposition, acceptation, refus, photos, expédition, litige, expiration) | **Push seulement.** Aucune trace dans le centre de notifications, sur aucune plateforme. |
| **Recherche sauvegardée** (nouveaux articles correspondants) | **Push seulement**, et uniquement vers les appareils joignables — un compte sans appareil joignable est purement ignoré. |

En revanche, si l'utilisateur coupe l'**interrupteur push global**, l'in-app continue bien d'être créé : il retrouve tout dans le centre de notifications.

Le décompte de non-lus alimente un **badge sur l'icône cloche de l'en-tête de l'accueil** (`features/home/header/HomeHeader.tsx`), plafonné à l'affichage « 9+ ». C'est le seul point d'entrée du centre de notifications (`/notifications`) ; aucun onglet de la barre du bas ne le porte. Le badge de l'onglet **« Messages »** est indépendant : il compte les **messages de chat** non lus (plafonné à « 99+ »).

---

### 15.2. Le centre de notifications (écran `/notifications`)

Liste chronologique (du plus récent au plus ancien) de toutes les notifications in-app de l'utilisateur.

**Ce que l'utilisateur voit pour chaque ligne :**
- Une **icône ronde colorée** propre au type (cœur pour favoris, étiquette pour baisse de prix, billet pour offre, sac pour vente, bouclier pour incident de confidentialité, etc.). Un type inconnu de l'app retombe sur une cloche générique — cas réel, voir 15.4.
- Un **titre** et un **message** (ex. « Baisse de prix ! » / « "Robe en lin" est passé de 60 $ à 45 $ (-25%) »).
- Un **horodatage relatif** en français : « À l'instant », « Il y a 12 min », « Il y a 3h », « Il y a 2j », puis la date courte (ex. « 14 mai ») au-delà de 7 jours.
- Un **point bleu** et un **fond légèrement teinté** tant que la notification n'est pas lue.

**Actions disponibles :**

| Action | Comment | Effet |
|---|---|---|
| Lire une notification | Taper dessus | Marquée comme lue, puis redirection vers l'écran cible (voir 15.7) |
| Tout marquer comme lu | Bouton « Tout lire » dans l'en-tête (visible seulement s'il reste des non-lues) | Toutes passent en « lues » en une seule opération, badge remis à zéro |
| Supprimer | Glisser la ligne vers la gauche → bouton corbeille | Suppression définitive |
| Rafraîchir | Tirer la liste vers le bas (pull-to-refresh) | Recharge depuis le serveur |

**États de l'écran :** chargement (6 lignes squelette) · erreur (« Impossible de charger » + bouton « Réessayer ») · vide (« Aucune notification » — « Vous recevrez des notifications pour les favoris, baisses de prix, et propositions d'achat »).

**Détail de cohérence visuelle :** d'anciennes notifications stockées pouvaient contenir un emoji en début de titre/message. L'app **retire automatiquement l'emoji de tête** à l'affichage, pour rester alignée sur la charte. Les données historiques restent présentables sans migration.

**Correction par rapport à la version précédente de ce document — l'écran n'est PAS optimiste.** Lire, supprimer ou tout marquer comme lu attend d'abord la confirmation du serveur, puis met la liste à jour. Sur réseau lent, l'utilisateur attend. (Les interrupteurs de l'écran *Réglages → Notifications*, eux, sont bien optimistes avec retour arrière en cas d'échec.)

**Deux limites structurelles :**
- La liste **n'est pas paginée** : l'écran charge d'un coup toutes les notifications du compte. Ce qui borne le volume aujourd'hui, c'est la purge automatique.
- **Purge automatique à 180 jours** : une tâche quotidienne supprime définitivement les notifications de plus de 6 mois (`functions/src/scheduled/retentionPurge.ts`), au titre de la minimisation des données (Loi 25).

---

### 15.3. Inventaire vérifié : ce qui déclenche réellement une notification

Chaque ligne ci-dessous a été retrouvée dans le code. « In-app » = trace dans le centre de notifications ; « Push » = alerte sur le téléphone (Android uniquement, voir 15.5).

**Messagerie & offres** — `functions/src/triggers/messages.ts` · in-app + push

| Événement | Destinataire | Contenu |
|---|---|---|
| Nouveau message (texte ou photo) | L'autre participant | Titre = nom de l'expéditeur ; corps = « À propos de "…" » (ou extrait du message si la conversation n'est liée à aucun article) |
| Offre reçue | Le vendeur | « Nouvelle offre de … » / « 45 $ pour "…" » |
| Offre acceptée / refusée | L'acheteur | Réponse du vendeur |
| Contre-offre | L'acheteur | Trois variantes : nouveau **prix**, nouveau **lieu** de rencontre, nouvel **horaire** |

**Intérêt sur un article** — `functions/src/triggers/favorites.ts` · in-app + push

| Événement | Destinataire | Règle |
|---|---|---|
| Article ajouté en favori | Le vendeur | Jamais notifié s'il met son propre article en favori |
| Baisse de prix | Tous ceux qui ont l'article en favori | Envoi par paquets de 10 ; le vendeur est exclu ; message avec ancien prix, nouveau prix et pourcentage |

**Avis** — `functions/src/callable/reviews.ts` et `functions/src/callable/swaps.ts` · in-app + push
- Avis reçu (« Nouvel avis reçu — X vous a laissé un avis 4/5 »), aussi bien pour un avis d'achat que pour un avis d'échange.

**Boutiques** — `functions/src/callable/shopModeration.ts` · in-app + push
- **Boutique approuvée**, **boutique refusée** (avec la raison), **boutique suspendue** (envoyée sous le même type que « refusée »). Ces notifications **partent bien en push** — contrairement à ce qu'affirmait la version précédente de ce document ; c'est seulement leur **destination au tap** qui est le centre de notifications.
- **Trou :** aucune notification n'avertit les administrateurs qu'une boutique attend validation. Le type existe dans le code (`shop_created`) mais **rien ne l'émet**. La modération repose entièrement sur la consultation manuelle de l'écran admin.

**Confidentialité (Loi 25)** — `functions/src/callable/privacyIncidents.ts` · **in-app uniquement, pas de push**
- **Incident de confidentialité** : envoyé un par un aux seuls utilisateurs affectés, déclenché par une action serveur contrôlée, jamais par un utilisateur. C'est le canal formel d'avis prévu par la Loi 25.

**Commande, livraison, argent** — in-app + push. **Attention : rail fermé aujourd'hui.**
Les drapeaux `SHIPPING_ENABLED` et `PAYMENTS_ENABLED` sont à `false` (`config/featureFlags.ts` et `functions/src/config/featureFlags.ts`). Le seul parcours d'achat ouvert est la rencontre en main propre, sans argent qui transite par la plateforme. **Toutes les notifications ci-dessous existent et sont câblées, mais ne peuvent pas survenir tant que ces drapeaux ne sont pas ouverts.**

| Notification | Destinataire | Déclencheur |
|---|---|---|
| Nouvelle vente | Vendeur | Confirmation du paiement Stripe |
| Colis livré | Acheteur | Scan « livré » du transporteur |
| Remboursement effectué / Commande remboursée | Acheteur **et** vendeur | Recours acheteur, ou retour reçu |
| Fonds libérés | Vendeur | 7 jours après le scan « livré » |
| Commande annulée | Selon le cas | Voir ci-dessous |

Le type « commande annulée » sert de fourre-tout pour **neuf situations différentes** : litige clôturé en faveur du vendeur, annulation par le vendeur avant expédition, signalement de rencontre manquée, contestation d'un signalement de rencontre manquée, expiration d'un rendez-vous non confirmé (48 h), expiration d'une rencontre confirmée non finalisée (7 jours), expiration d'un paiement en attente (1 h), étiquette créée mais colis jamais déposé, commande payée jamais expédiée. Le texte du message distingue les cas ; l'icône, elle, est identique partout.

**Rencontre en main propre (le seul parcours actif)** — ce qu'il émet vraiment :
- **Signalement de rencontre manquée** → la personne mise en cause (`functions/src/callable/payments/meetup.ts`). Le tap ouvre la **conversation**, seul endroit où elle peut répondre.
- **Signalement contesté** → le premier signaleur, quand la personne visée donne sa version depuis la bulle d'offre. Ouvre également la conversation.
- **Rendez-vous non confirmé sous 48 h** → **l'acheteur seulement**. Le vendeur n'est pas prévenu que sa vente vient d'être annulée. *(Trou.)*
- **Rencontre confirmée non finalisée sous 7 jours** → les deux parties.
- **Aucune notification** quand une rencontre est proposée, confirmée ou complétée. Ces étapes ne sont portées que par la conversation (messages système + notifications de chat/offre décrites plus haut).

**Swap (échange d'articles)** — `functions/src/triggers/swaps.ts`, `functions/src/scheduled/swaps.ts`, `functions/src/callable/swaps.ts` · **push uniquement, aucune trace in-app**
Proposition d'échange reçue · échange accepté / refusé / annulé · **paiement requis** (complément en $ dû) · **photos requises** · **prêt à expédier** · **échange terminé** · **litige ouvert** (les deux parties) · **litige résolu** · **échange expiré** (relances automatiques toutes les heures).
**Conséquence produit :** un utilisateur iPhone ne voit **rien** de ce cycle, et même sur Android, si l'alerte est balayée ou manquée, elle est définitivement perdue — le centre de notifications ne la rattrape pas.

**Recherche sauvegardée** — `functions/src/scheduled/savedSearches.ts` · **push uniquement**
Toutes les **15 minutes**, le serveur cherche les nouveaux articles correspondant aux recherches dont l'alerte est active et pousse une alerte (« 3 nouveaux articles »). Aucune trace in-app, et les comptes sans appareil joignable (dont tous les iPhone) sont sautés d'emblée. Détail de qualité : la formulation du titre est fautive au pluriel (« 2 nouvels articles » au lieu de « 2 nouveaux articles »).

---

### 15.4. Trous connus : types déclarés mais jamais émis, et types émis mais non reconnus

**A. Déclarés dans l'app, jamais émis par le serveur** — ils existent dans la liste des types, ont une icône dédiée, parfois même une destination prévue, mais **aucun événement ne les produit** :
`shop_created` (boutique en attente de modération) · `order_shipped` (**colis expédié — l'acheteur n'est jamais prévenu de l'expédition ; seule la livraison déclenche une notification**) · `offer_expired` (une offre qui expire ne prévient personne) · `meetup_reminder`, `meetup_confirmed`, `meetup_cancelled`, `no_show_reported` · `article_liked`, `article_sold` · `swap_zone_reminder` (le rappel Swap Zone n'existe dans aucune tâche planifiée) · `swap_accepted`, `swap_declined`, `swap_photos_uploaded`, `swap_shipped`, `swap_received`, `swap_completed`, `swap_party_starting`, `swap_party_ending`, `swap_match_found` (le cycle swap passe en réalité par un unique type générique).

**B. Émis par le serveur, inconnus de l'app** — ils créent bien une notification in-app et un push, mais l'app ne les reconnaît pas : **icône générique** et **aucune destination construite** :

| Type émis | Situation | Conséquence au tap |
|---|---|---|
| `return_requested` | L'acheteur demande un retour → le vendeur est prévenu | Ouvre la fiche article, pas la commande |
| `delivery_failed` | Échec de livraison / colis perdu → les deux parties | Ouvre la fiche article, pas la commande |
| `label_stale_reminder` | Étiquette créée mais colis jamais déposé → relance vendeur | Ouvre la fiche article, pas la commande |
| `stripe_requirements_due` | Stripe réclame des informations de conformité au vendeur | **Le tap ne mène nulle part** — aucune donnée de routage n'est jointe |

Ces quatre cas appartiennent tous au rail livraison / paiement, donc inactif aujourd'hui — sauf `stripe_requirements_due`, qui peut survenir dès qu'un vendeur a un compte Stripe.

**C. Reste inerte côté téléphone.** Les règles Firestore interdisent formellement à un téléphone de créer une notification (`allow create: if false`). Le service client contient encore des méthodes de création (favoris, baisse de prix, offres) qui ne sont appelées par aucun écran, et deux méthodes de modération de boutique volontairement vidées : les écrans admin les appellent encore, mais la vraie notification vient du serveur.

---

### 15.5. Notifications push : Android vs iOS (point produit important)

L'envoi des push passe par l'infrastructure Firebase Cloud Messaging (FCM) côté serveur.

**Android — pleinement fonctionnel.**
- À l'ouverture de session, l'app demande l'autorisation d'envoyer des notifications (elle ne redemande pas si le système a fermé la porte : le passage par les réglages est alors proposé depuis l'écran de préférences). Si accordée, l'appareil est enregistré sur le compte.
- Les push arrivent en temps réel et déclenchent la redirection au tap.

**iOS — push non opérationnel à ce jour (limite documentée).**
- Sur iPhone, le jeton fourni par le système n'est pas du type que le serveur sait envoyer. **L'app le détecte et refuse de l'enregistrer**, et le serveur applique le même filtre par sécurité sur les jetons déjà stockés : il les écarte sans les supprimer, pour ne pas casser la future activation.
- **Conséquence produit : un utilisateur iOS ne reçoit aucune notification push.** Il retrouve en revanche son historique in-app complet dans le centre de notifications — **sauf** les notifications de swap et de recherche sauvegardée, qui n'existent qu'en push et lui sont donc totalement invisibles (voir 15.1 et 15.3).
- C'est un choix de périmètre, pas un bug silencieux : la configuration iOS est déjà en place (domaines associés, mode « notification distante », plugin de notifications) ; il manque l'étape native qui produit un jeton exploitable par FCM (repérée dans le code sous « TODO push-ios »).

**Tableau de synthèse :**

| | Android | iOS |
|---|---|---|
| Notification in-app (centre) | Oui | Oui |
| Badge non-lus | Oui | Oui |
| Push (écran verrouillé / hors app) | Oui | **Non (limite connue)** |
| Notifications Swap | Push seulement → reçues, mais sans historique | **Jamais reçues, ni historique** |
| Alertes de recherche sauvegardée | Push seulement → reçues, sans historique | **Jamais reçues, ni historique** |
| Redirection au tap d'un push | Oui | Sans objet tant que le push n'arrive pas |

**Autre limite constatée :** le mécanisme prévu pour **ne pas afficher de bannière quand on est déjà dans la conversation concernée** existe dans le code mais **n'est branché sur aucun écran** — en pratique, une bannière peut s'afficher par-dessus la conversation qu'on est en train de lire.

---

### 15.6. Préférences utilisateur (Réglages → Notifications)

L'utilisateur dispose d'interrupteurs (`app/settings/notifications.tsx`) :
- **Notifications push** (global) et **Notifications par email** (l'interrupteur existe et se sauvegarde, mais **aucun envoi email n'est implémenté** — vocation future).
- Par type : nouveaux messages · nouvelles ventes · baisses de prix · articles favoris · propositions d'achat · réponses aux offres.

**Comment chaque interrupteur agit réellement :**

| Interrupteur | Effet quand il est coupé |
|---|---|
| Push global | Le push ne part pas, **mais l'in-app continue d'être créé** — l'historique reste complet |
| Un type précis | **Ni push ni in-app** : la notification est purement abandonnée, elle ne réapparaîtra jamais |

Activer l'interrupteur push global réconcilie avec la permission système : si le système refuse, une alerte propose d'ouvrir les réglages de l'appareil plutôt que de laisser un interrupteur allumé sans effet.

**Point de conformité à corriger — l'opt-in « par défaut » n'est pas appliqué côté serveur.** L'intention produit est que les notifications secondaires (baisses de prix, articles favoris) soient **désactivées par défaut** et les transactionnelles activées. C'est vrai **dans l'affichage** de l'écran de réglages. Mais tant que l'utilisateur n'a **rien touché**, aucune préférence n'est réellement enregistrée sur son compte, et le serveur, qui ne bloque que sur un « non » explicite, **envoie ces notifications**. L'opt-in ne devient effectif qu'après une action de l'utilisateur : basculer un interrupteur, ou refuser le consentement marketing dans *Réglages → Confidentialité* (ce dernier coupe d'un coup baisses de prix, articles favoris et rappel Swap Zone, avec journalisation du retrait au titre de la Loi 25).

**Interrupteur masqué :** « rappel Swap Zone » existe en données mais n'est pas affiché — la Swap Zone est désormais une zone permanente sans fenêtre temporelle, et aucune tâche serveur n'émet ce rappel.

**Types toujours délivrés, sans interrupteur possible :** avis reçu, incident de confidentialité, notifications de boutique, mises à jour de swap, et tout type non répertorié. C'est délibéré : une notification de sécurité ou de conformité ne doit pas pouvoir disparaître silencieusement.

---

### 15.7. Redirection (deep links) : taper une notification ouvre le bon écran

Chaque notification embarque son adresse de destination, construite par le serveur. Taper dessus — dans le centre in-app ou sur un push Android — ouvre l'écran pertinent.

| Type de notification | Écran ouvert |
|---|---|
| Message, offre, réponse d'offre | La conversation `/chat/{id}` |
| Article en favori, baisse de prix | La fiche article `/article/{id}` |
| Mise à jour ou proposition de swap | L'échange `/swap/{id}` |
| Rappel Swap Zone | La zone d'échange `/swap-party/{id}` *(destination câblée, mais jamais émise — voir 15.4)* |
| Recherche sauvegardée | L'écran de recherche pré-rempli |
| Vente / commande / fonds libérés | « Mes commandes » `/my-orders`, positionné sur la transaction |
| Signalement de rencontre manquée, et sa contestation | La conversation `/chat/{id}` — là où la rencontre se joue et où la partie mise en cause donne sa version *(à défaut de conversation jointe : « Mes commandes »)* |
| Boutique, avis, incident de confidentialité | Le centre de notifications |
| Types non reconnus (voir 15.4 B) | Retombée : fiche article si un article est joint, sinon rien |

**Cas particulier — recherche sauvegardée :** taper la notification ne fait pas que rouvrir la recherche ; ça **remet aussi à zéro le compteur de nouveaux articles** de cette recherche et relance la recherche avec la requête et les filtres exacts enregistrés (mots-clés, marques, catégories, prix, taille, couleur, matière, état).

**App fermée (« killed ») :** si l'utilisateur ouvre l'app en tapant un push alors qu'elle était complètement fermée, l'app retrouve la notification d'origine au démarrage et effectue la redirection une fois l'interface prête. (Scénario Android uniquement, le push iOS n'étant pas actif.)

**Liens universels (Canada / web) :** les destinations sont construites sous forme de liens `https://seconde.ca/…`, avec aussi le schéma `seconde://`. L'app est associée à `seconde.ca` et `www.seconde.ca` sur iOS comme Android, ce qui permet d'ouvrir l'app depuis un lien web — utile pour le partage d'articles et les campagnes. *(Le domaine précédent `seconde.app` n'est plus utilisé nulle part dans le code.)*

---

### 15.8. Channels Android (catégories système)

Android 8+ exige de classer les notifications dans des **channels**. L'utilisateur peut, dans les réglages système, régler finement chaque catégorie (son, vibration, priorité, voire la couper). L'app crée à l'ouverture de session :

| Channel | Intitulé affiché | Contenu | Réglage |
|---|---|---|---|
| `messages` | Messages | Nouveaux messages de chat | Haute — son, vibration, lumière |
| `offers` | Offres | Offres et propositions | Haute — son, vibration |
| `orders` | Commandes | Ventes, livraisons, remboursements, annulations | Haute — son, vibration |
| `swaps` | Swap Zones | Cycle d'échange | Normale — **sans son** |
| `saved_searches` | Recherches sauvegardées | Nouveaux articles correspondants | Normale — **sans son** |
| `notifications` | Notifications | Tout le reste : favoris, baisses de prix, avis, boutique, confidentialité, types non classés | Normale — **sans son** |

Détail technique à portée produit : **sans channel déclaré, Android jette silencieusement la notification** (ni alerte, ni tap, ni remise à zéro du compteur). Les six channels ci-dessus couvrent l'intégralité des envois serveur.

---

### 15.9. Règles de gestion serveur

Les notifications sont générées **côté serveur**, en réaction à des événements de données. Un utilisateur ne peut pas en forger une : les règles Firestore interdisent toute création depuis un téléphone, autorisent la lecture et la suppression de ses seules notifications, et n'autorisent la modification que du seul indicateur « lu ».

**Déclencheurs immédiats :**
- Nouveau message créé → notifie le destinataire. **Deux garde-fous de sécurité** appliqués avant tout envoi : (a) le vrai destinataire est relu depuis la conversation côté serveur, jamais depuis ce que le téléphone prétend ; (b) si l'un des deux utilisateurs a **bloqué** l'autre — ou si l'expéditeur n'est pas réellement participant de la conversation — le message est **supprimé** côté serveur et **aucune notification n'est envoyée**.
- Changement de statut d'une offre → notifie l'acheteur.
- Article ajouté en favori → notifie le vendeur (sauf préférence explicitement coupée).
- Baisse de prix → notifie par paquets de 10 tous ceux qui l'ont en favori, en vérifiant chaque préférence individuellement.
- Création / changement de statut d'un swap → notifie la ou les bonnes parties (push seulement).
- Paiement confirmé → notifie le vendeur *(rail fermé aujourd'hui)*.

**Déclencheurs programmés (région canadienne `northamerica-northeast1`) :**

| Tâche | Fréquence | Notifications produites |
|---|---|---|
| Recherches sauvegardées | Toutes les 15 min | Nouveaux articles correspondants (push seul) |
| Expiration de transactions | Toutes les heures | Rendez-vous non confirmé 48 h, rencontre non finalisée 7 j, paiement en attente 1 h |
| Expiration de swaps | Toutes les heures | Échange expiré (proposé sans suite, ou accepté sans progression) |
| Libération des fonds | Toutes les heures | Fonds libérés 7 jours après livraison |
| Suivi de colis | Planifiée | Livré, échec de livraison, relance « étiquette créée mais colis non déposé » |
| Purge de rétention | Quotidienne | *(pas d'envoi)* supprime les notifications de plus de 180 jours |

**Nettoyage automatique des appareils morts :** quand un envoi échoue parce que le jeton est invalide ou expiré (app désinstallée, etc.), ce jeton est retiré automatiquement du compte. Les jetons iOS sont au contraire préservés — écartés à l'envoi, jamais supprimés — pour ne pas casser la future activation du push iOS.

**Qualité de rédaction à reprendre :** une partie des messages serveur est écrite **sans accents** (« Votre offre a ete acceptee ! », « Colis livre ! », « Preparez l'envoi », « Probleme de livraison », « Pensez a expedier votre colis », « Litige resolu »). C'est visible par l'utilisateur final et incohérent avec le reste de l'app.

---

### 15.10. Données clés (en langage métier)

- **fcmTokens** (sur le profil) : la liste des appareils enregistrés pour recevoir les push. Un utilisateur peut en avoir plusieurs ; chacun reçoit l'alerte. À la **déconnexion**, le jeton de l'appareil courant est retiré et le compteur in-app remis à zéro — l'appareil ne reçoit plus rien après déconnexion.
- **notifications** (collection) : l'historique in-app. Chaque entrée porte le destinataire, le type, le titre, le message, les données de routage (dont le lien de destination), un indicateur lu/non-lu et une date de création. Purge à 180 jours.
- **preferences.notifications** (sur le profil) : les interrupteurs. **N'existe que si l'utilisateur a agi** (voir 15.6).
- **Compteur de non-lus** : recalculé côté serveur à l'ouverture de session, à la réception d'une notification, à chaque retour de l'app au premier plan, et après chaque lecture / suppression / « tout lire ».
- **Incohérence de badge à connaître :** le badge affiché **par le système d'exploitation** est calculé différemment selon la source. Le serveur y met « notifications non lues **+ messages de chat non lus** » ; l'app, elle, le réaligne ensuite sur les seules notifications non lues. Le chiffre du badge système peut donc changer entre l'arrivée d'un push et l'ouverture de l'app. Le badge de la cloche dans l'app, lui, est toujours cohérent (notifications non lues uniquement). Par ailleurs, la déconnexion ne remet pas à zéro le badge système.

---

### 15.11. Spécificités Canada

- **Devise** : tous les montants dans les notifications (offres, ventes, baisses de prix) sont en **dollars canadiens**, affichés avec le symbole « $ » (ex. « 45 $ », « -25% »).
- **Loi 25 (protection des renseignements personnels)** : le type **« Incident de confidentialité »** est un canal de conformité — il permet d'informer formellement et uniquement les utilisateurs réellement concernés. La **purge à 180 jours** des notifications relève de la même logique de minimisation. Le **retrait du consentement marketing** est journalisé de façon inaltérable et coupe immédiatement, côté serveur, les notifications marketing (baisses de prix, articles favoris, rappel Swap Zone).
- **Réserve sur l'opt-in** : la politique « vie privée par défaut » est correctement affichée mais **pas appliquée tant que l'utilisateur n'a rien touché** (voir 15.6). À traiter avant toute revendication de conformité stricte sur ce point.
- **Infrastructure régionale** : toutes les fonctions serveur qui déclenchent les notifications sont hébergées dans la région canadienne (`northamerica-northeast1`).

---

### 15.12. Limites connues à retenir (synthèse)

1. **Push iOS non actif.** Les iPhone ne reçoivent aucune alerte hors app. Étape native requise et identifiée.
2. **Swap = push seulement.** Aucune trace dans le centre de notifications, sur aucune plateforme. Un utilisateur iOS ne voit donc rien du cycle d'échange ; un Android qui balaie l'alerte la perd définitivement.
3. **Recherches sauvegardées = push seulement**, vérifiées par lots toutes les 15 minutes (alerte non instantanée), et sautées pour tout compte sans appareil joignable — donc invisibles sur iPhone.
4. **Couper un type précis efface aussi l'historique** de ce type : la notification n'est pas créée du tout, elle n'est pas seulement « silencieuse ».
5. **Opt-in par défaut non appliqué côté serveur** tant que l'utilisateur n'a pas agi sur ses réglages ou son consentement marketing.
6. **Rail commande / paiement / livraison fermé** (`SHIPPING_ENABLED` et `PAYMENTS_ENABLED` à `false`) : vente, expédition, livraison, remboursement et libération de fonds sont câblés mais ne peuvent pas se produire aujourd'hui.
7. **Notification d'expédition absente** même une fois le rail ouvert : le type existe, rien ne l'émet. L'acheteur n'apprend l'avancement qu'à la livraison.
8. **Rencontre en main propre peu instrumentée** : pas de notification à la proposition, à la confirmation ni à la finalisation ; et lors d'une expiration à 48 h, seul l'acheteur est prévenu — pas le vendeur.
9. **Aucune notification aux administrateurs** pour une boutique en attente de modération.
10. **Une offre qui expire ne prévient personne.**
11. **Quatre types de notification ne sont pas reconnus par l'app** (retour demandé, échec de livraison, relance d'étiquette, conformité Stripe) : icône générique et destination approximative, voire inexistante pour la conformité Stripe.
12. **Bannière non supprimée dans la conversation ouverte** : le mécanisme prévu n'est branché sur aucun écran.
13. **Badge système à deux calculs concurrents** (serveur : notifications + messages ; app : notifications seules), et non remis à zéro à la déconnexion.
14. **Centre de notifications non paginé** : tout est chargé d'un coup, borné seulement par la purge à 180 jours.
15. **Interrupteur email sans effet** : aucun envoi email n'existe.
16. **Qualité de copie** : plusieurs messages serveur sont sans accents, et le titre des alertes de recherche sauvegardée est fautif au pluriel.
