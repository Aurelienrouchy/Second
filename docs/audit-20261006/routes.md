# Matrice des routes — code final

Les 76 fichiers TSX sous `app/` sont inventoriés ci-dessous, layouts inclus. Tous relèvent du typecheck app et des bundles iOS/Android. Cette compilation ne prouve ni une lecture manuelle de chaque écran ni un parcours utilisateur complet. Les suites citées vérifient les unités/contrats indiqués, pas toute la route.

**Pour chaque ligne : E2E appareil, rendu visuel et captures non exécutés**, faute de Maestro/ADB/Xcode/appareil. Les tests Firebase Rules sont ajoutés mais bloqués par le téléchargement officiel de l’émulateur.

| Fichier | Parcours | Examen attesté | Correction | Preuve ciblée / limite |
| --- | --- | --- | --- | --- |
| `app/(tabs)/_layout.tsx` | Navigation/layout | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/(tabs)/favorites.tsx` | Favoris | Hook/compteur associés seulement | Source canonique et accusé optimiste | Jest favoris + Functions trigger |
| `app/(tabs)/index.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/(tabs)/messages.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/(tabs)/profile.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/(tabs)/sell.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/+not-found.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/_layout.tsx` | Navigation/layout | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/admin/_layout.tsx` | Navigation/layout | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/admin/disputes.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/admin/reports.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/admin/shop-detail/[id].tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/admin/shops.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/article/[id].tsx` | Articles / offres | Oui, entrée offre et composants associés | Galerie, proposition commune | Jest galerie/services et Functions offres |
| `app/article/edit/[id].tsx` | Édition article | Service/callable associés seulement | Champs serveur protégés, médias promus, verrou engagement | Jest articleService + Functions products/media ; rules non exécutées |
| `app/chat/[id].tsx` | Conversation | Oui, sections offre/header | Header, propositions, réponses | Jest service/modal + Functions transitions |
| `app/checkout/_layout.tsx` | Navigation/layout | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/checkout/index.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/checkout/meetup.tsx` | Commande locale | Oui | Proposition → récapitulatif → envoi | Jest contrats + Functions meetup ; YAML seulement |
| `app/checkout/shipping.tsx` | Livraison | Contrat serveur seulement | Nouvelles opérations fermées | Functions guards ; interface non validée |
| `app/checkout/success.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/complete-profile.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/index.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/legal/_layout.tsx` | Navigation/layout | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/legal/privacy-policy.tsx` | Politique confidentialité | Composant partagé seulement | Libellé pseudonyme cohérent | Relecture composant ; aucun avis juridique |
| `app/legal/terms.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/liked-sellers.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/my-articles.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/my-orders.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/my-sales.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/my-swaps.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/notifications.tsx` | Centre notifications | Hook/transport associés seulement | Transport iOS et consentement notifications | Jest hook/auth + Functions Expo/transport |
| `app/onboarding.tsx` | Onboarding | Référentiels associés seulement | Tailles partagées app/functions | Tests référentiels/auth ; parcours complet non vérifié |
| `app/payment/[transactionId].tsx` | Paiement | Contrat serveur seulement | Checkout, compensation et garde financière | Functions finance ; écran non audité intégralement |
| `app/propose-swap.tsx` | Proposer un troc | Contrat serveur seulement | Supplément fermé pendant MVP | Functions phase ; écran non audité intégralement |
| `app/review/[transactionId].tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/saved-searches.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/search.tsx` | Recherche | Oui, état recherche et continuation | Pagination et boutique → vendeur | Jest pagination/hook/scope boutique |
| `app/sell/_layout.tsx` | Navigation/layout | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/sell/capture.tsx` | Vente / caméra | Oui | Sessions caméra, erreurs, torche, photos | Jest capture/hook ; caméra native non vérifiée |
| `app/sell/details.tsx` | Vente / détails | Oui | Matières A–Z, paires de photos, brouillon | Jest vente + Vitest référentiels |
| `app/sell/photos-review.tsx` | Vente / photos | Oui | Réordre quelconque et persistance | Jest photos/brouillon + Vitest réordre |
| `app/sell/preview.tsx` | Publication | Service/callable associés seulement | Promotion médias et garde publication | Jest articleService + Functions media ; écran non vérifié |
| `app/sell/pricing.tsx` | Vente / prix | Oui | Reprise de photos et brouillon | Jest reprise prix/brouillon |
| `app/settings/_layout.tsx` | Navigation/layout | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/about.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/add-password.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/address.tsx` | Adresse | Oui | Validation commune autocomplete/manuelle | Vitest adresse |
| `app/settings/bank-account.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/blocked-users.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/delete-account.tsx` | Suppression compte | Callable/tests associés seulement | Fixtures auth alignées ; contrat consentement après suppression | Functions gates existantes ; aucune suppression réelle |
| `app/settings/email.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/export-data.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/help.tsx` | FAQ | Oui | Texte cohérent avec MVP local gratuit | Relecture/types/lint ; pas de test visuel |
| `app/settings/index.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/legal-notice.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/notifications.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/password.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/phone.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/preferences.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/privacy-policy.tsx` | Politique confidentialité | Composant partagé seulement | Libellé pseudonyme cohérent | Relecture composant ; aucun avis juridique |
| `app/settings/privacy.tsx` | Consentement | Oui | Refus immédiat et persistance explicite | Tests analytics/auth/services |
| `app/settings/profile-details.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/shipping-options.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/stripe-onboarding.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/terms.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/settings/verify-email.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/shop/[id].tsx` | Boutique | Oui, lien articles et forfait | sellerId explicite, entrée payante masquée | Jest scope boutique ; navigation tactile non vérifiée |
| `app/shop/upgrade.tsx` | Forfait | Oui | Accès direct indisponible pendant MVP | Relecture + Functions garde financière |
| `app/swap/[id].tsx` | Troc / preuves | Oui, upload de preuves | Chemin UID/participants, immutabilité | Tests rules ajoutés non exécutés ; Functions guards |
| `app/swap-parties.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/swap-party/[id].tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/swap-zone.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/user/[id].tsx` | Profil public | Oui | Photos, liste conservée, erreurs explicites | Jest profil/onglets/grille ; callable images |
| `app/visual-search-results.tsx` | Autre route | Inventaire + compilation ; revue manuelle intégrale non attestée | Aucune correction ciblée dans cet écran | Types/bundles seulement ; suites existantes selon leur propre périmètre |
| `app/wallet.tsx` | Wallet | Contrat serveur seulement | Nouveaux retraits/spend fermés ; payout inconnu réservé | Functions finance/wallet ; écran non audité intégralement |
