# Recette native Android V1 — en cours

App `com.seconde.app.dev`, build local Dev1.0.1/code1, Pixel7API34 arm64 (`emulator-5554`). JavaScript servi par Metro8091 depuis la source courante, profil `--phase1`, serveur distant **Seconde Dev**. Ce n'est ni l'AAB16 soumis ni une installation Play. Root possède désormais exclusivement les gestes Android ; l'agent natif conserve iOS et les corrections RN.

## Constatations réellement exécutées

| Cas | Résultat observé et preuve |
|---|---|
| A02/A08 | Inscription B par formulaire Android, profil adulte fictif1990, CGU/confidentialité/activité personnelle, marketingOFF. Preuve détaillée d'inscription détenue par l'agent natif (`e7j-99` avant handoff). Aucun mot de passe enregistré dans Google Password Manager. |
| Préparation A03 | Root a vérifié uniquement emailVerified sur AuthDev après lookup UID/adresse/date de création du nouveau sujet, puis relu la valeur native. Voir `DEV_SYNTHETIC_EMAIL_VERIFICATION.json`. Cela **ne prouve pas une livraison d'e-mail réelle** ni encore le rafraîchissement du claim dans le client. |
| L02/T06 | Galerie Android limitée aux photos choisies ; sélection du seul logo Seconde QA importé depuis les assets publics, retour caméra1/5photos (`v86-9`). Aucune autre photo existante sélectionnée. |
| L03 | Revue des photos puis bouton Remplir manuellement : arrivée sur Détails (`v86-11`). Préparation IA non exercée dans ce sous-parcours. |
| L04 négatif | Continuer avec champs vides refuse et énumère titre/catégorie précise/hygiène/description/état (`v86-12`, `screens/android-details-validation.png`). |
| L04 saisie | Titre et description synthétiques saisis ; navigation catégorie Hommes→Vêtements→Hauts et t-shirts→T-shirts→T-shirts unis ; choix explicite Très bon état (`v86-22`). |
| L04 taille | Système EU constaté sélectionné ; choix L. Aperçu restitue exactement Taille L EU. iOS A utilise M US dans sa recette distincte. |
| L04 prix/modalité | Prix20CAD saisi ; remise en main propre seule affichée ; quartier MileEnd sélectionné, compteur1. Aucune option de livraison intégrée ou paiement affichée (`v86-25`). |
| L05/L06 préparation | Clic Aperçu ouvre la page avec photo, titre,20$, Très bon état, L EU, description et MileEnd (`v86-26`, `screens/android-listing-preview.png`). **Publication pas encore confirmée.** |

## Résultats qui ne sont pas des bugs établis

- Le premier rendu après retour du picker affichait encore0photos ; le rendu suivant a bien montré1/5. Les actions et captures immédiates peuvent précéder la transition asynchrone.
- Le sheet quartiers apparaît partiellement dans l'arbre d'accessibilité de Prix alors qu'il est fermé. Le clic central sur Aperçu a réellement fonctionné ; aucune obstruction utilisateur établie sur cette base.
- Le blanc Android initial après Skip s'est résolu et le catalogue est apparu : aucun crash confirmé.
- Après coexistence de dump UI Expo MCP et Argent, une session UiAutomation était occupée. Redémarrage du seul transport Argent Android : arbre complet et saisie conservée. Aucun arrêt d'app, effacement de données ou désactivation de contrôle Origin.

## Blocage en cours et limites

Le sujet iOS A a rencontré `storage/upload-unconfirmed`, stage `transfer`, sans statutHTTP exposé, avant création d'annonce. Root a suspendu les gestes Android à l'aperçu pour laisser l'agent RN améliorer ce diagnostic puis comparer l'envoi B vérifié à l'envoi A non vérifié. Le refus final de publication pour e-mail non vérifié n'est donc **pas encore prouvé** par A. Aucun succès de publication, chat, achat local, troc ou suppression ne doit être déduit de ce rapport intermédiaire.

Les credentials synthétiques restent dans un fichier privé temporaire, jamais dans ce rapport. Aucun compte/contenu/secret de production copié vers Dev ; aucune mutation de production par cette recette. Les connexions Google/Apple réelles, Maps sous signature store, push physique et remise/envoi réels restent des preuves distinctes non acquises ici.

