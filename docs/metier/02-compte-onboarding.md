## 02. Compte, inscription & onboarding

Cette section décrit comment un nouvel utilisateur découvre Second, exprime ses préférences, crée un compte et obtient une identité dans l'application. Elle couvre les trois moyens de s'identifier (email/mot de passe, Google, Apple), le consentement légal exigé par la Loi 25 (Québec), le contrôle d'âge, l'onboarding des préférences de mode, le choix de l'identifiant public (@pseudo), la distinction entre invité et membre, et ce qui est repris des données d'invité au moment de l'inscription.

Le principe directeur, visible partout dans le code : **on peut tout regarder sans compte, mais agir exige un compte, et un compte n'est utilisable qu'une fois l'âge et les consentements enregistrés côté serveur.**

> **Changement majeur par rapport aux versions précédentes de ce document** : le consentement légal n'est plus une étape de la fenêtre coulissante d'authentification. C'est désormais un **écran plein écran obligatoire** (« Avant de continuer ») qui suit la création du compte, et sur lequel l'utilisateur **choisit lui-même son @pseudo**. Le compte est donc créé *avant* le contrôle d'âge, pas après.

---

### 2.1 Vue d'ensemble du parcours d'entrée

Au tout premier lancement, l'application n'affiche pas un mur de connexion. Elle ouvre directement un **onboarding de préférences** (écran « Bienvenue sur Seconde »), puis dépose l'utilisateur dans l'app en tant qu'**invité**. La création de compte n'intervient que plus tard, au moment où l'invité tente une action réservée aux membres (mettre en favori, acheter, vendre, contacter un vendeur, sauvegarder une recherche, entrer dans la Swap Zone…).

Concrètement, à l'ouverture (`app/index.tsx`) :
1. L'app lit un indicateur local « onboarding déjà fait » (`ONBOARDING_COMPLETED_KEY`).
2. Si l'onboarding n'a jamais été complété, l'utilisateur est redirigé vers l'écran d'onboarding des préférences.
3. Sinon, il entre directement dans l'app (les onglets principaux).

Cet indicateur est **purement local à l'appareil** : il ne dépend pas du compte. Conséquences réelles : un membre qui réinstalle l'app repasse par l'onboarding des préférences ; et un utilisateur qui crée son compte avant d'avoir fait l'onboarding le verra **après** son inscription (ses préférences partent alors directement sur son compte).

Il y a donc trois surfaces distinctes, à ne pas confondre :

| Surface | Quand | Obligatoire ? |
|---|---|---|
| Onboarding des préférences (`app/onboarding.tsx`) | 1er lancement de l'app sur l'appareil | Non — bouton « Passer » |
| Fenêtre d'authentification (bottom sheet) | À la 1re action réservée, depuis n'importe quel écran | Non — fermable |
| Écran « Avant de continuer » (`app/complete-profile.tsx`) | Juste après la création / la 1re connexion sociale d'un compte | **Oui — bloquant, sans sortie** |

---

### 2.2 Onboarding des préférences (avant le compte)

**Écran** : un seul écran, en deux temps.

**Temps 1 — Accueil.** Titre « BIENVENUE SUR / Seconde », phrase « Dis-nous en un peu plus sur toi pour personnaliser ton expérience. », et deux choix :
- **CONTINUER** → passe au formulaire.
- **Passer** → marque l'onboarding comme terminé et entre dans l'app sans rien collecter.

**Temps 2 — Formulaire de préférences** (titre « Parle-nous de toi »). L'utilisateur peut renseigner :

| Champ | Métier | Valeurs |
|---|---|---|
| Je cherche pour | Cible de navigation | Femme, Homme, Les deux, Enfant |
| Système de taille | Référentiel d'affichage des grilles | US (par défaut) ou EU |
| Taille du haut | Multi-sélection | Adulte : XXS → 3XL · Enfant US : 2T, 3T, 4T, 5, 6, 6X, 7, 8, 10, 12, 14, 16 · Enfant EU : « 2 ans » → « 16 ans » |
| Taille du bas | Multi-sélection | Adulte US : 24 → 40 (jeans, en pouces) · Adulte EU : 32 → 52 · Enfant : mêmes grilles que le haut |
| Pointure | Multi-sélection | Adulte US : 5 → 13 (demi-pointures) · Adulte EU : 35 → 46 · Enfant US : 5C → 7Y · Enfant EU : 20 → 35 |

