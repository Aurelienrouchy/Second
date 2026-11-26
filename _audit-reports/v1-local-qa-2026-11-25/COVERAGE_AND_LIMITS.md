# Couverture V1 locale et limites — 25 novembre 2026

Point de lecture app : **23 h 25 Toronto**, clients Dev locaux contre **Seconde Dev distant**. Écrivain de la recette : `0abd90e7b5245690f9509e161ebc4276711d8a9eb59b76e1fb90227d9cdc816d`. Lecteur des trois corrections d’observation : `75b4c575a44c4880b5bef35a22420fceea279a200e2740bc4e5f1dad4360850d`. Gel final automatisé : `0454cb10074e5808188981da699e4cde3884ee726a9ef21eba970e8a01602a55`, seule clé de remontage Auth ajoutée depuis75b4. Chaque empreinte comporte1062 fichiers runtime, relevés par root. Les écritures historiques restent attribuées à0abd. Ces preuves ne qualifient ni les binaires iOS35/Android16 déjà soumis, ni une installation depuis les stores. Aucun compte, contenu ou secret Prod n’a été copié dans cette recette.

Les plages de [JOURNEY_MATRIX.md](JOURNEY_MATRIX.md) contiennent **117 IDs distincts**, et non113 : E5+A12+D10+L10+C8+M8+S12+R4+P14+N5+H6+Z7+F7+T9. Aucun ID n’est retiré. La matrice partagée reste inchangée dans cette consolidation ; les observations et limites sont détaillées ci-dessous, sans transformer une suite unitaire en preuve de geste natif.

## Complément du 26 novembre — dernier gel95b

Source QA finale `95b0942d120da4e6f596fd14cabbde12b07d376b19738482dacea0574b336a6b` (1064fichiers), commit poussé `4d6ff92a6596a6ddd5147e3df97dfff19d2683a7`. Les écritures historiques ci-dessous restent attribuées à leurs sources d'origine. Root a confirmé tous les digests et seulement cinq changements runtime de vente. Sur95b :224suitesJest/2208tests et329Vitest passent, TypeScriptapp/frontières0, sortie normale sans forceExit ; voir APP_FINAL_SELL_VERIFICATION.json.

ANDROID_SELL_FINAL_RETEST.json documente huit cas natifs : photo galerie publiclogo persistante (L02/T06), sortie unique/sauvegarde/reprise (L05), vraie requêteIA explicitement sur ce logo (L03, sans certification de reconnaissance vêtement), Pricing retour matériel avec12CAD/MileEnd préservés, publicationL06, éditionprix13CAD L07, vendu/remis envente L08, retraitde cette seule annoncejetable et ancienlien indisponible L09. Deux anciennesfixtures préservées ; pas d'ordre/paiement/livraison. Logs bornés88242–92678 :0ERROR/query et9WARNReanimated. Les anciens échecs0454galerie et2c324sortie restent séparés, sans réécriture.

ANDROID_EXTENDED_FLOWS.json complète D03 (filtres conservés/reset ; résultat vide donc composition non certifiée), D08 (profilpublic/suivre/retirer) et A05 (saisieinvalide refusée puis demande neutre, sans livraisonmail certifiée). Dernier smoke communiOS95b en cours ; iPhone momentanément sans liaisonUSB. Apple/Google réels et les autres limites natives des lignes ci-dessous restent non certifiés. Pas de prétention117PASS.

## Ce qui a réellement été exécuté

| Niveau | Résultat / source | Portée et limite |
| --- | --- | --- |
| UI-I | [NATIVE_IOS.md](NATIVE_IOS.md), iOS26.5, client Dev signé ad hoc | Onboarding, inscription, permissions/photo, publication A, chat/remise/avis, reprise après déplacement réel du conteneur→Modifier→publication, cycle favori réservé→annulé→nouvel accord→vendu, troc local jusqu’aux deux réceptions et deux avis. Postal également terminé sur les deux OS (`e7j-499`, `7t4-500`), photos privées relues506/507. Les corrections source décrites dans ce rapport ne valent pas toutes une revalidation UI. |
| UI-A | [NATIVE_ANDROID.md](NATIVE_ANDROID.md), Pixel7/API34 ; [ANDROID_EVIDENCE.json](ANDROID_EVIDENCE.json) | Inscription, refus JWT non vérifié, refresh normal, publication B, partage, chat, acceptation annulée puis confirmée, rencontre confirmée et déclarée terminée par les deux participants, avis envoyé. Les quatre annonces supplémentaires créées par SDK sont des fixtures, pas quatre publications par UI. |
| UI-P | [NATIVE_IPHONE.md](NATIVE_IPHONE.md), iPhone13ProMax physique/iOS27.0.1 ; [IPHONE_EVIDENCE.json](IPHONE_EVIDENCE.json) | Nouveau compte C, vraie caméra/photo noire QA, publication manuelle, favori réservé puis consommé, chat/rencontre/avis avec A, bio et dépôt/retrait Troc. Sur source stable : réauthentification par mot de passe, demande d’effacement enregistrée et même intention relue après redémarrage ;286 confirme2/7 et accès fermé. Le serveur confirme ensuite7/7 et Authabsent, puis UI293/296/300 confirme7/7 en invité après deux redémarrages. Compléments de connexion, adresse, préférences, wallet et confidentialité dans IPHONE_EXTENDED_FLOWS.json. Metro8092/Seconde Dev, client development ; galerie privée non sélectionnée et aucune inférence IA déclenchée. |
| J | [JEST_REPAIRS.md](JEST_REPAIRS.md), `phase1-final0454-jest.json`, source0454 | **222/222 suites,2179/2179 tests,0 échec,0 ignoré** ; sortie normale0 en78,319s avec recherche des handles, sans `--forceExit`. Les47 anciens RED sont réparés ; [mapping des invariants](HISTORICAL_47_TRIAGE.md). RNTL monte les composants/routes réels mais les transports sont simulés ; ces services ne sont pas des appels Firebase réels. |
| V | Vitest app final, `phase1-final0454-vitest.json`, source0454 | **329/329,31 fichiers**, sortie0. Les96 groupes du JSON incluent les `describe` : ils ne sont pas96 fichiers. Logique pure et services avec I/O substituées, aucune preuve UI/cloud implicite. |
| SDK | [BACKEND_LOCAL_VERIFICATION.md](BACKEND_LOCAL_VERIFICATION.md), `v1-core-six-final.log` | **32/32 dans6 fichiers,0 ignoré**, vrais Auth/Firestore/Storage émulés sur `demo-second`. Admission native, requêtes privées, contention offres/stock. Aucun paiement, fournisseur social ou transport externe réel. |
| BK | Même rapport, `final24-focused.json` | **386/386 dans16 fichiers** : handlers/adaptateur et sources natives de test ; transport externe substitué. Ce sous-ensemble ne rend pas la globale fonctions verte. |
| RULES | Même rapport | **401/401 dans24 fichiers**, vrais émulateurs. Cela prouve les cas de règles exercés, pas tous les gestes de chaque écran. |
| Statique | `coverage-tsc-after-search.log`, `coverage-boundaries-after-search.log` | `npx tsc --noEmit` et `npm run lint:boundaries` : **sortie0** après le correctif D02. |
| Delta D07 | `round87-d07-final.json`, `d07-final-tsc-app.log`, `d07-final-boundaries.log` | **70/70 dans8 suites**, sortie normale, app/frontières0 après le dernier guard vivant du cache. Aucune globale massive relancée pendant le gel ; l’inventaire7 précède ces ajouts. |
| Delta accessibilité et annulation | `round90-frozen-final-targeted.json` | **59/59 dans11 suites**, sortie normale avec recherche des handles : wrappers des feuilles réelles, contrat `accessible=false`, sélection et clavier, prix/CTA À convenir, compte de favoris rendu, annulation des queries d’effacement/admission sans masquer une vraie erreur actuelle. Ce sont des preuves composant/query, pas une preuve AX sur appareil. |
| Delta final ciblé | `app-final-jest-targeted.json` | **137/137 dans17 suites**, sortie normale avec recherche des handles après correction ESLint du bloc postal. Comprend les14 contrôles de la vraie route postale, les59 précédents et les régressions actions/service/contexte. Les lots se recouvrent, leurs nombres ne s’additionnent pas. |
| Statique finale0454 | `phase1-final0454-tsc.log`, `phase1-final0454-boundaries.log` | App et frontières **sortie0** sur le gel0454. Typecheck étendu des tests : **104 diagnostics hérités** (`historical-final2-tsc-tests.log`), aucun dans les sept fichiers historiques réparés ni leur helper ; hors typecheck app standard. |
| Delta lecteur75b4 | `round101-final-read-chat.json`, `reader-final-tsc.log`, `reader-final-boundaries.log` | **114/114 dans8 suites**, sortie normale avec recherche des handles ; app/frontières0. Vraies routes public/owner, service et journal :20 cas ; vrai listener/service/store :6 cas. Perte de portée annulée sans reçu tardif ni erreur de query ; véritable erreur actuelle conservée. Refus Firestore actuel vide les conversations, garde erreur/log ; ancien UID/génération/owner SDK ne touche pas la nouvelle liste. Ce lot est ensuite inclus dans la globale finale0454 ; il ne réattribue pas les écritures0abd. |