## Suite réellement exécutée après l'aperçu

- Après le FastRefresh du diagnostic, Relire reste fermé. **Modifier→Prix→Aperçu** recapture un contexte courant et conserve photo/titre/description/prix/taille/quartier (`v86-29`), sans redémarrage ni modification des gardes.
- Clic réel Publier Android : l'envoi natif franchit le point où iOS échoue, puis le **serveur** refuse `email_verified=false` avec « Veuillez verifier votre adresse e-mail avant de publier » (`v86-30`). Le message est celui de `functions/src/callable/products.ts:455`. La mise à jour administrative précédente n'avait pas rafraîchi le JWT du client. Pas de succès de publication à en déduire.
- CTA Vérifier mon email ouvre l'écran correspondant. Sa lecture automatique ne remet pas l'état à jour au premier focus (constat persistant `v86-32`, défaut de relance avant focus à qualifier/corriger).
- Bouton Envoyer : accusé UI « Email envoyé », puis J'ai vérifié mon email (`v86-34`). Le destinataire est une adresse synthétique `.test` : **aucune livraison réelle à une boîte n'est qualifiée**.
- J'ai vérifié mon email effectue la relecture Auth normale et affiche « Email vérifié ! » (`v86-35`). OK revient à l'aperçu intact (`v86-36`).
- Au clic Publier suivant, l'écran reste actif sans navigation ni alerte pendant20s, avec warning Dev Failed to save draft fields (`v86-37`). **Aucun HMR pendant ce passage** : vrai défaut de couranteté après vérification à corriger, distinct de la récupération FastRefresh. Pas de répétition aveugle ; root attend le correctif/reactivité de génération et sa relecture de journal avant nouvelle tentative.

Ce point d'aperçu est dépassé par les résultats ci-dessous. Les tests RNTL sont des preuves distinctes des gestes natifs.

## Publication, chat et remise terminés

- L06 : après correction de l'abonnement de génération et reprise normale Modifier→Prix→Aperçu, un clic Publier a reçu **Annonce publiée** (`v86-39`). Annonce B `fa8090d12faca0d75114`, titre Article QA B 20261125,20CAD,L EU,MileEnd ; fiche propriétaire vérifiée (`v86-40`). Expo MCP officiel a capturé cette fiche (`screens/expo-mcp-android-published-article.png`).
- D09 : partage système ouvert, seule action Copier choisie ; lien réellement visible `seconde-dev:///article/fa8090d12faca0d75114` (`v86-42`). Aucun destinataire sélectionné ou message envoyé.
- C01 : lien chaud Messages ouvert ; boîte vide avant l'émission d'A (`v86-46`). La proposition d'achat contextualisée d'A fait apparaître une conversation Ventes avec badge1 (`v86-47`).
- C02/M01 : B reçoit la proposition20CAD et le texte d'A, puis envoie une réponse accentuée ; A en confirme la réception exacte (`v86-48` à51). Le clavier Argent Android refuse les caractères nonASCII avant frappe : collage utilisateur normal dans le champ chat utilisé, sans bug de saisie app démontré.
- M02/T03 : premier dialogue d'acceptation annulé, offre toujours en attente ; rouvert et accepté à1795654749991. Accusé Offre acceptée, commande et bouton Confirmer le rendez-vous (`v86-53`). Commande reçue avec état La rencontre est à confirmer et données exactes.
- M03 : B confirme la rencontre à1795655218266. Deux clics indépendants de fin ont été émis à1795655285069 par A et1795655289038 par B, soit3,969s d'écart. Les deux ont reçu succès et les deux commandes ont convergé vers une fin cohérente ; B voit une seule notification finale (`v86-61`). Ce chevauchement observé n'est pas une preuve exhaustive de toutes les courses réseau. Aucun paiement ni remise physique n'a eu lieu.
- M03/R01 : après correction de présentation, détail **La remise est terminée** (`v86-63`) et liste Mes ventes **Remise déclarée terminée** (`v86-65`), sans affirmer qu'un paiement est vérifié.
- R01/R04 : page avis charge le nom public d'A sans lecture du profil privé (`v86-66`),5boutons de note accessibles. B saisit5étoiles et un commentaire explicitement synthétique puis envoie à1795656153716 ; confirmation Merci pour votre avis (`v86-68`). A avait également laissé son avis distinct.

