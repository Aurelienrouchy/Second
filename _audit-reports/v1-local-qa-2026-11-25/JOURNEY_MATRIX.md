# Recette V1 locale — matrice et preuves

Demande du fondateur du 25 novembre 2026 : tester les parcours V1, corriger, commiter puis pousser. Les soumissions existantes iOS 1.0.2(35)/Android 1.0.2(16) restent en examen. Cette campagne porte sur la source courante ; elle ne qualifie pas automatiquement ces binaires déjà construits.

Matrice issue de l'audit UX préalable. **Aucune ligne n'est PASS sans preuve d'exécution.** Statuts initiaux : À EXÉCUTER. Les rapports natifs doivent citer les IDs ci-dessous, l'OS, le compte synthétique (sans identifiant de connexion), le backend, le résultat et la preuve. Un test SDK, un test de composant et un geste UI sont des preuves distinctes. Une dépendance externe indisponible reste NON VALIDÉE, jamais PASS par simulation.

## Périmètre et acteurs

V1 : annonces, découverte, favoris, messagerie, offres, remise locale, troc local **et postal manuel**, avis, compte, support, confidentialité, historique et administration. Nouveaux paiements, livraison intégrée, forfaits payants et Square restent fermés. `isSold` peut verrouiller une réservation : ne pas confondre ce verrou avec une vente terminée ni supprimer les favoris pendant une simple réservation.

Acteurs synthétiques : invité ; A/B adultes particuliers Québec vérifiés ; U non vérifié ; Y 16–17 ans ; J moins de 16 ans ; Q hors Québec ; P professionnel ; Google ; Apple sans mot de passe ; Apple avec mot de passe lié ; administrateur ; compte en pause/effacement ; historique synthétique. Aucun compte, contenu ou secret Prod à importer. Les annonces doivent être créées par les contrats actuels, sans ancien seed qui contourne l'admission.

## Scénarios