Tous les logs app mentionnés sont sous `/tmp/seconde-v1-jest-repair/`, privé. Journaux backend sous `/tmp/seconde-v1-local-backend-20261125/`. Les captures référencées par leur ID sont celles des rapports natifs ; une capture de catalogue n’est pas une exécution des mutations du catalogue.

Les commandes finales app exécutées pour ce document :

```bash
npx vitest run --reporter=json --outputFile=/tmp/seconde-v1-jest-repair/phase1-final0454-vitest.json
npx tsc --noEmit
npm run lint:boundaries
```

## Index des preuves automatisées

Chaque code ci-dessous désigne des fichiers effectivement présents dans l’inventaire courant. Une référence établit uniquement les assertions de ces fichiers, pas toutes les variantes de la ligne métier qui la cite.

| Code | Fichiers / assertions pertinentes |
| --- | --- |
| ENV | J : `firebaseEnvironment`, `firebaseEmulatorIsolation`, `environmentStorageIsolation`, `phase1QaProfile`, `phase1CallableContracts`, `rootLayoutStartup`, `platformEntry`. Projet/transport exact, finance/collecte fermées, aucun repli Dev→Prod. |
| AUTH | J : `auth-onboarding/authService`40, `authStore`19, `authSessionIsolation`7, `SignUpForm`10, `completeProfileSellerConsent`6, `socialAuthConfig`3, `tradeGenerationAndVerification`2. `authSheetReopenValidation`3 et `authBottomSheetAccessibility`3 : réouverture vierge après erreur de connexion, enfants/CTA conservés. Contrats d’inscription, provider, consentement et session ; fournisseurs et e-mails simulés. |
| ADMIT | J : `admissionB3`42, `auth-onboarding/eligibilityDeclaration`4, `shared-foundations/age`19. SDK : les4 suites eligibility sélectionnées par `functions/scripts/testEmulatorIntegrations.cjs --v1-core`. Âge, décisions originales, restriction, CAS et refus durables. |
| DISCOVER | J : `homeSections`14, `articlesSearchPagination`15 après ajout de7 contrôles D02, `useArticleSearch`10, `shopSearchScope`5, `savedSearchService`9, `searchHistoryService`12. Pagination/filtres/erreurs et données conservées. Le lot D02 courant passe25/25 avec sortie normale (`round75-native-search-final.json`) ; le vocabulaire est produit par le vrai générateur serveur, pas dupliqué dans la fixture. |
| VISUAL | J : `visualSearchResults`8, `visualSearchService`9. Préparation JPEG, changement de photo/compte/génération et reprise volontaire ; pas de vraie inférence cloud dans ces tests. |
| FAVORITE | J : `favoritesReservation`4, `useFavorites`3, `articleAvailability`9, `sellerLikesSessionIsolation`3 ; D07 : `articleAvailabilityFocus`8, `articleAvailabilityRoute`9 et `favoritesFocusAvailability`3. Vraie route/query/actions/CTA/favoris composés : cache ancien inopérant avant relecture serveur, erreur et callbacks tardifs refusés, retour après annulation relu malgré même membership. Compteur limité aux articles réellement rendus ; pages partielles nommées « affichés ». BK : triggers articles sold/offers et engagement. |
| PROFILE | J : `profile-reviews/useUserProfile`4, `userStatsService`8, `userService.profileImage`3 et composants publics ReviewItem/ReviewList/ArticleGrid/UserActions. V : `userService.accountStanding`15 protège les écritures ordinaires de bio/téléphone/adresse/préférences, sans permettre de forger `isActive`. |
| SELL | J : `sellLayout`2, `sellCapture`4, `sellPhotosReview`9, `sellPricingResume`1, `draftService`55, `draftPhotoUri`11, `draftPublicationIsolation`8, `sellPreviewPublicationIsolation`6, `sellPublicationRecovery`10, `aiService`30, `nativeStorageUpload`14, `imageUtils`7. Publication/reprise/privacité et flux manuel/IA à I/O simulées. |
| EDIT | J : `articleEditRecovery`26, `articleEditPrivateUpload`9, `articleEditListingContent`4, `articleOwnerOperationIsolation`10, `articleSoldRecovery`32, `b2v4/articleSoldIntentUI`20 ; V : `buildArticleUpdates`13, `editArticleForm`16, `ownerArticleActions`7. Aucun champ égal n’est adopté comme reçu natif par simple déduction. |
| CHAT | J : `useChat`11, `chatService.send`18, `chatImageOwnership`5, `chatReadNotifications`5, `chatParentOperation`5, `chatModalOperation`6, `chatMessageLongPress`3, `chatStore`8. `chatListenerPermissionLifecycle`6 : refus courant vide la liste/unread et conserve erreur/log ; callbacks anciens inopérants. Composition réelle de hooks/services, transport substitué. |
| OFFER | J : `offerOperationIsolation`18, `offerPressAcceptance`11, `counterProposalOperation`3, `makeOfferModalIsolation`5, `b2v3/confirmPresentationChain`12, `offerBlockGuard`5. Slots indépendants, double appui, réponses perdues, location capturée avant attente, blocage. |
| MEETUP | J : `meetupProposalRecovery`31, `meetupExitOperation`36, `b2v3/meetupRawExitCurrentness`16, `meetupActionReceipts`8, `refundChatTransactions`5, `orderListReadLifecycle`22. Récits natifs datés/relecture, propriétaire d’ouverture, annulation serveur, pas de succès avant reçu. SDK : `offers.emulator` et `articleSwapEngagement.emulator`. |
| SWAP | J : `swap/proposeSwapUX`24, `SwapPartyUI`31, `SwapActions`24, `swapFlowActions`15, `SwapDetail`5, `swapService`16, `swapAgreementLaunch`7, `swapAgreementReadScope`2, `swapDepositInventory`4, `swapContactScope`5, `swapProposalRecovery`5, `swapPhotoSelectionLifecycle`14. Vraie route/actions/guards : picker→fichiers locaux seulement, aucune préparation, aucun upload ni RPC de photos avant nouvel appui ; source relue au foreground, capture de génération courante, ancien callback/UID/SDK/route/source/blur/expiration refusés. Conditions et sélection exactes, namespace photo privé, réception conditionnée par l’envoi adverse. BK : phase1LocalAgreements, swaps.lifecycle et swapProofMedia ; RULES : photos privées. |
| REVIEW | J : `reviewRoutePublicIdentity`6, `profile-reviews/reviewService`10, composants ReviewItem/ReviewList ; statut dans `wallet/transactionStatusMeta`12. La vraie méthode de profil public est appelée via I/O RPC simulée ; aucun profil privé du pair. Pas de preuve d’unicité serveur déduite du seul document simulé. |
| ADDRESS | J : `addressSettingsAutocomplete`14, `addressAutocompleteService`4 ; V : `addressValidation`8. Saisie/CAS/fallback Google→Photon, réponses tardives refusées et format canadien ; aucune qualification de Maps sous signature store. |
| ERASURE | J : `accountErasureProtocol`43, `accountErasureExperience`15, `accountErasureLifecycle`10, `accountErasureApplePortal`14, `accountErasureApple`4, `accountErasureObservationCancellation`20. Routes public/owner composées avec guards/service/journal réels : focus/UID/génération/SDK/AppState/abort/démontage périmés→annulation silencieuse et zéro `journal.record` tardif ; foreground frais accepté, ancien reçu99 refusé ; vraie erreur HTTP403 actuelle visible/journal conservé. État inconnu conservé, confirmation explicite, aucun POST depuis retour OAuth, ni faux completed. BK : inventaire/médias/finalizer ; la qualification opérationnelle reste distincte. |
| NOTICE | J : `notificationCenterNavigation`3, `devPushIsolation`4, `useNotificationSetup`27, `notificationService`13, `notificationStore`10. Payloads/routage/rotation/transports simulés ; permission OS et livraison push sont distinctes. |
| HELP | J : `supportRequestsPresentation`7, `moderationService`18, `offerBlockGuard`5. Sujet exact, contexte propre, doublon et pas de données tardives du compte précédent. Aucun examen humain réel inventé. |
| ADMIN | J : `admin/adminLayout`8, `eligibilityConfirmation`2, `adminShopActionContext`2, `admin/accountRelationshipPurchase`5 ; partie cash de `refundAdminFlows` avec preview/note/case initialement décochée. SDK : queries owner/admin paginées et signaux dans eligibility. Fichier `refundAdminFlows` entier14/14 : capture/checkout, états inconnus, preview/note/consentement/reçu natif pending sans faux règlement. |
| CLOSED | J : `phase1QaProfile`18, `shippingListingEnvironment`23, `shippingOfferClient`8, `squareInventoryPilot`5, `walletScopedReads`3, `walletSecondaryScreensPresentation`6, `walletPresentation`5, `walletWithdrawalIdentity`4, `nativeTrackingExperience`18, `orderDetailExperience`17, `swap/SwapPresentation`14. Certains positifs sont explicitement des fixtures phase2 : leur réussite ne certifie pas un rail de production ouvert. |
| HISTORICAL | J : `refundPaymentGuard`14, `shippingPreparationNavigation`15, `refundAdminFlows`14, `refundShipmentTracking`19, `boutiques-admin/shopService`21, `wallet/walletService`13, `transactionService`37 : **133/133**. Les122 anciens contrôles sont migrés/conservés et11 ajoutés ;47 anciens échecs réparés sans skip ni correctif runtime dans ces domaines. Vrais services/journaux/providers/session, I/O feuilles substituées. Positifs phase2 sous flags explicites ; négatifs rails fermés conservés. Ce lot ne prouve pas la restitution positive d’un petit solde ni des gestes financiers natifs. |
| SESSION | J : `tradeOperationFocus`4, `shippingPurchaseContextLifecycle`4, `tradeReceiptAdoption`32, `b2v3/tradeReceiptStorageRaces`18, `readScopedQuery`10, `ownerEligibilityQueryCancellation`5, plus gardes intégrées aux suites précédentes. La vraie lecture d’admission refuse UID/génération/SDK/démontage tardifs par annulation ; un vrai refus actuel du serveur reste une erreur. Les lectures normales après focus et les callbacks anciens sont distingués. |
| FORMAT | V : formatPrice16, formatName8, firestoreDate6 ; J : age19, labels produit3, tailles/préférences3, SwapActions à fontScale différents. Cela ne remplace pas un passage natif avec texte OS agrandi. |

