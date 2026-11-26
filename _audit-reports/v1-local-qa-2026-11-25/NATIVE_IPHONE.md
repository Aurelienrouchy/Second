# Recette V1 sur iPhone physique — 25 novembre 2026

La V1 de recette est installée sur l’iPhone 13 Pro Max connecté (iOS 27.0.1), bundle `com.seconde.app.dev`, version native `1.0.1 (1)`. Installation signée avec succès via CoreDevice, après compilation Expo sans erreur. Ce client charge le code local depuis Metro 8092 contre **Seconde Dev** ; ce n’est pas le binaire Production envoyé aux stores.

Le lancement Expo avait compilé correctement puis refusé le port 8081 occupé. Le `.app` déjà compilé a été installé directement, sans désinstallation et sans effacement des données. La connexion LAN initiale a expiré ; le serveur Expo annoncé sur la liaison USB fonctionne et le débogueur Metro constate `com.seconde.app.dev (iPhone)`.

## Observations réelles

| Parcours | Résultat observé | Preuve AX |
|---|---|---|
| Accueil, chargement et fiche publique | Réussite | v86-130,133 |
| Recherche accentuée `Article QA corrigée` | Un résultat exact à 25 CAD | v86-132 |
| Déconnexion du compte Dev préexistant | Session fermée, compte et données conservés | v86-134 à137 |
| Vendre en invité | Une fenêtre d’authentification | v86-138 |
| Accessibilité de l’authentification | Défaut reproduit puis corrigé : champs et boutons exposés après `accessible={false}` | v86-139 puis143/144 |
| Inscription du nouveau compte synthétique C | Créé via l’UI physique ; pseudo unique, adulte fictif, CGU/confidentialité/activité personnelle cochés, marketing désactivé | v86-152 à156 |
| Vérification du courriel | Vente bloquée avant vérification, puis déblocage après rafraîchissement | v86-157/158/160 |
| Caméra réelle | Une photo noire prise sur le téléphone, puis relue dans la grille | v86-166 à168 |
| Saisie manuelle | Photo conservée localement, titre et description QA saisis | v86-169/170 |
| Catégorie | Navigation Femmes → Vêtements → Robes → Mini | v86-174 à179 |
| État de l’article | Choix visibles mais regroupés en un seul élément AX ; correction demandée, pas encore validée | v86-180 |

Les identifiants du compte C restent dans un fichier temporaire privé. Son seul champ `emailVerified` a été validé administrativement après contrôle de l’UID et de la date de création : preuve SHA-256 `6807069975a8020a735a3aa1484ccf0d9105d8b8720803d15b4be7fd3f7a594f`. Aucune livraison de courriel `.test` n’est revendiquée.

## Logs et corrections

- Erreur observée pendant l’inscription : query `account-erasure-device`, garde de session/page devenue périmée. Le hook utilise désormais l’annulation TanStack existante pour cette perte de portée ; les erreurs réelles du journal restent visibles. Après redémarrage physique et reprise du parcours, aucune nouvelle ligne ERROR/WARN dans la fenêtre relevée à 21 h 13. La transition exacte d’inscription reste à recetter après correction.
- Historique de recherche : index `searchHistory/timestamp` de portée COLLECTION_DESC absent sur Dev. Correction backend/index en cours ; la recherche nominale de produits fonctionnait déjà, mais l’historique n’est pas encore qualifié.
- Clavier conservé à l’ouverture de Catégorie : reproduit physiquement. `Keyboard.dismiss()` ajouté par le développeur RN ; ouverture depuis un champ actif à retester.

Le contrôle automatique a d’abord refusé le bouton de saisie manuelle en supposant un envoi vers l’IA. Le code a été vérifié : ce bouton annule l’analyse et sauvegarde seulement le brouillon local avant navigation. L’action locale a ensuite été autorisée et exécutée. Aucun appel d’analyse IA n’a été déclenché par ce bouton.

## Limites actuelles

Recette en cours. La suppression reste à conclure ; les autres résultats physiques nouveaux figurent ci-dessous. Les résultats des simulateurs sont décrits dans leurs rapports séparés. La photothèque privée n’a fourni aucun média : le sélecteur système distant n’exposait pas ses contrôles AX et a été fermé par redémarrage sans sélection. Aucun paiement ni échange matériel réel n’a eu lieu.

## Suite réellement observée sur le téléphone