Grilles définies dans `features/onboarding/constants/sizes.ts`.

**Règles de gestion notables :**
- **Multi-sélection partout** sur les tailles : un utilisateur peut posséder plusieurs tailles (ex. S et M).
- Le choix « Je cherche pour » est un **bouton bascule** : re-toucher l'option sélectionnée la désélectionne.
- **Choisir « Enfant »** (ou le quitter) bascule vers les grilles correspondantes et **vide les sélections** précédentes (grilles adulte et enfant non compatibles).
- **Changer de système (US ↔ EU)** réinitialise les tailles déjà choisies, avec une **demande de confirmation** si des tailles avaient été sélectionnées (« Vos sélections de tailles seront réinitialisées. Continuer ? »).
- **Le bouton VALIDER exige une cible ET au moins une taille.** Il ne suffit pas d'avoir « saisi quelque chose » : sans choix « Je cherche pour », le bouton reste désactivé (le serveur refuse un enregistrement sans ce champ). **Passer** reste disponible à tout moment, y compris sur le formulaire.
- Les grilles sont calibrées pour le **marché canadien** : système US par défaut, jeans en pouces, pointures US ; l'EU reste disponible.
- Sur Android, le bouton retour matériel ramène de l'écran formulaire à l'écran d'accueil sans perdre les sélections.

**Ce que produisent ces préférences (métier) :** elles alimentent le rail personnalisé **« Pour toi »** de l'accueil. Elles sont enregistrées :
1. **En local sur l'appareil**, systématiquement (clé `@onboarding_preferences`).
2. **Sur la fiche du membre**, via la fonction serveur `saveOnboardingPreferences` — qui écrit la cible (`sex`), les tailles haut + bas **fusionnées en une seule liste**, les pointures à part, et lève le drapeau `onboardingCompleted`. Le serveur nettoie les valeurs vides et **plafonne à 20 tailles par catégorie**, et n'accepte que 4 cibles (`femme`, `homme`, `les-deux`, `enfant`).

**Deux comportements différents selon l'état de connexion** (`app/onboarding.tsx`) :
- **Membre connecté** : l'enregistrement est **attendu**, et s'il échoue une alerte « Échec de l'enregistrement — Réessayer ? » est proposée en boucle. Ce n'est donc pas silencieux.
- **Invité** : l'appel est envoyé sans attendre, **et le serveur ne persiste rien** — il répond simplement « ok, invité » (`functions/src/callable/onboarding.ts`). Il n'existe **aucune collection de préférences invité** côté serveur. Les préférences vivent uniquement sur l'appareil jusqu'à la première connexion, où elles sont rejouées sur le compte.