## Couverture des117 IDs

**« — » dans la colonne UI = aucune exécution native correspondante trouvée dans les rapports lus.** Les références UI montrent le sous-parcours écrit, pas l’ensemble des variantes séparées par une barre. Les autres colonnes restent des preuves automatisées partielles ; aucune ligne composite n’obtient automatiquement un PASS complet.

### E — environnement et entrée

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| E01 | UI-I/UI-A : clients Dev, Metro8091, catalogue Dev | ENV | Build store installé et configuration de distribution distincts. |
| E02 | UI-I `e7j-15/21` : onboarding/préférences→accueil | AUTH, ENV | Reprise interrompue et même parcours Android non documentés. |
| E03 | UI-I `e7j-25/32` : catalogue invité, Vendre→auth ; UI-P `v86-138/143/144` : une seule feuille, champs exposés après correction | ENV, SELL | Tous les onglets invité non rejoués dans cette campagne. |
| E04 | UI-A `v86-46` lien chaud Messages ; `/swap` inconnu→Page introuvable, vrai `/swap-zone`→catalogue | ENV, SESSION | Lien privé interdit et ouverture à froid non exécutés dans ce sous-parcours. |
| E05 | Retour normal picker/verification dans les parcours natifs | SESSION | Cycle background/foreground complet et réseau coupé non rejoués par UI. |