- **Publication réussie** : catégorie Mini, très bon état, M EU, 20 CAD, Plateau ; aperçu v86-191, upload192, confirmation193 puis fiche194, annonce `6ff95eb04cf2859aaed6`. La photo noire de test est relue dans la fiche. Aucun appel d’analyse IA. Capture `screens/iphone-annonce-publiee.png`.
- **Favoris** : ajout sur l’annonce A reprise à25CAD (197), liste contenant exactement cet article198 ; après acceptation de la proposition, fiche216 « Réservé temporairement », achat/offre masqués, puis liste217 conservant le favori avec badge Réservé.
- **Proposition de remise et conversation** : offre24CAD avec note clairement fictive, lieu « À convenir par messagerie », récapitulatif207 puis envoi1795659617146. Message accentué envoyé depuis le téléphone211 et réponse du compteA reçue212. Aucun message adressé à un client réel.
- **Acceptation réellement relue** : compteA accepte après le déploiement micro3 et son drainage ; photos de l’accord visibles214. Lecture backend strictement bornée au nouveau chat : compteurC0, réponseA en une occurrence avec `isRead=true`, quatre timestamps d’acceptation égaux. Preuve `BACKEND_PHYSICAL_C_CHAT_READONLY.json`. Le WARN SDK `failed-precondition` pendant la concurrence du compteur ne démontre pas à lui seul une relance ; l’effet final est cohérent et aucune perte n’a été observée.
- **Fin de remise** : compteA confirme la rencontre ; C ouvre puis annule la confirmation227/228, la rouvre229 et confirme1795659960885. L’UI231 affiche « Transaction terminée » et « Remise déclarée terminée », en précisant que Seconde ne vérifie ni paiement ni remise. Ordre `meetup_UcPlvRd64dsxxrQOLJ5n`. Capture `screens/iphone-remise-terminee.png`.
- **Avis** : Mes commandes234 → cinq étoiles et commentaire explicitement QA235/236 → succès238 → Avis laissé239, sans nouvelle invitation. L’avis est proposé dans la liste Mes commandes, pas dans la fiche Commande. Capture `screens/iphone-avis-enregistre.png`.
- **Historique de recherche après index** : recherche `iPhone V1`220 retrouve exactement l’annonce publiée ; retour et réouverture222 affichent la recherche récente. Aucun WARN d’index ni ERROR dans cette fenêtre de contre-vérification.
- **Profil** : bio QA modifiée242, confirmation243 et contrelecture244.
- **Favoris après consommation** : défaut d’en-tête reproduit240 (« 1 article » avec corps vide). Le compteur utilise désormais les mêmes articles qualifiés que le corps et distingue les pages encore à charger. Contrelecture245 : aucun favori, aucun compteur1 périmé, sans retoggle.
- **Troc physique** : entrée248, déclaration Québec initialement décochée250 puis cochée explicitement251 ; sélection de l’annonce C252, ajout253, article déposé relu254/255. Retrait confirmé256/257 et absence relue258. Aucun contrat Troc engagé avec C.
- **Critères** : écran260 relit les critères de base achat/vente satisfaits et indique les paiements/étiquettes fermés.
- **Suppression** : parcours263→264→265 prépare une intention locale. Premier essai de mot de passe pendant les modifications HMR non qualifié : champ effacé, aucune autorisation d’envoi et aucune demande serveur confirmée. À retester sur source stable, sans en déduire une réussite ni une panne.

L’empreinte c291 a ensuite été invalidée par le correctif du sélecteur de photos postal Android. Le gel final est `0abd90e7b5245690f9509e161ebc4276711d8a9eb59b76e1fb90227d9cdc816d` (1062 fichiers). Les choix de photos restent locaux jusqu’à l’action explicite « Envoyer les photos », avec une nouvelle validation de session et de source. Le cycle postal final est réellement terminé sur les deux simulateurs ; il n’est pas déclaré exécuté sur l’iPhone physique.

## Suppression physique sur source stable

- Redémarrage269 et contrelecture du compte C271 ; le suivi public272 retrouve l’intention préparée, sans prétendre qu’elle est envoyée.
- Ouverture273, saisie du mot de passe avec placeholder privé274/275, vérification276 : **identité vérifiée**, confirmation désormais active. L’essai268 pendant HMR reste non qualifié ; le parcours stable réussit sans modifier les gardes d’authentification.
- Confirmation explicite SUPPRIMER277 et envoi1795661047883, puis279 : **Demande enregistrée,0/7, accès pas encore fermé**.
- Redémarrage280, réouverture du suivi282 : **Examen en cours,1/7**, même demande, pas de nouveau POST d’intention. L’état affiché précise honnêtement que l’effacement n’est pas terminé.
- Lecture serveur ciblée : commandId `1252409b88593b3a83a6d4d3b5e8532cf3ed83df1795f5b9e132b44b0996e78c`, requestId `8575dac6f8e7285389d8d1de02240ddf`, état `awaiting_review`, fence false.
- Logs serveur bornés02:40→02:47:49UTC : aucune entréeERROR/HTTP>=400 sur les trois fonctions médias et les cinq moteurs filtrés par cette commande. Aucun payload privé lu. L’attente de qualification n’est pas présentée comme une panne serveur.

**P11 reste partiel.** Le contrôle automatique a refusé la publication de l’attestation Dev limitée aux deux comptes synthétiques, faute d’accord utilisateur explicite pour cette opération précise. La tentative a été rejetée avant lancement : aucun reçu, rôle ou pin publié et aucun effacement activé. Le consentement ciblé reste nécessaire pour vérifier la fermeture d’accès, la fin du traitement et la conservation minimale des preuves.