> **Trous produit constatés (non couverts par le code aujourd'hui) :**
> - **Le rail « Pour toi » n'existe pas pour un invité.** La personnalisation est calculée à partir de la fiche utilisateur (profil de style ou préférences enregistrées) ; sans compte, la section ne s'affiche pas du tout (`features/home/pour-toi/usePersonalizedFeed.ts`). Un invité qui remplit consciencieusement l'onboarding ne voit donc aucun effet immédiat — l'effet n'arrive qu'après son inscription.
> - **Le système de taille choisi (US ou EU) n'est enregistré nulle part** : ni en local, ni sur la fiche. Il ne sert qu'à afficher la bonne grille pendant l'écran. Les tailles sont ensuite stockées comme de simples valeurs sans référentiel.
> - **Les tailles haut et bas sont fusionnées** en une seule liste sur la fiche : on ne peut plus distinguer « M en haut » de « 30 en bas » après coup.

---

### 2.3 Invité vs membre : les trois états réels

Le code distingue **trois** états, et non deux.

**1. Invité (aucun compte).**
- Peut naviguer, rechercher, consulter les articles, ouvrir les fiches vendeur.
- Possède une **session invité** anonyme (identifiant aléatoire créé au premier lancement, stocké sur l'appareil) qui enregistre les articles vus, les recherches et les coups de cœur pour améliorer les recommandations.
- **Ne peut pas** réaliser les actions réservées : mettre en favori, acheter, vendre, contacter un vendeur, suivre un vendeur, sauvegarder une recherche, participer à la Swap Zone. Chaque tentative ouvre la fenêtre d'authentification avec un message contextuel adapté (« Créez un compte pour sauvegarder vos coups de cœur », « Inscrivez-vous pour contacter le vendeur », etc. — `constants/authMessages.ts`).

**2. Compte créé mais pas encore consenti (état intermédiaire).**
- Le compte existe côté Firebase, mais aucune date de naissance ni consentement n'a encore été enregistré.
- L'app le traite comme **non connecté** : aucune capacité de membre n'est débloquée, rien n'est mis en cache hors ligne.
- Un garde-fou de démarrage le renvoie **systématiquement** sur l'écran « Avant de continuer », y compris s'il a tué l'application et l'a relancée plus tard.

**3. Membre connecté.**
- Dispose d'une fiche utilisateur, d'un @pseudo public, peut acheter et discuter, et — s'il a 18 ans ou plus **et** un email vérifié — vendre.

**Le « mur » d'authentification.** Lorsqu'un invité déclenche une action réservée, l'app passe par un mécanisme central (`hooks/useAuthRequired.ts`) qui :
- exécute l'action immédiatement s'il est déjà connecté ;
- sinon **ouvre la fenêtre d'authentification** avec un message contextuel et **rejoue automatiquement l'action** une fois la connexion (et, le cas échéant, le consentement) terminée.

Cette fenêtre est unique et globale : montée une seule fois à la racine de l'app et pilotée par un store dédié, elle peut être déclenchée depuis n'importe où.

---

### 2.4 La fenêtre d'authentification (bottom sheet)

C'est l'unique surface de connexion / création de compte. Elle a **trois modes** (`features/auth/components/AuthBottomSheet.tsx`) :

1. **Se connecter** (par défaut) — email + mot de passe, plus boutons sociaux. Titre « Content de / te revoir ».
2. **S'inscrire** — nom d'affichage + email + mot de passe, plus boutons sociaux. Titre « Bienvenue sur / Seconde ».
3. **Mot de passe oublié** — saisie de l'email, envoi d'un lien de réinitialisation.

Sur les modes 1 et 2, l'ordre à l'écran est : titre, message contextuel du mur, **boutons sociaux**, séparateur « ou », onglets « Se connecter / S'inscrire », puis les champs. Le mode « mot de passe oublié » remplace tout le contenu et **ne propose pas les options sociales**.

**Spécificité iOS vs Android — Apple :** le bouton **« Continuer avec Apple »** n'est affiché que sur **iOS**, et seulement si l'appareil confirme la disponibilité d'Apple Sign-In (il reste donc masqué sur un iPhone trop ancien ou un simulateur sans compte Apple). Sur Android, seules Google et l'email sont proposées. Google et email sont disponibles sur les deux plateformes.

**Note UX :** les erreurs de cette fenêtre (identifiants invalides, email déjà utilisé, annulation d'une connexion sociale…) sont affichées dans des **alertes système**, pas en messages sous les champs. Seules les erreurs de format des champs (email, mot de passe, nom) s'affichent en ligne.

---

### 2.5 Inscription par email + mot de passe

**Champs de la fenêtre :**
- **Nom d'affichage** (`Nom d'affichage`) — c'est le **nom public modifiable**, pas le @pseudo. Aide affichée : « Votre nom public. Vous pourrez le changer plus tard. »
- **Email** : doit contenir « @ » et « . » (message « Adresse email invalide » sinon).
- **Mot de passe** : message « 6 caractères minimum » sinon.

**Le bouton « S'INSCRIRE » est débloqué dès que les trois champs sont non vides.** Ni l'âge ni les consentements n'interviennent ici : ils sont collectés à l'écran suivant.

> **Trou produit :** le message « 3 caractères minimum » sous le nom d'affichage est **indicatif seulement** — il ne bloque pas la validation. Un nom d'un seul caractère passe. Seule la règle des 6 caractères du mot de passe est réellement imposée, et par Firebase au moment de la création.

**Ce qui se passe à la validation (`services/authService.ts`) :**
1. Création du compte d'authentification (email + mot de passe) et enregistrement du nom d'affichage.
2. Création de la fiche utilisateur **« nue »** : email, nom d'affichage, date de création, `authProvider: 'email'`, compte actif. **Sans date de naissance, sans consentement, sans @pseudo.**
3. Envoi d'un **email de vérification** (non bloquant — voir 2.9).
4. Fermeture de la fenêtre et **redirection immédiate vers l'écran obligatoire « Avant de continuer »** (section 2.6). L'utilisateur n'entre pas dans l'app.

**Garantie technique conservée.** Si la création de la fiche échoue après la création du compte d'authentification, l'app supprime la fiche puis le compte pour ne pas laisser de compte orphelin (message « La création du compte a échoué. Veuillez réessayer. »). En revanche, un compte **sans consentement est désormais un état intermédiaire assumé** : il n'est pas supprimé, il est bloqué (voir 2.6).

Les erreurs d'authentification (email déjà utilisé, mot de passe trop faible, réseau, trop de tentatives…) sont traduites en français lisible.

---

### 2.6 L'écran obligatoire « Avant de continuer » (@pseudo + âge + consentements)

**Écran plein écran** (`app/complete-profile.tsx`), atteint par **les deux parcours** : inscription email **et** connexion Google/Apple d'un compte pas encore consenti. Titre « Avant de continuer », message « Choisissez votre pseudo, indiquez votre date de naissance et acceptez nos conditions. »

Il collecte, dans cet ordre :
1. **Le @pseudo**, choisi par l'utilisateur.
2. **La date de naissance** (JJ / MM / AAAA, saisie numérique avec passage automatique d'un champ à l'autre).
3. **Les consentements** : deux cases obligatoires (Conditions d'utilisation, Politique de confidentialité) + une case facultative (marketing).
4. Le bouton **CONTINUER**.

**Le @pseudo est choisi, pas dérivé.** C'est le changement le plus important par rapport à la version précédente de ce document.

| Règle | Détail |
|---|---|
| Format | 3 à 20 caractères, minuscules, chiffres et `.` `_` `-` uniquement ; pas de séparateur en début, en fin, ni doublé |
| Vérification en direct | À chaque frappe (avec un léger délai), l'app interroge le serveur et affiche une coche verte si le pseudo est libre, ou « Ce pseudo est déjà pris. » |
| Unicité | Garantie par un registre central des pseudos, réservé **au moment de la validation**, de façon atomique |
| Pseudo déjà pris à la validation | **Refus** avec message sous le champ ; **aucune suppression de compte** — l'utilisateur en choisit un autre et re-valide |
| Pas de suffixe automatique | Contrairement à l'ancien mécanisme, le serveur n'ajoute plus `.2`, `.3`… : c'est un choix, pas une attribution |
| Immuabilité | Annoncée à l'écran (« C'est l'identifiant unique avec lequel on vous retrouvera. Il ne pourra plus être modifié. ») et appliquée côté serveur : une fois la date de naissance enregistrée, le pseudo ne peut plus changer |

**Le bouton CONTINUER n'est actif que si** : le pseudo est confirmé libre et bien formé, **et** l'âge calculé est ≥ 16 ans, **et** les deux cases obligatoires sont cochées. L'opt-in marketing ne compte jamais.

**À la validation, une seule opération serveur fait tout en une fois, de façon atomique** (`recordSignupConsent`) : elle revalide le format du pseudo, le réserve, revalide l'âge, écrit la date de naissance sur la fiche et crée les preuves de consentement. Si quoi que ce soit échoue, rien n'est écrit. Ce n'est qu'après ce succès que l'utilisateur est réellement connecté, que ses données d'invité sont reprises, et que l'action qu'il tentait au départ (acheter, mettre en favori…) est rejouée.

**L'écran est verrouillé** : pas de retour arrière (geste iOS désactivé, bouton retour Android neutralisé), pas de bouton « Annuler », pas de bouton « Se déconnecter ». Seuls les liens vers les Conditions et la Politique de confidentialité restent accessibles (exigence Loi 25). Si l'utilisateur tue l'application, le garde-fou de démarrage le ramène sur cet écran au prochain lancement.

> **Trou produit majeur — l'écran est une impasse.** Un utilisateur qui change d'avis à ce stade, ou qui **a moins de 16 ans**, ne dispose d'**aucune sortie** : son compte existe déjà (email ou social), il ne peut ni revenir en arrière, ni se déconnecter, ni utiliser l'app. Réinstaller l'application ne suffit pas si la session est restaurée. Deux conséquences directes :
> - un mineur de moins de 16 ans se retrouve avec un compte créé qui ne sera jamais supprimé, alors que le principe affiché est « aucun compte sans consentement » ;
> - un utilisateur simplement hésitant est bloqué hors de l'app, sans moyen de repasser en mode invité.
>
> Le code de repli qui supprimait les comptes non consentis existe toujours (`AuthService.rollbackUnconsentedAccount`) mais **plus aucun écran ne l'appelle** : c'est du code dormant. La règle « rollback différencié à l'abandon » décrite dans les versions précédentes de ce document **n'est plus la réalité**.

**Filet de sécurité historique.** Pour les comptes créés **avant** la mise en place du pseudo choisi, une attribution automatique subsiste : à la connexion, si la fiche n'a pas de pseudo, l'app en déclenche une discrètement, dérivée du nom d'affichage (accents translittérés, minuscules, espaces → points), avec suffixe numérique en cas de collision et repli `user.xxxxxx` si le nom ne donne rien d'exploitable. Ce mécanisme ne concerne **pas** les nouvelles inscriptions.

---

### 2.7 Connexion sociale (Google / Apple)

**Google** (iOS + Android) et **Apple** (iOS uniquement). Le déroulé :
1. L'utilisateur s'authentifie auprès du fournisseur, puis l'app crée la session Firebase correspondante.
2. **Si le compte est nouveau** : création de la fiche utilisateur (`authProvider: 'google'` ou `'apple'`) avec le nom récupéré du fournisseur. Si ce nom est vide ou générique (« utilisateur », « user »), un nom de repli est fabriqué. **Aucun @pseudo n'est attribué à ce stade.**
   - Particularité **Apple** : Apple ne transmet le nom complet **qu'à la première autorisation**. Le code le capte à ce moment-là et le conserve comme nom d'affichage.
   - Si le compte existait déjà avec un nom générique, le nom du fournisseur vient le remplacer.
3. **Étape de consentement obligatoire** : une connexion sociale **ne contourne jamais** le contrôle d'âge ni le consentement. Tant que la date de naissance n'est pas enregistrée côté serveur, le compte est « pas encore consenti ».

**Quand l'écran « Avant de continuer » s'affiche-t-il ?** Dans deux cas :
- compte **fraîchement créé** par la connexion sociale ; **ou**
- compte **déjà existant mais sans date de naissance enregistrée**.

Dans les deux cas, l'utilisateur est redirigé vers le même écran plein écran que l'inscription email, avec les mêmes règles et **la même impasse** décrite en 2.6 : fermer, balayer ou abandonner n'est pas possible, et rien n'est supprimé.

**Garde-fou de dernier recours.** Même si une session valide existe, l'écouteur d'authentification global refuse de débloquer les capacités de membre tant que la date de naissance n'est pas enregistrée : le compte reste traité comme non connecté, une session invité est maintenue, et aucune donnée n'est mise en cache hors ligne.

**Cas non géré :** si un compte social existe déjà chez Firebase avec la même adresse email via une autre méthode, la connexion échoue avec un message invitant à se connecter par email + mot de passe. Il n'existe pas de fusion automatique des méthodes de connexion.

---

### 2.8 Consentement Loi 25 & contrôle d'âge

**Le bloc de consentement** (`features/auth/components/ConsentFields.tsx`, utilisé par l'écran « Avant de continuer ») comporte :
- la **date de naissance** (contrôle d'âge) ;
- **case obligatoire** : « J'ai lu et j'accepte les Conditions d'utilisation. » (lien vers les CGU) ;
- **case obligatoire** : « J'ai lu et j'accepte la Politique de confidentialité. » (lien vers la politique) ;
- **case facultative** : opt-in marketing (« J'accepte de recevoir des offres, baisses de prix et nouveautés (vous pouvez vous désabonner à tout moment). »).

**Règles d'âge (transverses) :**

| Seuil | Capacité | Où c'est appliqué |
|---|---|---|
| **16 ans** | S'inscrire, naviguer, **acheter** | Bloque le bouton CONTINUER de l'écran obligatoire, et revalidé côté serveur |
| **18 ans** | **Vendre** | Onglet « Vendre » et écran d'activation vendeur : message dédié si 16-17 ans |

Pour les 16-17 ans, le message affiché est explicite : « La vente d'articles est réservée aux personnes de 18 ans et plus, car notre partenaire de paiement Stripe exige cet âge pour ouvrir un compte de versement. Vous pouvez continuer à acheter et naviguer sur Second. »

**Calcul d'âge — détails métier importants :**
- La date de naissance est stockée comme **chaîne calendaire `AAAA-MM-JJ`** (sans heure ni fuseau) pour éviter toute dérive de fuseau horaire.
- Le client valide d'abord (confort d'usage), mais **le serveur revalide systématiquement** l'âge et refuse les dates impossibles (ex. 30 février) ou hors plage. C'est le serveur qui fait foi.
- Spécificité **Canada** : le serveur calcule le « jour courant » dans le fuseau **America/Toronto**, pour s'aligner sur l'heure locale des utilisateurs canadiens plutôt qu'en UTC.

**Preuve de consentement (côté serveur, source de vérité) — `functions/src/callable/consent.ts` :**
- À l'enregistrement, le serveur écrit la date de naissance sur la fiche utilisateur **et** crée des **documents de consentement** horodatés : toujours « Conditions » et « Confidentialité », plus « Marketing » uniquement si l'utilisateur a opté.
- Chaque preuve porte la **version de politique** acceptée (`2026-05-31`) et le canal (`app`).
- Ces documents sont **append-only** et écrits **exclusivement côté serveur** : les règles Firestore interdisent au client toute création, modification ou suppression (le propriétaire peut seulement les lire). Le @pseudo et la date de naissance sont eux aussi dans le jeu de champs protégés, non modifiables par le client.

**Retrait du consentement marketing (Loi 25 art. 14 / LCAP).** Une opération serveur dédiée (`setMarketingConsent`) journalise un **nouveau** document de preuve (sans jamais altérer les anciens) **et** applique l'effet en coupant les préférences de notifications marketing (baisses de prix, mises en favori, rappels Swap Zone) — celles-là mêmes que les envois automatiques relisent avant d'expédier quoi que ce soit. Cette gestion vit dans les paramètres du compte, mais s'appuie sur le même registre de consentements.

**À noter :** le profilage par IA (génération d'un profil de style à partir du comportement) est soumis à un **opt-in distinct, désactivé par défaut**. Sans ce consentement explicite, aucune donnée comportementale n'est envoyée au moteur de recommandation IA.

---

### 2.9 Connexion, email vérifié, mot de passe oublié, reprise des données d'invité

**Connexion (membre existant).** Email + mot de passe ; à la réussite, l'app récupère la fiche utilisateur et entre dans l'app — **sauf** si la fiche n'a pas de date de naissance, auquel cas le compte repasse par l'écran obligatoire (2.6). Les options sociales sont aussi disponibles depuis l'écran de connexion.

**Vérification de l'email.** Un email de vérification est envoyé automatiquement à l'inscription par email. Il n'est **pas** exigé pour naviguer, acheter ou discuter — mais il l'est pour **publier un article** : le contrôle est appliqué côté serveur, et l'app pré-vérifie à l'entrée de l'onglet « Vendre » pour rediriger vers l'écran « Vérifier mon email » plutôt que de laisser remplir tout le formulaire pour rien. Les comptes Google/Apple sont toujours considérés comme vérifiés.

**Mot de passe oublié.** Saisie de l'email → envoi d'un **lien de réinitialisation** par Firebase. Un message confirme l'envoi.

**Reprise des données d'invité → membre.** À **chaque** connexion ou complétion de consentement réussie (email, Google, Apple), l'app reprend ce qu'elle peut de la session invité, puis **efface la session invité** — même si la reprise a échoué, pour ne pas continuer à attribuer les événements futurs à l'entité « invité ». Concrètement (`services/authMergeService.ts`) :

| Donnée d'invité | Reprise sur le compte ? |
|---|---|
| Préférences d'onboarding (cible, tailles, pointures) | **Oui** — rejouées sur la fiche via la même fonction serveur |
| Favoris posés en local | **Oui** — fusionnés avec les favoris du compte à la première lecture, puis le local est vidé |
| Articles vus, recherches, coups de cœur (comportement) | **Seulement** pour générer un profil de style IA, et uniquement si l'opt-in de profilage IA est accordé (désactivé par défaut) et s'il y a au moins 5 interactions. Sinon, ces données sont **perdues** |

> **Nuance à connaître :** dans l'app telle qu'elle est aujourd'hui, **un invité ne peut pas mettre en favori** — chaque bouton cœur passe par le mur d'authentification. Le mécanisme de favoris locaux et de fusion existe donc dans le code mais n'est, en pratique, jamais alimenté. Le suivi comportemental de l'invité se limite réellement aux **articles consultés**.

**Ajouter un mot de passe à un compte social** (`app/settings/add-password.tsx`). Un membre arrivé par Google/Apple peut ajouter un email + mot de passe à son compte. Après l'opération, il peut se connecter **au choix** par le social **ou** par email/mot de passe. Côté données, la méthode d'origine reste la référence ; on ajoute simplement « email » à la liste des méthodes liées et on marque le compte comme disposant d'un mot de passe.

> Conséquence concrète sur iOS/Android : un membre Apple (donc créé sur iOS) qui veut se reconnecter **sur Android** doit avoir, au préalable, lié un mot de passe à son compte — sinon il ne dispose d'aucun moyen de connexion disponible sur Android. De même, la ré-authentification Apple exigée pour les actions sensibles (changer d'email, supprimer le compte, ajouter un mot de passe) **n'est possible que sur iOS** ; un message invite alors à ajouter un mot de passe depuis un appareil iOS.

**Détection d'un compte révoqué.** Au retour de l'app en premier plan, la session est revalidée : si le compte a été supprimé, désactivé ou son jeton révoqué côté serveur, l'utilisateur est déconnecté proprement au lieu de rester avec une session fantôme.

---

### 2.10 Données clés produites (résumé métier)

| Donnée | Quand | Rôle |
|---|---|---|
| Préférences d'onboarding (cible, tailles haut+bas fusionnées, pointures) | Au 1er lancement, ou après inscription si l'onboarding n'avait pas été fait | Personnalisation du rail « Pour toi » (membres uniquement) |
| Session invité (identifiant local, articles vus) | Au 1er lancement | Suivi anonyme sur l'appareil ; effacée à la 1re connexion |
| Fiche utilisateur « nue » (email, nom d'affichage, méthode de connexion, date de création, actif) | À la création du compte | Identité technique — **pas encore un membre utilisable** |
| Date de naissance (`AAAA-MM-JJ`) | À l'écran « Avant de continuer » | Contrôle d'âge (16 / 18) **et** preuve que le compte a consenti |
| @pseudo choisi (unique, immuable) | À l'écran « Avant de continuer », tous parcours | Identité publique stable (boutique, avis, conversations) |
| Documents de consentement (conditions, confidentialité, marketing) | À l'écran « Avant de continuer », et à chaque changement d'avis marketing | Preuve légale append-only, versionnée, écrite côté serveur uniquement |
| Email vérifié | Lien envoyé à l'inscription email | Condition pour publier un article |

---

### 2.11 Spécificités Canada & contraintes plateforme (récapitulatif)

- **Loi 25 (Québec)** : consentement explicite obligatoire (Conditions + Confidentialité), preuve horodatée et versionnée côté serveur, inaccessible en écriture au client ; retrait marketing journalisé **et** effectif ; opt-in séparé pour le profilage IA, désactivé par défaut.
- **Âge** : 16 ans pour s'inscrire/acheter, 18 ans pour vendre ; calcul serveur aligné sur le fuseau **America/Toronto**.
- **Tailles** : grilles calibrées marché canadien (système **US par défaut**, jeans en pouces, pointures US ; alternative EU disponible mais non mémorisée).
- **iOS uniquement** : bouton et ré-authentification **Apple** — et seulement si l'appareil déclare Apple Sign-In disponible. Sur **Android**, l'authentification passe par Google ou email/mot de passe.
- **Google** : disponible sur les deux plateformes (identifiants clients distincts iOS / Android).

**Écarts assumés ou à trancher, en une liste :**
1. L'écran obligatoire « Avant de continuer » **n'a aucune sortie** — ni annulation, ni déconnexion. Un moins-de-16-ans ou un hésitant reste bloqué avec un compte créé.
2. La suppression automatique d'un compte non consenti **n'est plus branchée** (code dormant), alors que la promesse « aucun compte sans consentement » reste affichée dans la documentation légale.
3. Les préférences d'un **invité** ne servent à rien tant qu'il ne crée pas de compte (rail « Pour toi » réservé aux membres).
4. Le **système de taille US/EU n'est jamais mémorisé**, et haut/bas sont fusionnés sur la fiche.
5. La règle « 3 caractères minimum » du **nom d'affichage** est affichée mais non appliquée.