### A — authentification et admission

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| A01 | UI-P307 : mot de passe incorrect refusé ;316 : compte synthétiqueA existant connecté | AUTH | Livraison mail et fournisseurs réels restent distincts. |
| A02 | UI-I `e7j-47/57/62/64`, UI-A `e7j-99` : inscriptions ; UI-P nouveau C `v86-152..156`, adulte fictif/consentements explicites/marketingOFF | AUTH, ADMIT | Doublon et consentements négatifs restent simulés. |
| A03 | UI-A `v86-34/35` : envoi demandé, reload/token normal, vérifié | AUTH | Adresse `.test` vérifiée administrativement : aucun e-mail livré, lien expiré/réutilisé non testé réellement. |
| A04 | UI-A `v86-30` : refus serveur JWT non vérifié ; UI-P `v86-157/158/160` vente bloquée puis refresh normal après vérification administrative ciblée | AUTH, SELL, BK | Livraison/lien e-mail réels ne sont pas prouvés par le champ Auth administrativement vérifié. |
| A05 | — | Aucun test ciblé du formulaire reset identifié | Envoi neutre/inexistant, lien expiré/réutilisé et retour app à exercer. |
| A06 | — | AUTH : configuration et annulation Google simulées | **Google réel NON VALIDÉ**, annulation native et interopérabilité deux OS. |
| A07 | — | AUTH : nonce/plateforme Apple simulés | **Apple réel NON VALIDÉ**, association mot de passe et passage Android. |
| A08 | Profil complété pendant l’inscription des deux acteurs | AUTH : consentement incomplet, quitter/reprendre | Quitter réellement le profil incomplet puis revenir non documenté. |
| A09 | Acteurs adultes fictifs uniquement | ADMIT, SDK | Mineurs et anniversaires limites non exercés par UI. |
| A10 | Consentement particulier des acteurs natifs | ADMIT, SDK | Hors Québec/professionnel et changement de source à rejouer par UI. |
| A11 | UI-P134–137 : ancien compte Dev déconnecté sans effacement ;347–349 : déconnexion explicite du compte synthétiqueA | AUTH, ENV, SESSION | A→B→A pendant upload non exécuté par ces gestes ; suiviC caché sousA317. |
| A12 | — | SESSION, AUTH | Révocation serveur puis reconnexion volontaire native non exécutées. |

### D — découverte et favoris

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| D01 | UI-I catalogue ; UI-A `v86-40` fiche publiée | DISCOVER, FAVORITE | Pagination longue/vide/erreur et mise à jour de stock non parcourues par UI. |
| D02 | UI-I `e7j-276..286/288/289` : corrigée accentué→annonce, Article QA→6, en de→aucun résultat ; RED Android `v86-81/84` ; UI-P `v86-132/220/222` résultat exact puis historique relu après index | DISCOVER : phrases/accents/mots courts25/25 | Retests nominaux documentés iOS/physique ; réponses concurrentes restent surtout automatisées. |
| D03 | — | DISCOVER | Filtres/reset complet et conservation retour à exercer. |
| D04 | — | VISUAL | Permission et vraie analyse image/cloud non exécutées. |
| D05 | Deux OS : sauvegarde, liste, suppression annulée puis confirmée ; iOS clocheON/OFF (`e7j-276..286`, `v86-86/90/92`) | DISCOVER : savedSearchService | Réception d’une alerte de nouveautés non validée ; aucun push déduit de la cloche. |
| D06 | UI-I `e7j-177` : favori B1 ajouté | FAVORITE | Invité, carte et détail ne sont pas tous rejoués. |
| D07 | **Cycle natif nominal complet rejoué** : réservé/favori1→annulation→disponible/favori1→nouvelle19CAD→réservé→fin B→Article vendu/favori0→Favoris vide (`e7j-303..351`) | FAVORITE, BK ; lot D07 final70/70 | Aucun retoggle entre états ; pas de paiement/remise physique prétendus. Les courses/erreurs restent couvertes séparément par tests ; aucun PASS collectif des117 IDs. |
| D08 | — | PROFILE | Profil public, suivre/ne plus suivre, inconnu et liste d’avis non parcourus. |
| D09 | UI-A `v86-42`, UI-I `e7j-262/264/265` : partage système, copier lien Dev | ENV | Réouverture du lien sur autre appareil/store non exécutée ; aucun destinataire contacté. |
| D10 | — | PROFILE ; HISTORICAL shopService21/21, dont17 public/admin et contrats payants/reprise explicites | Boutique réelle consultée sans forfait non exercée par UI ; tests payants à I/O simulées, aucune ouverture des rails. |

### L — annonce et brouillon

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| L01 | UI-I Vendre→auth puis capture ; UI-A tunnel Vendre | SELL | Toutes les entrées invité/connecté et lien direct non rejouées après correctif. |
| L02 | UI-I `e7j-68/76/83/85/86/88` ; UI-A `v86-9` ; UI-P vraie caméra/photo noire QA `v86-166..168` | SELL | Galerie privée fermée sans sélection sur téléphone ; ordre multi-photos et permissions limitées/retour exhaustifs non rejoués. |
| L03 | UI-I `e7j-91`, UI-A `v86-11` : saisie manuelle | SELL | Analyse IA explicite réussie/erreur/retard native non exécutée. |
| L04 | Deux OS : validation vide, catégorie précise, état, M US/L EU,20CAD,quartiers | SELL, FORMAT | Autres catégories/hygiène/saisie invalide et texte agrandi partiels. |
| L05 | UI-I `e7j-248/253..260` : vrai déplacement UUID, reprise photo/champs, Modifier→Détails, titre changé puis publication | SELL :55 draft +11 URI, SESSION | Reprise nominale corrigée et rejouée ; abandon et changement de compte restent surtout automatisés. |
| L06 | UI-I A1 publié ; UI-A `v86-39/40` B publié puis visible A ; UI-P C aperçu→upload→Annonce publiée→fiche `v86-191..194`, photo relue | SELL, BK | Réponse perdue et double publication testées automatiquement, pas par coupure réseau native. |
| L07 | — | EDIT | Édition native, conflit et hors ligne à exercer. |
| L08 | UI-I D07 après correction : réservé→disponible à annulation→vendu à fin, sans retoggle | EDIT, FAVORITE, BK | Marquer manuellement vendu/remettre en vente reste un autre geste non rejoué nativement. |
| L09 | — | EDIT, BK, RULES | Suppression native et réouverture ancien lien non documentées. |
| L10 | — | EDIT, ADMIT, SESSION | Édition étrangère et disponibilité changée non exercées par UI. |