| IDs | Scénarios à exécuter | État |
|---|---|---|
| E01–E05 | Cible Dev/demo et finance fermée ; onboarding/reprise ; onglets invité ; liens privés/inconnus ; arrière-plan/retour | À EXÉCUTER |
| A01–A05 | Connexion valide/invalide ; inscription/consentements/doublon ; validation e-mail et lien expiré/réutilisé ; refus publication non vérifiée ; oubli mot de passe neutre | À EXÉCUTER |
| A06–A08 | Google réel/annulation ; Apple iOS et absence Android ; profil incomplet quitter/reprendre | À EXÉCUTER |
| A09–A12 | Âges <16/16–17/18 ; admission Québec/particulier ; déconnexion A→B sans fuite de cache ; révocation et reconnexion volontaire | À EXÉCUTER |
| D01–D05 | Feed/pagination/vide/erreur/stock ; recherche accents/réponses concurrentes ; filtres/réinitialisation ; recherche visuelle permissions/erreur ; recherches sauvegardées CRUD | À EXÉCUTER |
| D06–D10 | Favoris invité/carte/détail ; favoris conservés réservation puis retirés vente finale ; profil public/suivi/avis/inconnu ; partage liens Dev ; boutique lecture sans forfait payant | À EXÉCUTER |
| L01–L05 | Entrée vente iOS/Android ; photos/ordre/permissions ; IA explicite et saisie manuelle/retard ; catégorie/taille US-EU/prix ; brouillon/reprise/abandon/changement de compte | À EXÉCUTER |
| L06–L10 | Publication unique visible B ; édition/conflit/hors ligne ; réservé/vendu/remise en vente ; suppression et ancien lien ; édition étrangère/disponibilité changée | À EXÉCUTER |
| C01–C04 | Contact contextualisé et annulation sans chat parasite ; texte/réception/lecture/pagination ; photo/échec envoi ; offre montant/accepter/refuser/expiration | À EXÉCUTER |
| C05–C08 | Offres concurrentes ; blocage bilatéral/déblocage ; profil incomplet ; chat étranger/déconnexion pendant requête | À EXÉCUTER |
| M01–M04 | Proposition remise locale/lieu/montant/retour ; acceptation réservation unique ; confirmations rôles/commande/avis ; annulation libère stock | À EXÉCUTER |
| M05–M08 | Absence et versions des deux participants ; acheteurs concurrents ; réponse perdue/idempotence ; refus soi-même/vendu/bloqué/mineur/session | À EXÉCUTER |
| S01–S04 | SwapZone filtres/vide/ancien lien ; dépôt/retrait stock ; sélection multiple 20/retour ; admission adulte particulier Québec | À EXÉCUTER |
| S05–S07 | Proposition locale/conditions/soulte zéro ; refus/acceptation conditions actuelles/stock ; préparation/photos/deux réceptions/fin | À EXÉCUTER |
| S08–S09 | Troc postal manuel : arrangement/photos/deux envois/deux réceptions ; refus réception anticipée/conditions périmées/photos manquantes | À EXÉCUTER |
| S10–S12 | Annuler proposition/refuser, dossier si accepté ; litige et documentation admin ; réponse perdue/isolation session | À EXÉCUTER |
| R01–R04 | Avis remise unique/validation ; avis prématuré/expiré/étranger/inconnu ; deux avis troc ; propagation nom/avatar et masquage public | À EXÉCUTER |
| P01–P04 | Profil/photo/bio ; préférences ; téléphone canadien sans prétendre authentification SMS ; adresse manuelle/autocomplétion/erreurs | À EXÉCUTER |
| P05–P08 | E-mail avec réauth récente/lien ; changement e-mail fournisseur social ; changement/liaison mot de passe ; confidentialité et marketing séparés | À EXÉCUTER |
| P09–P12 | Export privé ; pause ; demande d'effacement compte vide/confirmation/reprise ; effacement compte engagé et conservation sans faux completed | À EXÉCUTER |
| P13–P14 | Sécuriser compte/révoquer/reprendre ; relation entre comptes garder un/pauser autre sans fusion de données | À EXÉCUTER |
| N01–N05 | Préférences ; permission OS sans prétendre livraison push ; cibles notifications chat/article/commande/recherche/troc ; support privé ; liens à froid/chaud/session | À EXÉCUTER |
| H01–H03 | Signalement article/profil/avis/message précis ; support créer/répondre/idempotence ; dossiers privés modération/confidentialité/produit | À EXÉCUTER |
| H04–H06 | Aide compte perdu/mailto sans envoyer ; suivi public effacement/retour OAuth sans envoi automatique ; pages légales/à propos/retour/hors ligne | À EXÉCUTER |
| Z01–Z03 | Refus non-admin/retrait rôle ; signalements/modération ; support/accès compte | À EXÉCUTER |
| Z04–Z07 | Admission/fraude/dossiers produit ; litiges remise/troc documentaires ; incidents confidentialité ; boutique/banque/transport/taxe historique sans nouveau rail | À EXÉCUTER |
| F01–F04 | Liens paiement/livraison fermés ; annonce livraison sans repli remise ; portefeuille sans nouveau retrait ; historique KYC/banque/taxes sans activation | À EXÉCUTER |
| F05–F07 | Anciennes commandes/étiquettes sans nouvelle étiquette ; forfait/Square/simulation Dev fermés ; ancienne soulte lisible/nouvelle soulte zéro | À EXÉCUTER |
| T01–T05 | Hors ligne chargement/envoi ; réponse perdue après émission puis réconciliation ; double appui/retour/modal ; entité absente/supprimée/étrangère ; compte changé pendant requête | À EXÉCUTER |
| T06–T09 | Permissions refusées/limitées/retour ; CAD/FR/dates/contact Canada ; anniversaire 16/18 aujourd'hui/29 février/Toronto ; texte agrandi/clavier | À EXÉCUTER |

## Transversal

- Connexion croisée iOS↔Android par e-mail, Google réel, Apple→Android sans mot de passe (explication), puis Apple avec mot de passe lié (même compte), nouvelle installation/appareil perdu.
- Réauthentification e-mail/mot de passe, Google et Apple pour e-mail, mot de passe, pause, suppression et révocation Apple.
- Transitions : brouillon→publié→réservé→libéré/vendu→supprimé ; remise proposée→acceptée→confirmée→terminée/annulée/absence ; troc local/postal préparation/photos/envois/réceptions ; avis ; pause/effacement/reçus support.
- Les 109 fichiers de routes recensés (layouts compris) incluent avis, historique/retention portefeuille et 15 écrans admin. Expo MCP expose 101 chemins dans `EXPO_ROUTER_SITEMAP.json` : une visite des cinq onglets ne couvre pas ces familles. Ce sitemap constate les routes, pas leur bon fonctionnement.

## Premier écart confirmé

P11/P12 : le sous-titre Paramètres « Supprimer définitivement toutes vos données » contredisait l'écran de demande et ses conservations. Correction RN : « Demander la suppression et suivre son traitement ». Il reste à vérifier son rendu sur les deux OS.

## Baseline au lancement

- App Vitest : 329 passent, 0 échec ; typecheck initial sans diagnostic ; frontières initiales sans diagnostic (sorties à confirmer).
- Fonctions : 1333 passent, 1244 échouent, 186 ignorés, 68 suites rouges. Ne pas attribuer toutes les causes aux mocks sans analyse.
- Règles Firestore/Storage : 400/400 passent sur émulateurs.
- Jest : campagne en cours avec `--watchman=false` après refus sandbox Watchman ; aucun affaiblissement de la configuration de sécurité.
- Aucune recette UI complète de cette nouvelle campagne n'a encore été déclarée réussie.