## Défaut de réservation découvert et préparatifs de revalidation

D07 a échoué avant correctif : favori ajouté par A avant acceptation, puis supprimé pendant la réservation ; carte affichée vendue. `isSold` verrouille aussi un stock engagé et ne suffit donc pas à prouver une vente terminée. Correction client basée sur la projection qualifiée `inventoryAvailability` et correction serveur du trigger de nettoyage en cours de déploiement Dev. **Ne pas annoncer ce cas PASS avant nouvelle réservation et fin sur une autre annonce.**

Quatre articles supplémentaires sont préparés via SDK public Dev avec les mêmes acteurs et un JPEG compressé du seul logo public. Ce sont des fixtures, pas quatre preuves de publication par UI : A postal `e05240b4bcef897aee28` ; B local `0359924a965e6b2cd63d` ; B réservation `d4ddbbf3417063527653` ; B postal `0d189cf147083434c5e5`. Aucun profil, consentement, donnée Prod ou écriture privilégiée Firestore modifié.

État courant au point20h23Toronto : B a envoyé son avis, la recette des trocs et de la nouvelle réservation reste à exécuter. Les paragraphes Blocage en cours plus haut décrivent l'historique et ne sont plus l'état courant.

## Recherche, compte et support — suite

- D02 : Article QA donnait0résultat tandis que Article en donnait6 (`v86-81/84`). L'index serveur écarte les mots de2caractères, mais le client exigeait leur présence. Correctif client de tokenisation posé ; retest iOS documenté distinctement (Article QA→6, en de→aucun, corrigée accentué→annonce attendue). Aucun reindex privilégié.
- D05/T03 : recherche Article sauvegardée avec alertesOFF (`v86-86`), présente dans Recherches sauvegardées, compteur1 (`v86-90`). Première suppression annulée, fiche toujours présente ; seconde confirmée→Aucune recherche sauvegardée (`v86-92`).
- P01 : B modifie seulement sa bio en texte explicitement QA puis Enregistrer ; succès Votre profil a été mis à jour (`v86-94`). Identité, naissance et consentements inchangés.
- P03/T07 :123refusé comme numéro canadien invalide (`v86-97`), puis numéro fictif5145550103formaté et enregistré avec succès (`v86-99`). L'écran dit explicitement coordonnée de contact, pas une méthode vérifiée de connexion/récupération. Aucun SMS.
- H02 : sujet Accès à mes renseignements personnels, message clairement synthétique et sans demande réelle ; un seul clic Envoyer à1795656696640. Accusé d'enregistrement et carte de demande privée apparaissent (`v86-106`). Actualiser le résultat puis J'ai pris connaissance du résultat acquitte le journal courant (`v86-108`), sans renvoi.
- S01/S02/S04 : catalogue Troc chargé ; déclaration synthétique de résidence Québec via case initialement décochée. Deux propres articles B local/postal sélectionnés, réservation exclue. Un clic Ajouter2 à1795656281610, placeholders pendant la requête puis section Vos articles/Afficher2 après environ30s (`v86-77`), aucune relance.
- E04 : lien inconnu /swap affiche Page introuvable ; vrai chemin /swap-zone charge le catalogue. Un lien invalide n'a pas ouvert un autre compte ou une action privée.

## Revalidation D07 — en cours

A a ajouté le favori B réservation avant nouvelle demande20CAD. B a accepté à1795656822143 ; Offre acceptée et commande s'affichent (`v86-114`) sur le lot serveur24source dd328556. A confirme que le favori demeure et que sa carte dit Réservé. **Nouveau défaut trouvé** : la fiche gardait un cache5minutes ancien et proposait encore achat/offre ; relecture au focus et garde pendant actualisation en correction. Aucune annulation/finalisation émise dans cette seconde rencontre à ce point.

Les options de rencontre B et le formulaire documentaire d'absence ont été ouverts (`v86-115/116`). Enregistrer mon récit est désactivé sans faits ; retour quitte sans émettre de récit. Cela qualifie l'ouverture/refus vide/sortie, pas les deux versions d'un litige effectivement enregistré.