### C — messagerie et offres

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| C01 | UI-I `e7j-180..186`, UI-A `v86-46/47` : demande contextualisée ; modal annulé avant envoi | CHAT, OFFER, SWAP contact | Tous les retours/entrées sans chat parasite ne sont pas rejoués. |
| C02 | Deux OS `e7j-189/192/197`, `v86-48..51` : textes exacts accentués ; UI-P `v86-211/212` envoi C/réponse A reçue, contrelecture serveur bornée | CHAT | Pagination ancienne et accusés de lecture exhaustifs non observés. |
| C03 | — | CHAT, nativeStorageUpload | Photo chat et échec/reprise par UI non exécutés. |
| C04 | UI-A `v86-53` acceptation annulée puis20CAD ; UI-I `e7j-325/340/341` refuse21>prix20, nouvelle19CAD avec note distincte puis acceptation | OFFER, MEETUP | Refus/expiration d’une offre reçue et vraie contre-offre restent distincts de la nouvelle proposition19CAD. |
| C05 | — | OFFER, SDK contention | Plusieurs offres/dossiers concurrents non exécutés par les écrans. |
| C06 | — | HELP, OFFER | Blocage bilatéral et déblocage UI non exécutés. |
| C07 | — | AUTH, ADMIT | Contact depuis profil incomplet et reprise UI non exécutés. |
| C08 | — | CHAT, SESSION, RULES | Chat étranger/déconnexion pendant lecture à contrôler sur appareil. |

### M — remise locale

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| M01 | UI-I lieu À convenir/MileEnd, montant20CAD, récapitulatif/envoi ; réception Android | OFFER, MEETUP | Autres lieux et retour avec modification non rejoués. |
| M02 | UI-A `v86-53`, UI-I `e7j-197/198` : acceptation et commande | MEETUP, SDK | Unicité serveur prouvée en SDK ; aucune autre réservation UI concurrente observée. |
| M03 | Deux fins croisées à3,969s ; autre accord19CAD terminé par B seul après RDV (`e7j-347/349/350`), vendu/favori0 ; UI-P C annule puis confirme sa fin seule `v86-227..231` | MEETUP, REVIEW, BK | Fin déclarée par un participant, aucune unanimité, remise physique ou paiement extérieur certifiés. |
| M04 | UI-I `e7j-317/319/320` : B annule l’accord20CAD, A retrouve article disponible et favori conservé | MEETUP, BK | Nominal natif observé ; réponse perdue/race d’annulation demeurent des tests séparés. |
| M05 | UI-A `v86-115/116` : formulaire ouvert, envoi désactivé sans faits, sortie sans émission | MEETUP, ADMIN, BK | Pas de récit réellement enregistré, deux versions et décision admin UI non exécutées. |
| M06 | — | SDK : deux acheteurs en acceptation concurrente | La course UI observée concernait deux fins du **même** accord ; ce n’est pas une course de deux acheteurs. |
| M07 | — | MEETUP, OFFER, BK | Perte réelle de réponse après émission et reprise native non provoquées. |
| M08 | — | ADMIT, HELP, SDK, RULES | Soi-même/vendu/bloqué/mineur/session contrôlés par tests, pas tous nativement. |

### S — troc local et postal manuel

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| S01 | Catalogue Troc chargé sur les deux OS ; UI-A lien inconnu `/swap` refusé puis `/swap-zone` chargé | SWAP : filters/catalogue/vide | Filtres/vide et ancien item devenu indisponible non parcourus complètement. |
| S02 | UI-I `e7j-270..274` dépôt A1 ; UI-A `v86-77` dépôt2 puis propre section, réservation exclue ; UI-P C dépôt relu puis retrait confirmé/absence `v86-252..258` | SWAP, SDK engagement | Pas de contrat Troc engagé avec C ; annulations/retours concurrents restent automatisés. |
| S03 | — | SWAP : sélection/catalogue |20 articles, retour et modifications de sélection natifs non exercés. |
| S04 | UI-I `e7j-268/269` : Québec décoché, Continuer désactivé, confirmation explicite | SWAP, ADMIT, SDK | Refus mineur/professionnel/hors Québec par UI non exercés. |
| S05 | UI-I `e7j-353..368` : A1 contre B-local,20CAD chaque côté, arrangement local QA, sans complément ; conditions lues, case décochée/submit fermé puis confirmation et envoi | SWAP : proposition/conditions, CLOSED | Proposition envoyée et en attente de B ; acceptation/préparation/réceptions ne sont pas déduites de ce succès. |
| S06 | UI-I/B `e7j-374..376` : B lit et accepte les conditions exactes A1↔B-local ; `e7j-424` : les deux images sont relues après correction DTO serveur | SWAP, BK | Refus, conditions remplacées et négatifs de stock restent automatisés ; aucune réception physique prétendue. |
| S07 | UI-I/B `e7j-388/389/392/397/399/400` : A annule d’abord « Pas encore », puis déclare reçu et attend B ; B déclare reçu, les deux lisent Échange terminé | SWAP, BK | Parcours local exécuté entre acteurs synthétiques ; ne prouve pas une remise physique. |
| S08 | UI-I/B `e7j-443..454` contrat postal proposé/accepté ; nouveau picker Android sélection locale→Envoyer explicite `e7j-474/475` ; deux envois/deux réceptions→Échange terminé `e7j-478..500` ; deux preuves privées relues `e7j-506/507`, aussi capturées par Expo MCP officiel | SWAP, BK photos/états postaux, RULES | Nominal postal manuel terminé avec acteurs/fixture QA, aucun colis/paiement physique. Le nouveau picker à deux appuis n’a pas été rejoué sur iOS après changement ; preuve Android et tests composés distincts, ancien picker iOS avait réussi. |
| S09 | UI-I/B `e7j-454/476/477` : aucune réception proposée avant les photos/envoi adverse ; B annule un premier dialogue d’envoi puis le confirme | SWAP, BK, RULES | Remplacement des termes et autres erreurs de photo restent automatisés ; absence d’un CTA anticipé n’est pas un essai de RPC hostile natif. |
| S10 | — | SWAP | Annuler/refuser avant acceptation puis absence de cancellation après acceptation non exécutées nativement. |
| S11 | — | SWAP, ADMIN, BK | Litige des deux acteurs et dossier admin par UI non exécutés. |
| S12 | — | SWAP, SESSION | Réponse inconnue et compte remplacé en plein troc non exécutés nativement. |

### R — avis et données publiques

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| R01 | UI-A `v86-66/68` :5étoiles/commentaire/confirmation ; avis distinct A signalé ; UI-P C `v86-234..239` étoiles/commentaire QA→Avis laissé | REVIEW | Doublon forcé et commentaires invalides réels non exercés. |
| R02 | — | REVIEW, RULES | Prématuré/étranger testés ; expiration/inconnu natifs et preuve serveur d’unicité à exécuter. |
| R03 | UI-I/B `e7j-404/405` : après double réception locale, A et B envoient5étoiles et lisent Merci ; aucun CTA de doublon | SWAP présentation/rating partiels | Les deux avis ont été enregistrés sur le troc local synthétique ; doublon forcé/erreur et avis postal restent distincts. |
| R04 | UI-A `v86-66` : nom public du pair affiché | PROFILE, REVIEW | Changement nom/avatar et masquage public propagés non exécutés nativement. |

### P — compte et confidentialité

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| P01 | UI-A `v86-94` : bio synthétique modifiée, succès ; UI-P C `v86-242..244` bio sauvegardée et relue | PROFILE, SELL upload natif simulé | Avatar et propagation au pair non exécutés par ces seuls passages. |
| P02 | UI-P328–331 : M+L EU et pointure38 choisis, succès puis réouverture et vérification visuelle | PROFILE : merge des préférences | Marques, localisation et variantes de système restent distinctes. |
| P03 | UI-A `v86-97/99` :123refusé, numéro fictif canadien formaté et sauvegardé ; écran indique coordonnée de contact | PROFILE : écriture ordinaire du téléphone | Aucun SMS ni méthode vérifiée de connexion/récupération revendiqués. |
| P04 | UI-P319–326 : autocomplétion vivante, adresse commerciale publique fictive pourA, sauvegarde puis relecture | ADDRESS | Fournisseur précis non déduit de l’UI ; saisie manuelle et refus concurrent restent couverts séparément. |
| P05 | — | Pas de test ciblé de route e-mail identifié ; AUTH ne suffit pas | Réauth récente, changement e-mail, lien réel et révocation de l’ancien e-mail à exercer. |
| P06 | — | ERASURE/Google reauth ne prouvent pas le changement d’e-mail social | Fournisseur social réel et e-mail modifié **NON VALIDÉS**. |
| P07 | — | AUTH providers uniquement, pas de route mot de passe ciblée identifiée | Changement/liaison, mauvaise réauth et reprise native à exercer. |
| P08 | UI-P340–345 : usage1→0 ; marketing accordé puis retiré, date native et retrait relus après réouverture | V analytics6, AUTH consentements, PROFILE | Aucun email marketing livré ni collecte réelle déduit du choix ; QA globalement fermée. |
| P09 | — | Aucun test ciblé export privé identifié dans les campagnes app | Produire/exporter/lire avec le seul propriétaire ; tiers refusé ; contenu privé à contrôler. |
| P10 | UI-I `e7j-292/293/294` : pause présentée dans la fermeture, aucune action envoyée | Aucun test ciblé route pause identifié | Pause effective puis reprise, refus de nouveaux actes et maintien des obligations à exercer. |
| P11 | **PASS scénario physiqueC** : demande0abd confirmée après mot de passe276/277 ; lecteur75b4 après deux redémarrages293/296/300 montre7/7 et accès fermé, profil invité295/299 | ERASURE ; IPHONE_FINAL_RETEST.json ; BACKEND_ERASURE_NATIVE_POSTCONDITIONS.json | Deux effacements backend et8absences réelles ; pas de clic manuel sur le CTA de déconnexion après fermeture car session déjà invitée. Apple réel reste distinct. |
| P12 | Deux comptes synthétiques avec accords cash/postal terminaux réellement effacés7/7 ; preuves minimales privées et pairs préservés | ERASURE, BK rétention/médias ; BACKEND_ERASURE_NATIVE_POSTCONDITIONS.json | Un dossier encore ouvert avec obligations actives n’est pas certifié par ces deux contrats terminaux. |
| P13 | — | SESSION n’est pas une preuve de sécurisation/reprise métier | Confinement/révocation/reprise volontaire et session ancienne à exercer. |
| P14 | UI-P317 : identitéA ne découvre pas le suivi privé du compteC effacé ; aucun mélange de reçu | SESSION, ADMIN relation propriétaire/GET | Garder/pauser une relation entre comptes par UI reste distinct de cette isolation. |

### N — notifications et liens

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| N01 | — | NOTICE, PROFILE | Préférences notifications native/persistance à exercer. |
| N02 | UI-I : permission OS refusée | NOTICE | Permission accordée et **réception push sur appareil physique NON VALIDÉES**. |
| N03 | UI-A badge chat puis notification de fin unique | NOTICE | Clic de chacune des cibles chat/article/commande/recherche/troc non exécuté. |
| N04 | — | HELP, NOTICE | Notification de support privé à ouvrir avec identité exacte, compte tiers refusé. |
| N05 | UI-A `v86-46` : lien chaud Messages | NOTICE, ENV, SESSION | Liens froids, changement de session et destinations multiples non parcourus. |

### H — aide, support et signalements

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| H01 | — | HELP | Article/profil/avis/message exacts et doublons à signaler par UI. |
| H02 | UI-A `v86-106/108` : demande synthétique enregistrée une fois, résultat actualisé puis acquitté sans renvoi | HELP | Réponse opérateur et reprise après vraie réponse réseau perdue non exécutées. |
| H03 | — | RULES ; pas de route documentaire complète qualifiée ici | Dossiers privés modération/confidentialité/produit avec accès membre/admin non parcourus. |
| H04 | — | HELP partiel | Aide compte perdu et ouverture mailto sans envoi non exécutées. |
| H05 | UI-P293/296/300 : suivi7/7 accessible déconnecté après deux redémarrages ; aucun nouvel envoi d’intention | ERASURE ; IPHONE_FINAL_RETEST.json | Retour navigateur fournisseur réel reste à valider ; observer n’est pas reprendre une mutation. |
| H06 | UI-I : intitulé de demande d’effacement et destination cohérents `e7j-292..294` | Aucun test ciblé complet pages légales/hors ligne identifié | Pages légales/retour/hors ligne et équivalent Android restent à parcourir. |

### Z — administration

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| Z01 | — | ADMIN, SDK, RULES | Entrée non-admin puis retrait de rôle pendant lecture native non exécutés. |
| Z02 | — | HELP, ADMIN partiel | File signalements et modération avec vraies sources par UI non parcourues. |
| Z03 | — | HELP, RULES partiel | Support/admin accès compte et réponse adressée natifs non exécutés. |
| Z04 | — | ADMIT, SDK, ADMIN | Admission native émulateur prouvée ; fraude/produit opérateur non qualifiés collectivement. |
| Z05 | — | ADMIN cash preview/note/consentement ; SWAP décisions documentaires | Deux versions du litige puis classement opérateur UI non exécutés. |
| Z06 | — | Pas de scénario opérateur incident complet identifié dans les lots verts | Incident confidentialité privé, rôle et absence d’effacement intempestif à exercer. |
| Z07 | — | ADMIN boutique, CLOSED banques/transport ; HISTORICAL133/133 | Consultations admin banque/transport/taxe sans nouvel acte non parcourues nativement ; les47 anciens RED unitaires sont réparés, pas transformés en gestes UI. |

### F — rails fermés et historique

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| F01 | Deux OS remise seule ; UI-I `e7j-301/302` lien shipping d’annonce locale→choix local sans commande, configuration paiement désactivée | ENV, CLOSED, OFFER zéro nouveau RPC shipping | Autres paramètres de liens et états historiques non parcourus exhaustivement. |
| F02 | Modalité manuelle seule sur les annonces créées | CLOSED : shippingListingEnvironment | Annonce historique expédiable refusée sans repli remise à exercer. |
| F03 | UI-I `e7j-297` : portefeuille vide, activation/nouveaux paiements fermés, consultation/support disponibles | CLOSED ; HISTORICAL wallet13/13, cents/journaux/refus/reprise vérifiés | Anciens soldes/retraits non rejoués nativement ; restitution positive du petit solde de fermeture non qualifiée. |
| F04 | UI-I `e7j-302` : nouvelle configuration paiement désactivée, Actualiser/Support seuls | CLOSED : KYC/banque lectures ; fixtures phase2 explicites | Banque historique/taxes restent non parcourues ; Google reauth bancaire simulée n’est pas OAuth réel. |
| F05 | — | CLOSED ; HISTORICAL tracking19/19 avec services/journaux/recours réels et I/O simulées | Ancienne commande/étiquette sans nouvelle création non exécutée par UI ; aucun transport ou remboursement réel déduit des tests. |
| F06 | Profil QA ferme ces fonctions ; pas de geste d’achat | ENV, CLOSED : Square/profile ; HISTORICAL shopService21/21 | Boutique forfait et Square liens directs à exercer nativement ; achat/reprise de forfait qualifiés seulement à I/O simulées sous flags phase2 explicites. |
| F07 | — | CLOSED, SWAP présentation historique | Soulte historique lisible/nouvelle zéro par UI non exécutée ; garde source seule non élevée en preuve native. |

### T — transversal

| ID | UI constatée | Automatisé | Limite restante |
| --- | --- | --- | --- |
| T01 | — | SESSION, SELL, CHAT, DISCOVER erreurs simulées | Réseau réellement coupé avant lecture/envoi puis rétabli non testé. |
| T02 | — | SELL, EDIT, OFFER, MEETUP, SWAP journaux | Perte réelle de réponse après commit non provoquée nativement. |
| T03 | UI-A `v86-53` annuler/rouvrir ; deux fins à3,969s d’écart | OFFER, MEETUP, SWAP, SESSION | Ne prouve pas toutes les courses ; anciennes closures de formulaire corrigées par tests, à rejouer en UI. |
| T04 | — | EDIT, CHAT, SWAP, REVIEW, RULES | Entité disparue/étrangère et lien devenu inaccessible à parcourir sur appareil. |
| T05 | UI-A refresh du JWT→publication après correction | AUTH, SESSION, SELL, REVIEW | A→B→A et changement pendant upload/envoi non exécutés sur le même appareil. |
| T06 | iOS caméra refusée ; deux pickers avec seule photo QA | SELL, VISUAL | Retour Réglages OS, caméra accordée, photothèque limitée/révoquée exhaustifs non testés. |
| T07 | Deux tailles M US/L EU et20CAD ; chat accentué reçu exactement | FORMAT, ADDRESS | Dates/contact/tous formats canadiens non qualifiés par ces seuls exemples. |
| T08 | — | ADMIT :19 contrôles âge/anniversaire/Toronto | Changer DOB et date limite en parcours natif non exécuté. |
| T09 | Clavier/saisie normaux ; UI-I `e7j-266` retour fiche→Accueil ; catégories/offre AX après correction `e7j-379/382` ; UI-P auth champs `v86-143/144` puis saisie/publication complète | FORMAT, SWAP fontScale ; contrats wrappers a11y du lot137 | Texte OS agrandi et lecteur d’écran **NON VALIDÉS nativement**. L’arbre AX exposé ne prouve pas une session VoiceOver/TalkBack. |

## État des parcours et limites de clôture

1. **Trocs local et postal nominaux exécutés** (S06–S09/R03). Local : deux conditions acceptées, deux réceptions déclarées et deux avis5étoiles (`e7j-374..405`), média adverse relu après correction DTO (`e7j-424`). Postal : contrat exact, photos, deux envois/deux réceptions et fin sur les deux OS (`e7j-443..500`), preuves privées relues (`e7j-506/507`). Le nouveau picker explicite Android est rejoué ; sa variante iOS actuelle reste couverte par composition seulement. Annulation/refus, litige et reprise inconnue S10–S12 gardent leurs limites. Aucun colis ni remise physique n’est prétendu.
2. **D07 nominal est fermé par revalidation native**, avec les échecs initiaux conservés dans les rapports : réservé/favori conservé→annulation/disponible→nouvelle19CAD→réservé→fin B→vendu/favoris0. Les IDs précis sont dans NATIVE_IOS `e7j-317..351`, sans retoggle ni argent/remise physiques.70 contrôles ciblés couvrent aussi caches de fiche/liste, erreur, ancienne closure et réponses tardives. Ce point ne doit plus rester listé comme blocage nominal ; D02 et L05 ont également leurs revalidations natives positives.
3. **Effacement serveur et contrôle physiqueC terminés** (P11/P12/H05). Deux intentions7/7 et Auth/profils absents ; après reconnexion, lecteur75b4 et deux vrais redémarrages293/296/300 montrent7/7 en invité. Vrai lateEvent et génération absente, preuves privées minimales et pairs préservés. Aucun faux succès du harness interrompu. Apple/Google réels ne sont pas déduits de ce scénario mot de passe.
4. **Routes sensibles et compléments support/admin restant à qualifier** : A05, P05–P10/P13–P14, H01/H03–H06, réponses opérateur de H02, Z01–Z07 et autres états historiques gardent leurs limites par ID. Des lectures et nominaux partiels sont maintenant documentés, sans devenir des mutations réellement exécutées. L’absence de preuve ne démontre pas un bug, mais interdit une recette complète. Les gros sous-ensembles fonctions encore rouges ne sont pas déclarés globalement hors V1.

Les deux effacements synthétiques et le dernier contrôle physiqueC sont vérifiés. Les autres limites parID restent distinctes ; aucune réussite collective des117 variantes n’est annoncée.

## Tests adaptés aux trous identifiés

| Priorité | Test à effectuer/ajouter | Preuve attendue |
| --- | --- | --- |
| Régression conservée / complément | Local et postal manuels nominaux jusqu’aux deux réceptions ; compléter conditions remplacées/litige et nouveau picker iOS | Nominaux documentés sur les deux rôles/OS ;14 tests de route bornent la sélection locale et la nouvelle capture. Aucun scan transporteur ni remise physique fictifs. |
| Régression conservée | Nouvelle annonce réservée, annulée puis nouvelle19CAD et fin, sans retoggle du favori | **Cycle natif nominal rejoué** `e7j-303..351` ; favori1 pendant réservation/annulation, vendu/favori0 après fin déclarée. |
| Régression conservée | Reprendre un brouillon iOS dont seul le conteneur a changé, puis Modifier | **Nominal rejoué** `e7j-248..260`. Les5 intégrations couvrent aussi fichier absent/dossier, compte remplacé et champs concurrents. |
| Régression conservée | Rechercher une vraie annonce avec une phrase contenant en/QA, puis accents/ponctuation et seuls mots courts | **Retest nominal iOS documenté** Article QA→6, corrigée→annonce, en de→aucun ;7 contrôles utilisent le vrai indexeur serveur. |
| Haute | RNTL des vraies routes reset/e-mail/mot de passe/pause/export, sans mock du guard | Mauvaise réauth/retour fournisseur tardif/session remplacée : zéro mutation ; succès exact puis refresh normal ; pas de détail permettant d’énumérer un compte. |
| Haute | Contrats reset et changement d’e-mail sur Auth Emulator, puis lien e-mail réel avec boîte contrôlée | Lien single-use/expiré et identité nouvelle prouvés ; l’émulateur ne suffit pas à prouver la délivrabilité. Aucun envoi à un tiers. |
| Haute | Support/signalement et litige cash/troc avec membre puis admin, rôle révoqué au milieu | Référence exacte, deux versions visibles, pas d’accès tiers, décision documentaire et avis adressé ; pas de succès financier inventé. |
| Haute, qualification en cours | Poursuivre l’effacement des seuls comptes synthétiques après l’accord ciblé reçu et avec qualification actuelle | Réauthentification/demande/relecture après redémarrage déjà exécutées sur C ; fermeture et fin restent à qualifier. Auth absent uniquement quand postconditions réelles réunies ; retained/awaiting_review restent explicites. |
| Complément | Parcours guest/recherche/filtres/sauvegarde/public profile/follow, offline et liens froids | Captures avant/après avec état stable et source ; les mocks existants restent des preuves distinctes. |
| Externe | Google/Apple, push, Maps signature store, texte agrandi/lecteur d’écran | **NON VALIDÉS** jusqu’à exécution avec configuration et appareil appropriés. Une vraie recette iPhone physique est désormais documentée séparément ; aucune capture simulée ne la remplace. |

## Vérification app : historique0abd, lecteur75b4, finale0454

Les empreintes ne sont pas interchangeables. Sur0abd : typecheck app/frontières0, Vitest329/329, lot critique137/137 en sortie normale et inventaire complet2092PASS/47FAIL/0ignoré dans219 suites/2139tests. Le run transitoire2082PASS/55FAIL conserve les huit erreurs initiales de fixture du nouveau test postal ; après correction, le multiensemble des47 échecs correspondait exactement à l’inventaire7. Ces anciens rapports restent inchangés.

Le delta lecteur75b4 a ensuite son propre lot **8 suites/114 tests**, sortie normale, TSC app/frontières0. Il couvre les pertes de portée des deux routes d’observation et les callbacks du listener ; les écritures restent attribuées à0abd. Le root a confirmé séparément le retest P11physique75b4 ; ses preuves natives/serveur ne sont pas produites par ces assertions.

Après GO du root, les sept suites historiques ont été réparées avec les contrats actuels : **133/133**, anciens122 contrôles conservés/migrés et11 ajouts, sans skip ni modification runtime dans ces domaines. Le [mapping47](HISTORICAL_47_TRIAGE.md) conserve les négatifs et indique les différences de présentation/protocole. Le correctif Auth0454, indépendant, ajoute la clé de remontage du formulaire ; ses six contrôles sont inclus dans le lot d’intégration **139/139 dans9 suites**, sortie normale (`historical-seven-final.json`).

Sur le gel final0454, une seule globale finale a été lancée après stabilisation de tous ces fichiers. **222/222 suites,2179/2179 tests,0 échec,0 ignoré**, sortie normale0 en78,319s avec `--detectOpenHandles`, sans `--forceExit`. Aucun test modifié pendant cette campagne. Les inventaires historiques avec `--forceExit` ne prouvaient pas cette sortie ; la dernière commande la constate sans modifier la configuration.

Commandes finales0454 :

```bash
npx tsc --noEmit
npm run lint:boundaries
npx vitest run --reporter=json --outputFile=/tmp/seconde-v1-jest-repair/phase1-final0454-vitest.json
npx jest --runInBand --watchman=false --detectOpenHandles --json --outputFile=/tmp/seconde-v1-jest-repair/phase1-final0454-jest.json
```

App et frontières sortent0 ; Vitest329/329 dans31 fichiers sort0. Le typecheck étendu des tests reste à104 diagnostics hérités (`historical-final2-tsc-tests.log`), aucun dans les sept fichiers réparés ni leur helper ; ce contrôle est distinct du typecheck app standard. Les résultats natifs des trocs et du téléphone proviennent des rapports root/RN, sans extrapolation des tests de composants.

## Bornes de la conclusion

Cette consolidation ne déclare pas117 parcours natifs PASS. Elle distingue les sous-parcours observés, la couverture automatisée et ce qui reste à exécuter. **La globale Jest finale est entièrement verte :2179/2179,0 ignoré,222 suites et sortie normale**, avec les47 anciens échecs réparés par leurs contrats actuels. Le typecheck étendu conserve104 diagnostics hérités hors typecheck app standard ; la restitution positive du petit solde et les limites natives/fournisseurs/stores restent explicites. Voir JEST_REPAIRS et le mapping HISTORICAL_47_TRIAGE, sans assimiler toutes les lignes financières à des parcours fermés.

Globale fonctions :1634 PASS/1061 FAIL/186 SDK non activés dans le run unitaire ; run SDK intégral activé :26 PASS/160 FAIL/0 ignoré. Ces nombres appartiennent au rapport backend et ne sont remplacés ni par les32 SDK cœur verts ni par les386 ciblés. Aucun résultat passé de Prod ou d’une autre source ne ferme une ligne de cette campagne actuelle.

JOURNEY_MATRIX.md, NATIVE_ANDROID.md, NATIVE_IOS.md et NATIVE_IPHONE.md n’ont pas été modifiés par cette consolidation. Aucun déploiement, mutation cloud, commit ou push par son auteur.
