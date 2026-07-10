# Implémentation

> Cette section précède le catalogue (source de vérité du plan de tracking). Elle décrit *comment* le tracking est câblé dans le code ; le catalogue décrit *quoi* tracker.

## Où vit le code

| Fichier | Rôle |
|---|---|
| `config/posthogConfig.ts` | Clé projet (`EXPO_PUBLIC_POSTHOG_API_KEY`) + host (`EXPO_PUBLIC_POSTHOG_HOST`, défaut PostHog Cloud US). Clé absente ⇒ analytics désactivés silencieusement (aucun fallback). |
| `types/analytics.ts` | `AnalyticsEvents` — map exhaustive typée de TOUS les événements client. `ServerAnalyticsEvents` — événements serveur (documentaire, émis par `posthog-node` dans les Cloud Functions). `UserTraits` — user properties non-PII. |
| `lib/analytics.ts` | Singleton PostHog (couche *shared* : n'importe que depuis `config/` et `types/`). API : `initAnalytics`, `track`, `trackScreen`, `identifyUser`, `resetAnalytics`, `setAnalyticsEnabled`. Tout est fire-and-forget, jamais de throw. |
| `hooks/useScreenTracking.ts` | Hook global (couche *core*) monté une fois dans le root layout : envoie une vue d'écran PostHog avec le **pattern** de route Expo Router à chaque changement de route. |
| `app/_layout.tsx` | `initAnalytics()` au démarrage + `useScreenTracking()` dans `GlobalListeners`. |
| `store/authStore.ts` | `identifyUser` à l'hydratation auth (point unique) et `resetAnalytics` à la déconnexion — au niveau listener, jamais dans les écrans. |
| `app/settings/privacy.tsx` | Toggle « Données d'utilisation » (consentement Loi 25, modèle opt-out) câblé sur `setAnalyticsEnabled`. |

## Ajouter un événement

1. L'ajouter d'abord au **catalogue** ci-dessous (nom `objet_action` au passé, propriétés `snake_case`, montants en cents CAD).
2. L'ajouter à `AnalyticsEvents` dans `types/analytics.ts` (propriétés optionnelles quand le catalogue les marque optionnelles).
3. Appeler `track('nom_evenement', { ... })` depuis un **handler / effect / service** — jamais dans le corps du render, jamais `await` côté UI. `track` est typé : tout nom absent de la map est une erreur de compilation.

## Règle no-PII (Loi 25)

Jamais en propriété d'événement : email, `displayName`, @pseudo (→ `username_length`), date de naissance (→ `age_band`), adresse au-delà de province + FSA, numéro de téléphone, numéros bancaires, URI de documents KYC, contenu de messages/descriptions (→ `*_length` / `has_*`). Le seul identifiant humain autorisé est `username`, et **uniquement** en user property (jamais sur un événement). `distinct_id` = uid Firebase.

## Consentement

Modèle **opt-out** (activé par défaut). Le toggle « Données d'utilisation » dans Confidentialité appelle `setAnalyticsEnabled(bool)` qui persiste le choix (AsyncStorage) — pour survivre au redémarrage avant hydratation — et applique `optIn`/`optOut` PostHog. Le choix persisté est réappliqué dans `initAnalytics` avant toute hydratation auth.

---

# analytics-events.md — Catalogue d'événements PostHog · Second

> **Statut** : spécification à committer — source de vérité du plan de tracking.
> **Périmètre** : app Expo/RN (client, `posthog-react-native`) + Cloud Functions (server, `posthog-node`).
> **Base** : cartographies exhaustives des 7 domaines (auth-onboarding, home-search, article-sell, checkout-payment, chat-notifications, profile-settings, swapzone), vérifiées dans le code réel. Version finale après critique adversariale (couverture, nommage, PII, doublons, jointures, funnels).

---

## 1. Convention de nommage & règles globales

### Nommage
- **Événements** : anglais, `snake_case`, format `objet_action` au **passé** : `article_viewed`, `checkout_started`, `offer_sent`, `search_performed`. Quand l'événement capte un résultat pouvant être négatif (échec, annulation, refus), le nom est neutre (`*_checked`, `*_picked`, `*_submitted`) et l'issue vit dans une prop `result`/`outcome` — jamais un nom qui affirme un succès non garanti.
- **Propriétés** : `snake_case`, anglais. Montants **toujours en cents CAD** (`_cents`, int). Devise implicite : CAD.
- **Un événement, plusieurs surfaces** : les doublons inter-écrans sont fusionnés en UN événement portant `source` / `screen` (ex. `article_favorited` depuis home, recherche, fiche ou favoris = 1 événement).
- **Vocabulaire `source` unique** : les surfaces home sont toujours nommées `home_new_arrivals`, `home_pour_toi`, `home_price_drops`, `home_discover` — le même enum sur tous les événements qui les référencent (`article_card_tapped`, `article_favorited`, …). Jamais de synonymes (`home_rail`, `discover`).
- **Clés de jointure** : l'id d'un article est **toujours** `article_id`, d'une transaction `transaction_id`, d'un swap `swap_id`, d'un chat `chat_id`, d'un message `message_id` — mêmes noms sur tous les événements, client et serveur.
- **Side** : `client` = SDK RN dans l'app ; `server` = `posthog-node` dans les Cloud Functions (source de vérité financière, `$insert_id` = id métier pour l'idempotence).
- **Domaine propriétaire unique** = l'équipe/PR qui instrumente. Pour un composant/hook partagé, le domaine le plus proche du métier possède l'événement, les autres domaines l'appellent avec une prop de contexte. Décisions notables :
  - `MakeOfferModal` + `OfferBubble` (offres, contre-offres, cycle meetup) → **chat-notifications** (la négociation vit dans le chat). Le meetup direct depuis /checkout passe par la même offre chat → `offer_sent(source=checkout_direct)` : UN seul flux d'offres, pas d'événement parallèle côté checkout.
  - `ShipmentTracking` (suivi, recours, décisions automatisées) → **checkout-payment** (métier transaction/livraison), bien que rendu dans le chat.
  - `ReportBottomSheet` (signalement article/user/message) → **chat-notifications** (modération).
  - Favoris (`hooks/useFavorites.ts`) → **article-sell** (point canonique de mutation).
  - Suivi vendeur (`hooks/useSellerLikes.ts`) → **profile-settings**.
  - `StripePayment` (Payment Sheet headless partagé) → **checkout-payment**, prop `source` (`checkout|payment|shop_upgrade|swap_topup`).
  - Onboarding Stripe Connect / compte bancaire / KYC → **checkout-payment** (rail financier), même si les écrans vivent sous `settings/`.
  - Permission OS notifications → **chat-notifications** exclusivement (`push_permission_requested`) ; le helper transverse `permission_denied` ne couvre QUE caméra et photos (un seul propriétaire par permission).

### Identité
- `distinct_id` = **uid Firebase**. Jamais le @pseudo, jamais l'email.
- Invité : `distinct_id` anonyme PostHog + `guest_session_started`.
- Au `signup_completed` : `posthog.alias(uid)` pour merger l'historique invité → user (miroir de l'authMergeService).
- Au `user_signed_out` : `posthog.reset()`.

### PII — interdictions absolues (Loi 25)
Jamais en propriété d'événement : email, displayName, @pseudo (→ `username_length` seulement), date de naissance (→ `age_band` dérivé), contenu des messages/descriptions/commentaires (→ `*_length`, `has_message`), adresse au-delà de **province** et **FSA** (3 premiers caractères du code postal) — ni ville, ni rue, ni code postal complet —, numéros bancaires transit/institution/compte (→ nom du champ en échec seulement), URI de documents KYC, numéro de téléphone.

**Exception assumée — @pseudo** : le @pseudo est un identifiant *public*, choisi par l'utilisateur pour être affiché à tous dans l'app. Décision arbitrée : il est stocké **uniquement** en user property `username` (pour retrouver un profil dans PostHog), **jamais** en propriété d'événement. C'est la seule donnée d'identité humaine autorisée dans PostHog.

**Texte libre saisi par l'utilisateur** : autorisé uniquement pour deux champs, avec troncature obligatoire — la requête de recherche (`query`, ≤100 caractères, contenu produit) et le libellé de marque hors référentiel (`custom_brand_added.brand_label`, ≤50 caractères, signal de trou de taxonomie). Tout autre texte libre est interdit (→ `*_length` / `has_*`).

**Cardinalité** : aucune prop ne doit porter de la copy FR d'interface (elle change avec le wording et casse les analyses). Les gates, raisons et messages passent par des clés stables (`gate_key`, `error_message_key`, `reason_code`).

### Types (notation des tables)
`str`, `int`, `bool`, `enum(a|b)`, `arr`, `ts` (ISO 8601). Propriétés systématiquement enrichies par les super properties (§3).

---

## 2. Fondations (câblage racine)

### Automatique — ne pas redéfinir
| Mécanisme | Détail |
|---|---|
| `$screen` | Hook global dans `app/_layout.tsx` (usePathname → `posthog.screen(routePattern)`). Pattern de route Expo Router (`/article/[id]`, `/settings/privacy`…), **pas** les ids réels. Couvre toutes les vues d'écran sans propriétés métier — les vues « riches » (article_viewed, profile_viewed, wallet_viewed…) sont des événements dédiés. |
| Lifecycle PostHog | `Application Opened`, `Application Backgrounded`, `Application Installed`, `Application Updated` — autocapture SDK, à mentionner dans les dashboards, pas à réimplémenter. |
| `identify` | Dans `authStore.hydrateFromFirebase` (point unique d'hydratation auth) : `identify(uid, userProperties)` — voir §4. |

### Événements transverses (helpers `lib/analytics.ts`, appelés par tous les écrans)
| Événement | Déclencheur (actions cartographie couvertes) | Propriétés | Side | Domaine |
|---|---|---|---|---|
| `list_refreshed` | Pull-to-refresh d'une liste (couvre : home_pull_to_refresh, search_results_pull_refresh, favorites_refresh, my_articles_refresh, orders_refreshed, sales_refreshed, wallet_refreshed, notifications_pull_refresh, swap_zone_pull_to_refresh, my_swaps_pull_to_refresh) | `screen enum(home\|search\|favorites\|my_articles\|my_orders\|my_sales\|wallet\|notifications\|swap_zone\|my_swaps)` · `items_count int` | client | fondations |
| `list_filtered` | Changement d'onglet/filtre d'une liste (couvre : messages_tab_select, my_articles_filter_select, my_swaps_filter_changed, profile_tab_change) | `screen enum(messages\|my_articles\|my_swaps\|public_profile)` · `filter str` · `filtered_count int` · `unread_count int?` | client | fondations |
| `error_retry_tapped` | Tap « Réessayer » sur un état d'erreur (couvre : home_discover_retry, search_results_error_retry, article_load_error_retry, notifications_load_retry, saved_searches_retry, my_articles_retry, chat_error_retry, visual_search_retry, swap_zone_retry_tapped, my_swaps_retry_tapped) | `screen str` · `error_context str` · `error_code str?` | client | fondations |
| `permission_denied` | Permission OS caméra/photos refusée, avec action de repli (couvre : visual_search_permission_denied, sell_camera_permission_denied, chat_image_permission_denied, permissions photos de profile_photo_pick et kyc_document_picked). La permission notifications appartient à `push_permission_requested` (chat-notifications) | `permission enum(camera\|photos)` · `context enum(visual_search\|sell_capture\|chat_image\|profile_photo\|kyc)` · `can_ask_again bool` · `action_taken enum(settings\|gallery_fallback\|cancel)?` | client | fondations |

---

## 3. Super properties (`posthog.register`)

Posées au démarrage et à chaque changement d'état auth — présentes sur **tous** les événements client.

| Propriété | Type | Exemple | Mise à jour |
|---|---|---|---|
| `is_guest` | bool | `true` | authStore (hydrate, signup_completed, user_signed_out) |
| `shipping_enabled` | bool | `true` | `config/featureFlags.ts` au boot (gate tout le rail expédition) |
| `app_version` / `platform` / device | auto SDK | — | automatique (`$app_version`, `$os`…) |

**Règle de précédence** : une super property n'est JAMAIS redéclarée en propriété d'événement. En particulier `is_guest` n'apparaît sur aucun événement des tables §5-§11 (ni sous forme inversée `is_authenticated`) — elle est déjà présente partout via `register`.

---

## 4. User properties (`identify` / `$set`)

Traits non-PII, posés via `identify(uid, {...})` à l'hydratation + `$set` aux points de mutation. Aucune user property ne porte le même nom qu'un événement.

| Propriété | Type | Exemple | Point de mise à jour |
|---|---|---|---|
| `username` | str | `"lea_mtl"` | signup_completed (pseudo public choisi — exception PII assumée, voir §1 ; seul identifiant humain autorisé, user property uniquement) |
| `signup_method` | enum(email\|google\|apple) | `"google"` | signup_completed |
| `created_at` | ts | `"2026-07-08T…"` | signup_completed |
| `province` | str | `"QC"` | address_saved (province SEULEMENT — jamais ville, rue ou code postal, conformément à §1) |
| `has_shop` | bool | `false` | shop créée / shop_tier_activated (server `$set`) |
| `shop_tier` | enum(basic\|pro\|premium) | `"pro"` | shop_tier_activated (server) |
| `seller_onboarded` | bool | `true` | seller_activated (server, charges+payouts enabled) |
| `articles_count` | int | `12` | article_published / article_deleted (server de préférence) |
| `email_verified` | bool | `true` | email_verification_checked(verified) |
| `marketing_consent` | bool | `false` | signup_completed, marketing_consent_changed |
| `has_wallet` | bool | `true` | événement `wallet_activated` (nom distinct pour éviter la collision événement/property) |
| `onboarding_completed` | bool | `true` | onboarding_completed / onboarding_skipped |
| `preferred_size_system` | enum(US\|EU) | `"US"` | onboarding_completed, preferences_saved |

---

## 5. Domaine `auth-onboarding`

| Événement | Déclencheur (actions couvertes) | Propriétés | Side | Domaine |
|---|---|---|---|---|
| `onboarding_gate_resolved` | Résolution du redirect racine app/index.tsx (onboarding_gate_redirect) | `needs_onboarding bool` | client | auth-onboarding |
| `onboarding_completed` | Tap VALIDER du formulaire préférences (onboarding_submit) | `sex_value enum(femme\|homme\|enfant\|…)` · `sizes_top_count int` · `sizes_bottom_count int` · `sizes_shoes_count int` · `size_system enum(US\|EU)` | client | auth-onboarding |
| `onboarding_skipped` | Tap « Passer » welcome ou formulaire (onboarding_skip) | `step enum(welcome\|form)` · `sex_selected bool` · `sizes_selected_count int` | client | auth-onboarding |
| `onboarding_preference_changed` | Interaction formulaire : sexe, système de taille, chip taille (onboarding_sex_select, onboarding_size_system_change, onboarding_size_toggle) | `field enum(sex\|size_system\|size)` · `value str` · `selected bool?` · `category enum(top\|bottom\|shoes)?` · `from_system/to_system enum(US\|EU)?` · `system_change_confirmed bool?` · `sizes_reset bool?` | client | auth-onboarding |
| `onboarding_save_failed` | Échec callable saveOnboardingPreferences → Alert (onboarding_save_failed) | `retry_chosen bool` · `attempt_number int` | client | auth-onboarding |
| `guest_session_started` | Création session invité dans authStore (guest_session_created) | `is_first_launch bool` | client | auth-onboarding |
| `auth_sheet_opened` | `authSheetStore.show()` — point unique, capte 100 % des gates (auth_sheet_open, auth_gate_blocked, et tous les CTA « Se connecter » : messages_guest_login_tap, guest_connect_tap, my_articles_login_cta, orders_login_cta_tapped, favorites gate, deposit_auth_gate_shown, profile_block_auth_gate, auth_sheet_shown, saved-searches gate, article/offer/swap gates `was_auth_gated`) | `source str` (écran/action appelante, à threader dans show()) · `gate_key str` (clé stable de la gate — ex. `favorites_gate`, `sell_gate`, `offer_gate` — à threader dans show() ; base des analyses) · `gate_message str?` (copy FR, informatif seulement — cardinalité libre, ne jamais l'utiliser en breakdown) · `has_pending_action bool` | client | auth-onboarding |
| `auth_sheet_dismissed` | Fermeture sans auth : swipe/backdrop/back (auth_sheet_dismiss) | `auth_mode enum(signin\|signup\|forgot_password)` · `had_pending_action bool` · `email_field_filled bool` | client | auth-onboarding |
| `auth_mode_switched` | Changement d'onglet ou entrée/sortie mot de passe oublié (auth_mode_toggle, forgot_password_open, password_reset_back_to_signin) | `from_mode enum` · `to_mode enum` · `email_prefilled bool?` · `reset_email_sent bool?` | client | auth-onboarding |
| `auth_submitted` | Tap sur un CTA d'auth : SE CONNECTER, S'INSCRIRE, Google, Apple (signin_email_submit, signup_email_submit, social_auth_tap) | `method enum(email\|google\|apple)` · `mode enum(signin\|signup)` · `had_pending_action bool` · `apple_available bool?` · `display_name_length int?` | client | auth-onboarding |
| `auth_succeeded` | Résolution réussie (signin_success, social_auth_success, signup_account_created, social_auth_needs_consent) | `method enum` · `outcome enum(signed_in\|needs_consent)` (needs_consent = signup effectif → /complete-profile) · `had_pending_action bool` | client | auth-onboarding |
| `auth_failed` | Catch d'un flow d'auth → Alert (signin_error, signup_error, social_auth_error) | `method enum` · `mode enum` · `error_message_key str` (mapping authMessages, jamais l'email) | client | auth-onboarding |
| `auth_form_error_shown` | Erreur de validation inline onBlur (signin_field_validation_shown, signup_field_validation_shown) | `field enum(email\|password\|display_name)` · `mode enum(signin\|signup)` | client | auth-onboarding |
| `password_reset_requested` | Résolution de l'envoi du lien (password_reset_submit, password_reset_sent, password_reset_error) | `result enum(sent\|error)` · `error_message_key str?` | client | auth-onboarding |
| `username_checked` | Résolution check dispo pseudo, débounce 350 ms + validation locale (username_check_result, username_local_validation_failed) | `result enum(available\|taken\|invalid_local\|invalid\|network_error)` · `invalid_reason enum(too_short\|invalid_chars\|too_long)?` · `username_length int` · `attempt_index int` | client | auth-onboarding |
| `signup_age_checked` | DOB complète ou erreur d'âge inline (consent_dob_completed, consent_age_error_shown) | `result enum(valid\|invalid_date\|underage)` · `age_band enum(16-17\|18-24\|25-34\|35-44\|45+)?` (JAMAIS la DOB) | client | auth-onboarding |
| `consent_toggled` | Tap une checkbox de consentement (consent_terms_toggle, consent_privacy_toggle, consent_marketing_toggle) | `consent_type enum(terms\|privacy\|marketing)` · `checked bool` | client | auth-onboarding |
| `signup_profile_submitted` | Tap CONTINUER de /complete-profile (complete_profile_submit) | `signup_method enum` · `marketing_opt_in bool` · `username_length int` | client | auth-onboarding |
| `signup_completed` ★ | `authStore.completeConsent` résolu — POINT DE CONVERSION, capte email + social + reprise à froid (complete_profile_success) ; déclenche `alias(uid)` + `$set` | `signup_method enum` · `marketing_opt_in bool` · `had_guest_session bool` · `had_pending_action bool` | client | auth-onboarding |
| `signup_profile_failed` | Catch de handleSubmit complete-profile (complete_profile_error) | `error_code enum(username_taken\|username_invalid\|age_invalid\|consent_required\|network)` · `username_length int` | client | auth-onboarding |
| `signup_back_blocked` | Back Android consommé sur l'étape obligatoire (complete_profile_back_blocked) | `fields_filled_count int` | client | auth-onboarding |
| `signup_resumed` | Guard startup détecte pendingConsent → redirect /complete-profile (consent_guard_redirect) | `signup_method enum` · `cold_resume bool=true` | client | auth-onboarding |
| `user_signed_out` | `authStore.signOut` résolu, 2 origines (sign_out_completed) ; suivi de `posthog.reset()` | `source enum(user_action\|account_deletion)` | client | auth-onboarding |

---

## 6. Domaine `home-search`

| Événement | Déclencheur (actions couvertes) | Propriétés | Side | Domaine |
|---|---|---|---|---|
| `search_opened` | Mount de /search avec contexte initial (search_screen_open ; couvre les portes d'entrée : home_search_bar_tap, home_quick_category_tap, home_section_see_all_tap, home_brand_tap, shop_view_articles_tap — `source` threadé en param de navigation) | `source enum(home_header\|home_quick_category\|home_see_all\|home_brand\|shop\|saved_search\|visual_fallback\|deep_link\|other)` · `entry_source enum(query\|category\|category_path\|brands\|shop\|filters\|browse\|none)` · `is_browse_all bool` · `initial_category_path arr?` · `initial_brands arr?` · `section_id str?` · `brand_name str?` | client | home-search |
| `search_performed` | Commit effectif de recherche dans useArticleSearch — évite les doublons debounce (search_submitted, search_recent_tap, search_trending_tap, restauration saved search) | `trigger enum(typed\|submit\|recent\|trending\|restored)` · `query str(≤100)` · `query_length int` · `has_active_filters bool` · `active_filter_keys arr` · `category_path arr?` · `sort_by str` · `trending_term str?` · `history_item_age int?` | client | home-search |
| `search_results_loaded` | Résolution de la requête, succès/vide/erreur (search_results_loaded, search_results_empty) | `outcome enum(success\|empty\|error)` · `results_count int` · `has_next_page bool` · `latency_ms int` · `query_length int` · `active_filter_keys arr` · `sort_by str` · `category_path arr?` · `is_browse_all bool` · `empty_reason enum(query\|filters)?` · `error_code str?` | client | home-search |
| `search_closed` | Tap retour, abandon du flow (search_closed) | `had_results bool` · `query_length int` · `any_filter_active bool` | client | home-search |
| `search_filter_applied` | Sélection dans une sheet de filtre — partagé /search et Swap Zone (search_sort_select, search_category_select, search_colors_apply, search_sizes_apply, search_materials_apply, search_condition_select, search_brands_apply, search_price_apply ; zone_filter_applied) | `screen enum(search\|swap_zone)` · `filter_type enum(sort\|category\|colors\|sizes\|materials\|brands\|condition\|price)` · `values arr?` · `values_count int?` · `sort_value str?` · `category_path arr?` · `category_depth int?` · `size_system str?` · `min_price_cents int?` · `max_price_cents int?` · `price_was_swapped bool?` · `results_count_after int?` | client | home-search |
| `search_filter_removed` | X d'un chip actif ou Effacer prix (search_filter_chip_remove, search_price_clear) | `screen enum(search\|swap_zone)` · `filter_type enum` · `remaining_active_filter_keys arr` | client | home-search |
| `search_filters_cleared` | « Effacer tout » / « Réinitialiser » (search_clear_all, zone_filters_cleared) | `screen enum(search\|swap_zone)` · `cleared_filter_keys arr` · `query_length int?` | client | home-search |
| `custom_brand_added` | « Ajouter "X" » marque absente du référentiel (search_brand_add_custom — signal de trou de taxonomie) | `brand_label str(≤50)` (texte libre tronqué, voir §1) · `source enum(search_filter\|sell_form\|preferences)` | client | home-search |
| `article_card_tapped` | Tap sur une carte article partagée ProductCard/rails/grilles (home_article_tap, product_card_tap, search_result_tap, visual_search_result_tap, favorites_article_tap, profile_article_tap, my_articles_item_tap, chat_article_banner_view) — contexte injecté par le caller | `article_id str` · `source enum(home_new_arrivals\|home_pour_toi\|home_price_drops\|home_discover\|search\|visual_search\|favorites\|public_profile\|my_articles\|chat_banner)` · `position int?` · `price_cents int` · `brand str?` · `condition str?` · `is_sold bool` · `reduction_pct int?` · `similarity_pct int?` · `price_changed bool?` (chat_banner) · `query_length int?` | client | home-search |
| `saved_search_created` | Confirmation du modal Sauvegarder (save_search_confirmed) | `outcome enum(success\|error)` · `notify_new_items bool` · `name_length int` · `name_is_default bool` · `query_length int` · `filter_keys arr` | client | home-search |
| `saved_search_cancelled` | Fermeture du modal sans sauvegarder (save_search_cancelled) | `notify_toggled bool` · `name_edited bool` | client | home-search |
| `saved_search_opened` | Tap sur une recherche sauvegardée → restauration (saved_search_open) | `saved_search_id str` · `new_items_count int` · `has_query bool` · `filter_keys arr` · `notify_enabled bool` | client | home-search |
| `saved_search_deleted` | Confirmation de suppression (saved_search_delete) | `saved_search_id str` · `outcome enum(confirmed\|error)` · `notify_enabled bool` | client | home-search |
| `saved_search_notify_toggled` | Tap cloche d'une carte (saved_search_notify_toggle) | `saved_search_id str` · `new_value bool` · `outcome enum(success\|error)` | client | home-search |
| `visual_search_opened` | Ouverture du modal caméra (home_visual_search_open, search_visual_open) | `source enum(home\|search)` · `query_length int?` | client | home-search |
| `visual_search_photo_picked` | Résolution du choix de photo caméra ou galerie, y compris annulation/échec (visual_search_capture, visual_search_gallery_pick) | `method enum(camera\|gallery)` · `outcome enum(success\|cancelled\|error)` · `facing enum(back\|front)?` · `source enum(home\|search)` | client | home-search |
| `visual_search_submitted` | Tap « Rechercher » sur la preview (visual_search_confirm) | `source enum(home\|search)` · `from_gallery bool` | client | home-search |
| `visual_search_performed` | Résolution de la callable visualSearch, mount ou retry (visual_search_executed) | `outcome enum(success\|empty\|error)` · `results_count int` · `error_code enum(unauthenticated\|resource-exhausted\|invalid-argument\|internal\|unavailable)?` · `latency_ms int` · `is_retry bool` | client | home-search |
| `visual_search_abandoned` | Sortie sans conversion (visual_search_cancel, visual_search_new_search, visual_search_text_fallback) | `action enum(cancel\|new_search\|text_fallback)` · `stage enum(camera\|preview\|results_empty\|permission_denied)` | client | home-search |

---

## 7. Domaine `article-sell`

| Événement | Déclencheur (actions couvertes) | Propriétés | Side | Domaine |
|---|---|---|---|---|
| `article_viewed` ★ | Mount fiche article, une fois par mount, exclu owner — colocalisé avec incrementProductView (article_view) | `article_id str` · `seller_id str` · `price_cents int` · `brand str?` · `category_ids arr` · `condition str` · `is_sold bool` · `source str` (threadé : voir article_card_tapped) · `is_swap_context bool` | client | article-sell |
| `article_image_zoomed` | Tap image → modal plein écran (article_image_zoom_open) | `article_id str` · `image_index int` · `image_count int` | client | article-sell |
| `article_favorited` | Ajout favori — instrumenté dans la mutation canonique useFavorites, source injectée par le caller (article_favorite_toggle ×4 surfaces, product_card_favorite_toggle, favorite_toggle) | `article_id str` · `seller_id str?` · `price_cents int?` · `brand str?` · `source enum(article_detail\|home_new_arrivals\|home_pour_toi\|home_price_drops\|home_discover\|search\|visual_search\|favorites)` (vocabulaire aligné sur article_card_tapped) · `favorites_count_after int` | client | article-sell |
| `article_unfavorited` | Retrait favori, même point canonique (mêmes actions + favorites_remove_longpress, favorite_remove_longpress) | idem `article_favorited` + `via enum(heart\|long_press)` | client | article-sell |
| `favorite_limit_reached` | Alert « Limite atteinte » au cap 500 (article_favorite_cap_reached) | `article_id str` · `favorites_count int=500` | client | article-sell |
| `content_shared` | Share natif article ou profil (article_share ; profile_share appelé depuis profile-settings) | `content_type enum(article\|profile)` · `content_id str` · `price_cents int?` · `brand str?` | client | article-sell |
| `article_edit_opened` | Ouverture de l'édition avec gardes (edit_article_open, article_edit_open, my_articles_edit) | `article_id str` · `outcome enum(loaded\|not_found\|not_owner\|sold_blocked\|load_error)` · `source enum(article_detail\|my_articles)` | client | article-sell |
| `sell_field_edited` | Sélection discrète d'un champ des formulaires vendre/éditer (sell_category_select, sell_condition_select, sell_brand_select, sell_size_select, sell_color_toggle, sell_material_toggle, sell_neighborhood_toggle, sell_package_size_select, sell_hand_delivery_toggle, sell_shipping_toggle, edit_article_field_change hors frappe texte — la frappe est captée par article_updated, voir Annexe B) | `screen enum(sell\|edit)` · `field enum(category\|condition\|brand\|size\|colors\|materials\|neighborhoods\|package_size\|hand_delivery\|shipping)` · `value str?` · `enabled bool?` · `selected_count_after int?` · `matched_ai_suggestion bool?` · `ai_confidence str?` | client | article-sell |
| `article_updated` | Enregistrement de l'édition (edit_article_save) | `article_id str` · `outcome enum(saved\|validation_failed\|server_error)` · `validation_error str?` · `price_cents int` · `photo_count int` · `local_photos_uploaded_count int` · `is_hand_delivery bool` · `is_shipping bool` | client | article-sell |
| `article_sold_toggled` | Marquer vendu / remettre en vente via callable (article_toggle_sold, my_articles_toggle_sold) | `article_id str` · `new_state enum(sold\|relisted)` · `success bool` · `source enum(article_detail\|my_articles)` | client | article-sell |
| `article_deleted` | Confirmation de suppression (article_delete, my_articles_delete) | `article_id str` · `is_sold bool` · `outcome enum(success\|error)` · `source enum(article_detail\|my_articles)` · `entry enum(menu\|swipe)?` · `price_cents int?` | client | article-sell |
| `sell_entry_tapped` | Entrée dans le flow vente, toutes portes et gates (sell_tab_tap, my_articles_sell_cta) | `outcome enum(opened\|auth_gated\|age_gated\|email_gate)` · `platform enum(ios\|android)` · `has_existing_draft bool` · `source enum(tab\|my_articles_empty)` | client | article-sell |
| `sell_draft_resumed` | « Reprendre » du DraftResumeModal, 2 plateformes (sell_draft_resume) | `draft_step enum(1\|1b\|2\|3\|4)` · `photo_count int` · `has_ai_result bool` · `platform enum` | client | article-sell |
| `sell_draft_discarded` | « Recommencer » → deleteDraft (sell_draft_discard) | `draft_step enum` · `photo_count int` · `platform enum` | client | article-sell |
| `sell_photo_added` | Photo ajoutée caméra/galerie sur capture, review ou edit (sell_capture_photo, sell_gallery_pick, sell_photos_add_more, edit_article_photo_add) | `screen enum(capture\|photos_review\|edit)` · `method enum(camera\|gallery)` · `count_added int` · `photo_count_after int` · `cancelled bool?` | client | article-sell |
| `sell_photo_removed` | Photo retirée (sell_photo_remove, sell_photos_review_remove, edit_article_photo_remove) | `screen enum(capture\|photos_review\|edit)` · `photo_index int` · `photo_count_after int` | client | article-sell |
| `sell_exit_prompted` | Alert « Quitter ? » du flow vente/édition et son issue (sell_capture_close, sell_details_leave_attempt, sell_pricing_leave_attempt, edit_article_leave_attempt) | `flow_step enum(capture\|details\|pricing\|edit)` · `confirmed_leave bool` · `photo_count int?` · `has_price bool?` · `has_unsaved_changes bool?` | client | article-sell |
| `sell_step_completed` | Continue réussi d'une étape du funnel vente (sell_capture_continue, sell_photos_review_continue, sell_details_continue OK, sell_pricing_continue OK) | `step enum(capture\|photos_review\|details\|pricing)` · `photo_count int?` · `prefilled_count int?` · `ai_used bool?` · `category_ids arr?` · `has_brand bool?` · `has_size bool?` · `colors_count int?` · `materials_count int?` · `price_cents int?` · `is_hand_delivery bool?` · `is_shipping bool?` · `neighborhoods_count int?` · `package_size enum(small\|medium\|large)?` | client | article-sell |
| `sell_validation_failed` | Continue refusé : champs manquants / erreurs inline (branches échec de sell_details_continue, sell_pricing_continue) | `step enum(details\|pricing)` · `missing_fields arr` · `errors arr` | client | article-sell |
| `ai_analysis_started` | Démarrage analyse Gemini, auto ou retry (sell_ai_analysis_start, sell_ai_analysis_retry) | `photo_count int` · `hydrated_from_draft bool` · `attempt_number int` | client | article-sell |
| `ai_analysis_completed` | analyzeProductImage réussi (sell_ai_analysis_complete) | `photo_count int` · `prefilled_count int(0-8)` · `detected_category bool` · `detected_brand bool` · `detected_size bool` · `duration_ms int` | client | article-sell |
| `ai_analysis_failed` | analyzeProductImage en échec (sell_ai_analysis_error) | `photo_count int` · `error_code str` · `attempt_number int` | client | article-sell |
| `ai_analysis_skipped` | « ou remplir manuellement » (sell_manual_entry) | `photo_count int` · `analysis_state_at_tap enum(idle\|loading\|error)` | client | article-sell |
| `article_published` ★ | createArticle réussi → SuccessModal (sell_publish, branche succès) | `article_id str` · `price_cents int` · `category_ids arr` · `condition str` · `photo_count int` · `has_brand bool` · `has_size bool` · `colors_count int` · `materials_count int` · `is_hand_delivery bool` · `is_shipping bool` · `neighborhoods_count int` · `package_size str?` · `ai_used bool` | client | article-sell |
| `article_publish_failed` | Échec de publication (sell_publish, branches échec) | `reason enum(client_validation\|server_error\|email_gate)` · `error_code str?` · `missing_fields arr?` | client | article-sell |

---

## 8. Domaine `checkout-payment`

| Événement | Déclencheur (actions couvertes) | Propriétés | Side | Domaine |
|---|---|---|---|---|
| `buy_button_tapped` | Tap Acheter avec gardes (article_buy_tap, buy_button_tapped) | `article_id str` · `seller_id str` · `price_cents int` · `outcome enum(navigated\|blocked_sold\|blocked_own\|auth_gated)` | client | checkout-payment |
| `checkout_started` | Mount /checkout (checkout_started) | `article_id str` · `seller_id str` · `price_cents int` · `has_meetup_option bool` · `has_shipping_option bool` · `has_negotiated_price bool` · `auto_selected_delivery str?` | client | checkout-payment |
| `checkout_blocked` | État bloquant affiché (checkout_guard_shown, checkout_blocked_fallback_rate) | `article_id str` · `guard_type enum(network_error\|not_found\|sold\|own_article\|fallback_rate)` · `cta_chosen enum(retry_rates\|switch_meetup)?` | client | checkout-payment |
| `checkout_delivery_selected` | Choix explicite du mode de livraison — ne se déclenche PAS en auto-sélection (checkout_delivery_type_selected ; checkout_switched_to_meetup avec `via`) | `article_id str` · `delivery_type enum(meetup\|shipping)` · `via enum(card\|shipping_unavailable)` · `price_cents int` | client | checkout-payment |
| `meetup_spot_selected` | Choix spot vendeur ou « à convenir » (checkout_meetup_spot_selected) — la confirmation du meetup est `offer_sent(source=checkout_direct)` (chat-notifications) | `article_id str` · `option enum(seller_spot\|via_chat)` · `spot_category str?` · `neighborhood_id str?` · `seller_spots_count int` | client | checkout-payment |
| `shipping_estimates_loaded` | Retour getShippingEstimate (shipping_estimates_loaded) | `article_id str` · `rates_count int` · `is_fallback bool` · `first_rate_cents int` · `postal_code_fsa str(3)` | client | checkout-payment |
| `shipping_rate_selected` | Tap une estimation (shipping_rate_selected) | `carrier str` · `service str` · `amount_cents int` · `delivery_days int?` · `is_fallback_rate bool` · `rate_index int` | client | checkout-payment |
| `wallet_payment_toggled` | Switch porte-monnaie, 2 écrans (checkout_wallet_toggled, payment_wallet_toggled) | `screen enum(checkout\|payment)` · `enabled bool` · `wallet_balance_cents int` · `total_cents int` · `covers_all bool` | client | checkout-payment |
| `payment_submitted` | Tap PAYER, 2 écrans (checkout_pay_tapped, payment_pay_tapped) | `screen enum(checkout\|payment)` · `transaction_id str?` · `article_id str?` · `final_price_cents int` · `shipping_cents int` · `service_fee_cents int` · `tax_cents int` · `total_cents int` · `uses_wallet bool` · `wallet_covers_all bool` · `card_amount_cents int` · `is_fallback_rate bool?` · `has_negotiated_price bool?` | client | checkout-payment |
| `wallet_payment_completed` | Paiement 100 % wallet, flip synchrone — aucun Payment Sheet présenté (checkout_wallet_full_payment, payment_wallet_full_payment) | `screen enum(checkout\|payment)` · `transaction_id str` · `total_cents int` | client | checkout-payment |
| `payment_sheet_presented` | createStripeCheckout résolu → sheet présenté (stripe_checkout_session_created ; aussi shop_upgrade et swap top-up via `source`) | `source enum(checkout\|payment\|shop_upgrade\|swap_topup)` · `context_id str` (= transaction_id \| swap_id \| shop_id selon source) · `server_buyer_total_cents int` · `wallet_amount_cents int?` · `is_retry bool` | client | checkout-payment |
| `payment_sheet_completed` | Résultat du Payment Sheet Stripe — composant partagé StripePayment, UNE instrumentation (payment_sheet_result, shop_tier_payment_result, swap_topup_payment_result) | `source enum(checkout\|payment\|shop_upgrade\|swap_topup)` · `result enum(success\|cancelled\|failed)` · `context_id str` (= transaction_id \| swap_id \| shop_id selon source) · `amount_cents int` · `error_code str?` · `decline_code str?` · `error_type str?` | client | checkout-payment |
| `payment_init_failed` | Catch de handlePay → annulation tx orpheline + Alert (checkout_payment_init_failed) | `transaction_id str?` · `failure_type enum(rate_expired\|article_unavailable\|rate_limited\|blocked_users\|other)` · `error_code str?` | client | checkout-payment |
| `payment_retried` | Reprendre après échec/annulation, même tx (payment_retry_tapped) | `transaction_id str` · `previous_error_code str?` · `uses_wallet bool` | client | checkout-payment |
| `payment_confirmation_polled` | Fin du polling webhook 12 s (payment_confirmation_polled) | `transaction_id str` · `outcome enum(confirmed\|timeout)` · `poll_duration_ms int` | client | checkout-payment |
| `order_confirmation_viewed` | Écran de succès (checkout_success_viewed) | `delivery_type enum(meetup\|shipping)` · `transaction_id str?` · `total_cents int?` · `has_chat_id bool` | client | checkout-payment |
| `payment_screen_viewed` | Ouverture /payment/[txId] — reprise de paiement (payment_screen_opened) | `transaction_id str` · `total_cents int` · `delivery_type enum` · `wallet_balance_cents int` | client | checkout-payment |
| `payment_blocked` | Transaction non payable (payment_not_payable) | `transaction_id str` · `reason enum(not_found\|forbidden\|already_processed)` | client | checkout-payment |
| `order_cancel_submitted` | Annulation d'une commande côté client, acheteur (pending) ou vendeur (pré-expédition F74) — intent UX ; vérité = server `order_cancelled` (payment_order_cancel_tapped, pending_transaction_cancelled_from_checkout, sale_cancelled_by_seller) | `transaction_id str` · `role enum(buyer\|seller)` · `source enum(checkout_failure\|payment_screen\|sale_detail)` · `status_at_cancel enum(pending_payment\|paid\|label_created)` · `total_cents int?` · `success bool` · `error_code str?` | client | checkout-payment |
| `order_card_tapped` | Tap une commande/vente dans les listes (order_card_tapped, sale_card_tapped) | `role enum(buyer\|seller)` · `transaction_id str` · `status str` · `delivery_type enum` · `destination enum(payment\|chat\|article)` · `from_deep_link bool?` | client | checkout-payment |
| `review_submitted` | createReview réussi (review_submitted) | `transaction_id str` · `article_id str` · `transaction_type enum(achat\|vente)` · `rating int(1-5)` · `comment_length int` | client | checkout-payment |
| `review_submit_failed` | Échec ou validation refusée (review_submit_failed) | `transaction_id str` · `rating int?` · `failure_type enum(validation_rating\|validation_comment\|server)` · `error_code str?` | client | checkout-payment |
| `review_blocked` | Gate statut non terminal (review_gate_not_terminal_shown) | `transaction_id str` · `transaction_status str` | client | checkout-payment |
| `wallet_viewed` | Ouverture du porte-monnaie (wallet_viewed) | `has_wallet bool` · `balance_cents int` · `pending_balance_cents int` · `held_balance_cents int` · `seller_debt_cents int` · `has_active_dispute_hold bool` · `payouts_blocked bool` · `withdrawals_in_progress_count int` | client | checkout-payment |
| `wallet_activated` | activateWallet résolu (wallet_activated) — pose la user property `has_wallet` | `success bool` · `error_code str?` | client | checkout-payment |
| `withdrawal_cta_tapped` | Tap Retirer — ouvre le formulaire OU affiche un état bloqué (wallet_withdraw_tapped) | `outcome enum(form_opened\|blocked)` · `balance_cents int` · `blocked_reason enum(debt\|no_stripe_account\|payouts_disabled)?` (présent si outcome=blocked) · `cta_chosen enum(configure\|resolve\|later)?` | client | checkout-payment |
| `withdrawal_submitted` | Confirmation du retrait → callable (wallet_withdraw_confirmed) — friction UX ; vérité = server withdrawal_requested | `amount_cents int` · `validation_result enum(ok\|invalid\|below_min\|insufficient)` · `success bool` · `failure_type enum(dispute\|debt\|other)?` · `error_code str?` | client | checkout-payment |
| `seller_onboarding_viewed` | Ouverture stripe-onboarding (stripe_onboarding_viewed) | `has_account bool` · `account_status enum(none\|pending\|active\|restricted)` · `charges_enabled bool` · `payouts_enabled bool` · `requirements_currently_due_count int` · `requirements_past_due_count int` · `shows_kyc_upload bool` · `age_gate_shown bool` | client | checkout-payment |
| `seller_account_submitted` | Soumission formulaire Connect Custom (stripe_account_submitted, stripe_account_submit) | `validation_result enum(ok\|field_error)` · `failed_field str?` (nom du champ, JAMAIS la valeur) · `success bool` · `charges_enabled_after bool?` · `requirements_count_after int?` · `error_code str?` | client | checkout-payment |
| `seller_status_refreshed` | Actualiser le statut (stripe_status_refreshed, stripe_status_refresh, bank_status_refreshed) | `screen enum(stripe_onboarding\|bank_account)` · `account_status_before str` · `account_status_after str` · `payouts_enabled_after bool?` | client | checkout-payment |
| `kyc_document_uploaded` | Envoi pièce d'identité (kyc_document_uploaded, stripe_kyc_document_upload) | `has_back_side bool` · `success bool` · `requirements_remaining_count int?` · `payouts_enabled_after bool?` · `error_code str?` | client | checkout-payment |
| `bank_account_saved` | addBankAccount résolu (bank_account_replaced, bank_account_submit) | `is_replacement bool` · `validation_result enum(ok\|transit_invalid\|institution_invalid\|account_invalid)` · `success bool` · `error_code str?` | client | checkout-payment |
| `tracking_refreshed` | Refresh du suivi (tracking_refresh_tapped) | `transaction_id str` · `tracking_status str` · `success bool` | client | checkout-payment |
| `tracking_link_opened` | « Suivre en ligne » (tracking_link_opened) | `transaction_id str` · `carrier_code str` · `tracking_status str` | client | checkout-payment |
| `shipping_label_downloaded` | Téléchargement étiquette vendeur (shipping_label_downloaded) | `transaction_id str` · `status str` | client | checkout-payment |
| `transaction_problem_reported` | Signalement → litige, fonds gelés (problem_report_submitted) | `transaction_id str` · `status str` · `reason_code enum(not_received_despite_delivered\|not_as_described\|damaged\|other)` · `details_length int` · `success bool` · `error_code str?` | client | checkout-payment |
| `refund_requested` | Demande de remboursement (refund_requested) | `transaction_id str` · `status enum(delivery_failed\|lost)` · `success bool` · `redirected_to_report bool` · `error_code str?` | client | checkout-payment |
| `return_requested` | Demande de retour fenêtre 7 j (return_requested) | `transaction_id str` · `reason_code enum(not_as_described\|damaged\|wrong_item\|other)` · `success bool` · `error_code str?` | client | checkout-payment |
| `return_label_opened` | Ouverture étiquette retour (return_label_opened) | `transaction_id str` | client | checkout-payment |
| `automated_decision_explained` | « Pourquoi cette décision ? » — transparence Loi 25 (automated_decision_explanation_toggled) | `transaction_id str` · `decision_type str` · `opened bool` | client | checkout-payment |
| `automated_decision_contested` | Contestation → révision humaine (automated_decision_contested) | `transaction_id str` · `decision_type str` · `reason_code enum(disagree_decision\|incorrect_information\|special_circumstances\|other)` · `success bool` | client | checkout-payment |

> **Événements supprimés vs cartographies** : `shipping_transaction_created` (client) est un doublon du server `order_created(source=shipping_checkout)` — le serveur est la seule vérité (Annexe B). Le meetup direct du checkout (`meetup_request_submitted`/`meetup_request_failed`) est fusionné dans `offer_sent`/`offer_send_failed` (source=checkout_direct, chat-notifications) : un seul flux d'offres pour toute la négociation.

---

## 9. Domaine `chat-notifications`

| Événement | Déclencheur (actions couvertes) | Propriétés | Side | Domaine |
|---|---|---|---|---|
| `conversation_opened` | Tap une ligne de /messages (conversation_open) | `chat_id str` · `conversation_type enum(ventes\|achats\|autres)` · `unread_count int` · `is_blocked bool` · `has_article bool` · `article_id str?` · `last_message_type enum(text\|image\|offer\|system)` | client | chat-notifications |
| `chat_started` | createOrGetChat + navigation, toutes portes (chat_started, seller_contact_tap, swap_contact_tapped) | `chat_id str` · `source enum(article\|profile\|swap)` · `article_id str?` · `other_user_id str` · `is_new_chat bool` · `outcome enum(success\|error)` | client | chat-notifications |
| `message_sent` | Envoi texte ou image (message_send, chat_image_send) | `chat_id str` · `message_type enum(text\|image)` · `message_length int?` (JAMAIS le contenu) · `has_article bool` · `is_seller bool` · `outcome enum(success\|error)` | client | chat-notifications |
| `blocked_action_attempted` | Garde utilisateur bloqué à l'envoi (message_send_blocked_guard) | `chat_id str` · `attempted_action enum(message\|image\|offer)` | client | chat-notifications |
| `offer_modal_opened` | Présentation MakeOfferModal, 2 portes + gardes (article_make_offer_open, make_offer_opened, offer_button_tap) | `source enum(article\|chat)` · `article_id str` · `price_cents int` · `default_mode enum(meetup\|shipping)` · `blocked_reason enum(none\|user_blocked\|no_price\|sold\|inactive\|pending_offer_exists\|own_article\|auth_gated)` | client | chat-notifications |
| `offer_amount_confirmed` | Continuer étape montant + validations (offer_amount_continue, offer_amount_continue_tapped, offer_step_continue, offer_low_warning_continued) | `article_id str` · `offer_amount_cents int` · `list_price_cents int` · `discount_pct int` · `mode enum(meetup\|shipping)` · `validation_result enum(ok\|invalid\|too_high\|low_warned_continued\|low_warned_cancelled)` · `message_length int` | client | chat-notifications |
| `offer_location_selected` | Choix quartier/spot étape meetup (offer_location_select, offer_location_selected, offer_location_neighborhood_select, offer_location_spot_select) | `neighborhood_id str?` · `spot_category str?` · `is_custom_spot bool` · `is_seller_neighborhood bool?` · `search_used bool?` | client | chat-notifications |
| `offer_sent` ★ | Envoi d'offre résolu avec succès — UNIQUE flux d'offres : modal article/chat ET « CONFIRMER LE MEETUP » du checkout, tous deux via sendMeetupOffer (offer_submit ×3 cartographies, offer_submitted, meetup_request_submitted) | `article_id str` · `seller_id str` · `chat_id str` · `message_id str` · `source enum(article\|chat\|checkout_direct)` (checkout_direct = meetup direct depuis /checkout, prix courant possiblement déjà négocié) · `mode enum(meetup\|shipping)` · `offer_amount_cents int` · `list_price_cents int` · `discount_pct int` · `has_message bool` · `spot_category str?` · `neighborhood_id str?` | client | chat-notifications |
| `offer_send_failed` | Catch de l'envoi, toutes portes (offer_submit_failed, meetup_request_failed) | `article_id str` · `source enum(article\|chat\|checkout_direct)` · `mode enum` · `offer_amount_cents int` · `failure_type enum(blocked_users\|server_error)?` · `error_code str?` | client | chat-notifications |
| `offer_modal_abandoned` | Fermeture sans envoi (offer_modal_dismiss, offer_modal_dismissed, offer_modal_abandon) | `article_id str` · `step_at_close enum(offer\|location\|confirm)` · `mode enum` · `offer_amount_entered bool` | client | chat-notifications |
| `offer_responded` | Accepter/Refuser une offre reçue, avec issue du dialog (offer_accepted, offer_accept, offer_accept_failed, offer_rejected, offer_reject) | `chat_id str` · `message_id str` · `article_id str` · `action enum(accept\|reject)` · `dialog_outcome enum(confirmed\|cancelled)` · `result enum(success\|error)?` · `error_code str?` · `offer_amount_cents int` · `is_meetup_offer bool` · `role enum(buyer\|seller)` | client | chat-notifications |
| `offer_countered` | Soumission d'une contre-offre prix/lieu/horaire (offer_counter_type_selected, offer_counter_price_submitted/submit, offer_counter_location_submitted/submit, offer_counter_time_submitted/submit) | `chat_id str` · `article_id str` · `counter_type enum(price\|location\|time)` · `original_amount_cents int?` · `new_amount_cents int?` · `neighborhood_id str?` · `hours_until_meetup int?` · `validation_result enum(ok\|invalid\|too_high\|empty\|bad_format\|past_date)` · `success bool` | client | chat-notifications |
| `offer_pay_tapped` | « Payer maintenant » sur offre acceptée (offer_pay_now_tapped, offer_pay_tap) | `chat_id str` · `article_id str?` · `offer_amount_cents int` · `transaction_exists bool` · `destination enum(payment\|checkout\|error)` | client | chat-notifications |
| `meetup_confirmed` | Vendeur confirme le meetup (meetup_confirmed_by_seller, meetup_confirm) | `chat_id str` · `message_id str` · `article_id str` · `offer_amount_cents int` · `dialog_outcome enum(confirmed\|cancelled)` · `result enum(success\|error)?` | client | chat-notifications |
| `meetup_completed` | « Terminer la transaction » (meetup_completed, meetup_complete) | `chat_id str` · `article_id str` · `transaction_id str?` (la tx existe à ce stade) · `offer_amount_cents int` · `role enum(buyer\|seller)` · `dialog_outcome enum(confirmed\|cancelled)` · `result enum(success\|error)?` · `error_code str?` | client | chat-notifications |
| `meetup_no_show_reported` | « Signaler une absence » → tx disputed (meetup_no_show_reported, meetup_no_show_report) | `chat_id str` · `article_id str` · `role enum(buyer\|seller)` · `dialog_outcome enum(confirmed\|cancelled)` · `result enum(success\|error)?` | client | chat-notifications |
| `user_blocked` | Confirmation blocage, 2 handlers (user_block chat + profil, user_block_tap/user_block_confirm) | `blocked_user_id str` · `source enum(chat\|profile)` · `success bool` | client | chat-notifications |
| `report_opened` | Ouverture ReportBottomSheet toutes surfaces (report_sheet_open, article_report_open, user_report_open) | `target_type enum(article\|user\|message)` · `target_id str` · `source_screen enum(chat\|public_profile\|article_detail)` | client | chat-notifications |
| `report_submitted` | Envoi du signalement (report_submit ×3 cartographies) | `target_type enum` · `target_id str` · `reason enum(harassment\|scam\|spam\|inappropriate_content\|counterfeit\|dangerous_item\|other)` · `has_description bool` (jamais le texte) · `success bool` | client | chat-notifications |
| `report_abandoned` | Fermeture sans envoi (report_sheet_dismiss, report_sheet_abandon) | `target_type enum` · `step_reached enum(reason\|description)` | client | chat-notifications |
| `notification_center_opened` | Tap cloche header home (home_notifications_tap, notifications_bell_tap) | `unread_count int` | client | chat-notifications |
| `notification_opened` | Tap une notification du centre (notification_tap) | `notification_id str` · `notification_type str` · `was_unread bool` · `destination enum(deep_link\|chat\|article\|swap_party\|none)` | client | chat-notifications |
| `notification_deleted` | Swipe-delete (notification_delete) | `notification_type str` · `was_unread bool` | client | chat-notifications |
| `notifications_marked_all_read` | « Tout lire » (notifications_mark_all_read) | `unread_count int` · `total_count int` | client | chat-notifications |
| `notification_pref_toggled` | Switch d'une préférence de notification (notification_pref_toggle, notification_setting_toggle) | `pref_key enum(push\|email\|newMessages\|newOrders\|priceDrops\|articleFavorited\|offerReceived\|offerResponse)` · `new_value bool` · `os_permission_missing bool` · `success bool` | client | chat-notifications |
| `push_permission_requested` | Demande permission OS + issue — propriétaire unique de la permission notifications (push_permission_request, notification_os_settings_open via prop) | `granted bool` · `can_ask_again bool` · `chose_open_settings bool` | client | chat-notifications |
| `push_received` | Push reçue app ouverte (push_notification_received_foreground) | `notification_type str` · `suppressed_in_active_chat bool` | client | chat-notifications |
| `push_opened` | Tap sur une push, app en vie ou tuée (push_notification_open) | `notification_type str` · `from_killed_state bool` · `destination_route enum(chat\|article\|swap\|my-orders\|search\|notifications\|deep_link_fallback)` | client | chat-notifications |
| `push_token_registered` | Token FCM enregistré (push_token_registered) | `permission_status str` · `is_fcm_token bool` · `platform enum` | client | chat-notifications |

---

## 10. Domaine `profile-settings`

| Événement | Déclencheur (actions couvertes) | Propriétés | Side | Domaine |
|---|---|---|---|---|
| `profile_viewed` | Chargement du profil public, toutes portes (public_profile_view, public_profile_not_found ; couvre les taps : home_seller_tap, article_view_seller_profile, chat_header_profile_tap, reviewer_tap, liked_seller_tap — source threadée) | `profile_user_id str` · `outcome enum(loaded\|not_found)` · `is_own_profile bool` · `articles_count int?` · `reviews_count int?` · `followers_count int?` · `rating num?` · `source enum(home_featured\|article\|chat\|review\|liked_sellers\|search\|other)` | client | profile-settings |
| `seller_followed` | Suivi vendeur — point canonique useSellerLikes (seller_follow_toggle, seller_like_toggle) | `seller_id str` · `source enum(public_profile\|home_featured\|liked_sellers)` · `liked_sellers_count_after int` | client | profile-settings |
| `seller_unfollowed` | Retrait du suivi (mêmes actions + liked_seller_unlike) | idem `seller_followed` | client | profile-settings |
| `shop_viewed` | Ouverture fiche boutique (shop_view) | `shop_id str` · `shop_type str` · `shop_status str` · `articles_count int` · `is_owner bool` · `has_website bool` · `has_social bool` | client | profile-settings |
| `shop_contact_tapped` | Tap un canal de contact boutique (shop_call_tap, shop_email_tap, shop_website_tap, shop_social_tap) | `shop_id str` · `channel enum(phone\|email\|website\|instagram\|facebook)` | client | profile-settings |
| `shop_upgrade_submitted` | SOUSCRIRE → purchaseShopTier (shop_tier_purchase_submit ; résultat paiement = payment_sheet_completed source shop_upgrade) | `shop_id str` · `tier enum(pro\|premium)` · `period_months enum(1\|3\|6\|12)` · `estimated_total_cents int` · `current_tier str` · `success bool` | client | profile-settings |
| `profile_updated` | Enregistrer profil (profile_details_save ; profile_photo_pick couvert par `photo_changed` + permission_denied) | `success bool` · `validation_error enum(empty_name\|invalid_name_chars)?` · `error_code str?` · `photo_changed bool` · `bio_length int` | client | profile-settings |
| `address_saved` | Persistance adresse (address_save ; mode autocomplete/manuel = address_autocomplete_select + address_manual_mode_toggle via prop) — met à jour la user property `province` ($set) | `mode enum(autocomplete\|manual)` · `province str` (SEULE donnée géo, ex `QC`) · `has_geo bool?` · `success bool` · `validation_error enum(missing_fields)?` | client | profile-settings |
| `email_change_submitted` | Enregistrer changement d'email (email_change_save) | `auth_provider enum(password\|google\|apple)` · `success bool` · `validation_error str?` · `error_code str?` | client | profile-settings |
| `email_verification_sent` | Envoi/renvoi du lien (verify_email_send, email_verification_send) | `is_resend bool` · `result enum(success\|error)` | client | profile-settings |
| `email_verification_checked` | « J'ai vérifié mon email » (verify_email_check, email_verification_check) — met à jour `email_verified` ($set) | `result enum(verified\|not_verified\|error)` | client | profile-settings |
| `phone_saved` | Enregistrer téléphone (phone_save) — jamais le numéro | `success bool` · `validation_error enum(invalid_ca_number)?` | client | profile-settings |
| `password_changed` | Changement de mot de passe (password_change_save) | `success bool` · `validation_error enum(empty\|too_short\|mismatch)?` · `error_code str?` | client | profile-settings |
| `password_link_submitted` | Ajout credential email+mdp à un compte social, avec cycle re-auth (add_password_submit, add_password_success, add_password_error, add_password_reauth_prompt, password_link_submit) | `auth_provider enum(google\|apple)` · `result enum(success\|validation_error\|reauth_required\|reauth_cancelled\|error)` · `validation_error enum(empty_email\|empty_fields\|too_short\|mismatch)?` · `after_reauth bool` · `error_code str?` | client | profile-settings |
| `reauth_performed` | Ré-authentification par provider, tous contextes (email_reauth_social, delete_account_reauth, branche re-auth de add_password) | `context enum(email_change\|delete_account\|add_password)` · `provider enum(google\|apple\|password)` · `result enum(success\|cancelled\|error)` | client | profile-settings |
| `carrier_preference_toggled` | Switch transporteur vendeur (shipping_carrier_toggled, shipping_carrier_toggle) | `carrier_id enum(postes_canada_bureau\|ups_access_point\|penguin_pickup\|hand_delivery)` · `enabled bool` · `enabled_carriers_count_after int` · `success bool` | client | profile-settings |
| `preferences_saved` | Sauvegarde préférences tailles/marques (preferences_save ×2 cartographies ; toggles intermédiaires couverts par les counts) | `sizes_count int` · `shoe_sizes_count int` · `brands_count int` · `success bool` | client | profile-settings |
| `privacy_setting_toggled` | Switch showProfilePhoto / aiProfilingConsent (privacy_toggle) | `setting_key enum(showProfilePhoto\|aiProfilingConsent)` · `new_value bool` · `success bool` | client | profile-settings |
| `marketing_consent_changed` | Switch consentement marketing → callable setMarketingConsent, piste d'audit Loi 25 (marketing_consent_toggle) — met à jour `marketing_consent` ($set) | `new_value bool` · `success bool` | client | profile-settings |
| `user_unblocked` | Confirmation déblocage depuis /settings/blocked-users (user_unblock, user_unblock_confirm) | `blocked_user_id str` · `outcome enum(success\|error)` · `blocked_count_before int` | client | profile-settings |
| `data_export_requested` | Export Loi 25 (data_export_request) | `outcome enum(shared\|sharing_unavailable\|error)` | client | profile-settings |
| `account_deletion_started` | Étape info → confirm (delete_account_start) | `auth_provider enum` | client | profile-settings |
| `account_deletion_abandoned` | Abandon du flow (delete_account_abort) | `step_at_abort enum(info\|confirm)` | client | profile-settings |
| `account_deletion_submitted` | Soumission finale (delete_account_submit) — vérité = server account_deleted | `auth_provider enum` · `outcome enum(success\|server_refused\|validation_failed\|error)` | client | profile-settings |
| `faq_item_opened` | Accordéon FAQ (faq_item_toggle) | `faq_key str` · `expanded bool` | client | profile-settings |
| `support_contacted` | « Contacter le support » mailto (support_contact_tap) | `outcome enum(opened\|mail_unavailable\|error)` | client | profile-settings |

---

## 11. Domaine `swapzone`

| Événement | Déclencheur (actions couvertes) | Propriétés | Side | Domaine |
|---|---|---|---|---|
| `swap_zone_viewed` | Mount /swap-zone, succès ou erreur (swap_zone_viewed, swap_zone_load_failed ; couvre les portes : home_swap_zone_tap, swap_zone_opened_from_home, my_swaps_empty_cta_tapped) | `outcome enum(loaded\|error)` · `source enum(home\|profile\|my_swaps_empty\|deep_link)` · `total_items_count int?` · `my_items_count int?` · `other_items_count int?` | client | swapzone |
| `swap_deposit_opened` | Ouverture AddItemSheet (deposit_sheet_opened) | `entry_variant enum(add_button\|drop_zone)` · `my_items_count int` | client | swapzone |
| `swap_items_deposited` | Confirmation du dépôt et résolution (deposit_confirmed, deposit_succeeded, deposit_failed) | `articles_count int` · `article_ids arr` · `total_value_cents int` · `outcome enum(success\|error)` | client | swapzone |
| `swap_deposit_abandoned` | Fermeture de la sheet sans dépôt (deposit_sheet_dismissed) | `selected_count_at_dismiss int` · `had_inventory bool` | client | swapzone |
| `swap_item_removed` | Retrait confirmé d'une pièce, avec rollback en échec (zone_item_remove_confirmed, zone_item_remove_failed) | `article_id str` · `outcome enum(success\|error)` | client | swapzone |
| `swap_multi_select_started` | Long-press → mode multi-sélection mono-vendeur (zone_item_long_pressed_multi_select_started) | `seller_id str` · `item_id str` | client | swapzone |
| `swap_propose_opened` | Mount /propose-swap, toutes portes (propose_swap_viewed ; couvre : zone_item_tapped, zone_multi_select_propose_tapped, propose_swap_opened_from_article, article_propose_swap) | `entry_source enum(zone_single\|zone_multi\|article_detail)` · `receiver_id str` · `initial_receiver_items_count int` · `initial_total_value_cents int?` | client | swapzone |
| `swap_proposal_sent` ★ | Soumission de la proposition, toutes issues (propose_swap_submitted, propose_swap_succeeded, propose_swap_failed, propose_swap_validation_failed, propose_swap_blocked_user) | `outcome enum(success\|validation_failed\|blocked_user\|error)` · `swap_id str?` (retour de proposeSwap, présent si outcome=success — clé de jointure F5) · `receiver_id str` · `initiator_items_count int` · `receiver_items_count int` · `initiator_total_cents int` · `receiver_total_cents int` · `has_cash_top_up bool` · `cash_top_up_cents int` · `cash_payer enum(initiator\|receiver)?` · `has_message bool` | client | swapzone |
| `swap_propose_abandoned` | Retour sans soumettre (propose_swap_back_abandoned) | `initiator_items_count int` · `receiver_items_count int` · `had_message bool` | client | swapzone |
| `swap_viewed` | subscribeToSwap délivre le swap (swap_detail_viewed, swap_detail_not_found ; couvre my_swaps_card_tapped via source) | `swap_id str` · `outcome enum(loaded\|not_found)` · `status enum(proposed\|payment_pending\|accepted\|declined\|cancelled\|photos_pending\|shipping\|completed\|disputed\|expired)` · `is_initiator bool` · `is_top_up_payer bool` · `cash_top_up_cents int` · `exchange_mode str?` · `source enum(my_swaps\|push\|post_proposal\|deep_link)` | client | swapzone |
| `swap_accepted` | Accepter, 2 surfaces (swap_accepted, swap_accept_failed) | `swap_id str` · `outcome enum(success\|error)` · `surface enum(sticky_bar\|inline)` · `cash_top_up_cents int` | client | swapzone |
| `swap_declined` | Refus confirmé (swap_declined + échec) | `swap_id str` · `outcome enum(success\|error)` · `cash_top_up_cents int` | client | swapzone |
| `swap_cancelled` | Annulation initiateur confirmée (swap_cancelled + échec) | `swap_id str` · `outcome enum(success\|error)` | client | swapzone |
| `swap_topup_payment_started` | « Régler le complément » → checkout top-up (swap_topup_pay_tapped, swap_topup_checkout_failed ; résultat = payment_sheet_completed source swap_topup) | `swap_id str` · `cash_top_up_cents int` · `outcome enum(sheet_presented\|init_failed)` | client | swapzone |
| `swap_exchange_mode_selected` | Choix main propre / envoi postal (swap_exchange_mode_selected) | `swap_id str` · `mode enum(hand_delivery\|shipping)` | client | swapzone |
| `swap_photos_uploaded` | Upload photos avant expédition (swap_photos_uploaded + started/cancelled/échec) | `swap_id str` · `photos_count int` · `outcome enum(success\|error\|picker_cancelled)` | client | swapzone |
| `swap_shipping_confirmed` | « J'ai envoyé mon article » confirmé (swap_shipping_confirm_tapped, swap_shipping_confirmed) | `swap_id str` · `exchange_mode enum` · `outcome enum(success\|error)` | client | swapzone |
| `swap_reception_confirmed` | « J'ai reçu l'article » confirmé (swap_reception_confirm_tapped, swap_reception_confirmed) | `swap_id str` · `exchange_mode enum` · `outcome enum(success\|error)` | client | swapzone |
| `swap_dispute_opened` | Litige soumis, raison enum fermée (swap_dispute_submitted) | `swap_id str` · `reason str` (enum 4 raisons prédéfinies) · `status str` · `outcome enum(success\|error)` | client | swapzone |
| `swap_rated` | Notation post-échange (swap_rated) | `swap_id str` · `score int(1-5)` · `is_initiator bool` | client | swapzone |
| `legacy_route_redirected` | Redirect /swap-parties et /swap-party/[id] → /swap-zone (swap_legacy_route_redirected) | `legacy_route str` · `legacy_party_id str?` | client | swapzone |

---

## 12. Événements serveur (`backend` — Cloud Functions, posthog-node)

Source de vérité financière et transitions d'état : le client peut être absent au moment du fait (webhook Stripe, scheduled functions, tracking ShipEngine).

**`distinct_id` par événement** (spécifié exhaustivement — aucun événement serveur sans acteur défini) :
- **Acheteur** (`buyer_id`) : `order_created`, `order_paid`, `order_shipped`, `order_delivered`, `order_completed`, `order_cancelled`, `order_refunded` — le cycle de commande suit l'acheteur (funnel F3).
- **Vendeur** (`seller_id`) : `sale_paid` (miroir vendeur de order_paid, requis pour F6), `shipping_label_purchased`, `seller_activated`, `withdrawal_requested`, `withdrawal_paid`, `withdrawal_failed` ; `shop_tier_activated` = propriétaire de la boutique.
- **Déclarant** : `dispute_opened` et `dispute_resolved` = l'utilisateur qui a ouvert le litige (acheteur pour problem/return ; le signaleur pour no_show).
- **Payeur** (`payer_id`) : `swap_topup_paid`.
- **Initiateur** (`initiator_id`) : `swap_completed`, `swap_expired`, `swap_dispute_resolved` — les analyses côté receveur se font par jointure `swap_id`.
- **Uid supprimé** : `account_deleted`.

`$insert_id` = id métier (`transaction_id`, `withdrawal_id`, `swap_id`…) pour l'idempotence ; `sale_<transaction_id>` pour `sale_paid` (même fait que order_paid, insert_id distinct).

| Événement | Déclencheur | Propriétés | Side | Domaine |
|---|---|---|---|---|
| `order_created` | Transaction créée serveur : createShippingTransaction ou acceptMeetupOffer — SEUL événement de création de tx (pas de doublon client) | `transaction_id` · `article_id` · `buyer_id` · `seller_id` · `delivery_type enum(meetup\|shipping)` · `amount_cents` · `negotiated bool` · `source enum(shipping_checkout\|meetup_accept\|offer_accept)` | server | backend |
| `order_paid` ★ | Webhook `payment_intent.succeeded` OU payWithWallet (100 % wallet) — distinct_id acheteur | `transaction_id` · `article_id` · `buyer_id` · `seller_id` · `item_amount_cents` · `shipping_cents` · `service_fee_cents` · `tax_cents` · `buyer_total_cents` · `application_fee_cents` · `wallet_amount_cents` · `card_amount_cents` · `payment_method enum(card\|wallet\|mixed)` · `delivery_type` | server | backend |
| `sale_paid` | Émis au même moment que `order_paid`, distinct_id **vendeur** — permet les funnels vendeur (F6) qu'un funnel PostHog mono-distinct_id ne peut pas construire depuis order_paid | `transaction_id` · `article_id` · `seller_id` · `buyer_id` · `item_amount_cents` · `seller_net_cents` · `delivery_type` | server | backend |
| `shipping_label_purchased` | Achat de l'étiquette ShipEngine — distinct_id vendeur | `transaction_id` · `carrier` · `service` · `label_cost_cents` · `is_return bool` | server | backend |
| `order_shipped` | Transition tracking → shipped (webhook/checkTrackingStatus) | `transaction_id` · `carrier` · `days_since_paid num` | server | backend |
| `order_delivered` | Transition tracking → delivered | `transaction_id` · `carrier` · `transit_days num` | server | backend |
| `order_completed` | Libération des fonds (fin fenêtre protection 7 j, ou meetup complété) | `transaction_id` · `delivery_type` · `seller_net_cents` · `days_to_complete num` | server | backend |
| `order_cancelled` | Annulation effective, toutes origines — vérité des intents client `order_cancel_submitted` | `transaction_id` · `cancelled_by enum(buyer\|seller\|system_expiry)` · `stage enum(pending_payment\|paid\|label_created)` · `refunded_cents` · `article_relisted bool` | server | backend |
| `order_refunded` | Remboursement Stripe exécuté | `transaction_id` · `refund_cents` · `reason enum(delivery_failed\|lost\|dispute\|seller_cancel\|return)` | server | backend |
| `dispute_opened` | reportTransactionProblem / requestReturn → fonds gelés — distinct_id = déclarant | `transaction_id` · `type enum(problem\|return\|no_show)` · `reason_code` · `held_cents` | server | backend |
| `dispute_resolved` | Décision admin/automatisée sur un litige — distinct_id = déclarant du litige | `transaction_id` · `resolution enum(refund_buyer\|release_seller\|partial)` · `automated bool` · `days_open num` | server | backend |
| `seller_activated` ★ | Webhook `account.updated` : première fois charges_enabled && payouts_enabled | `seller_id` · `days_since_signup num` · `kyc_document_required bool` — pose `seller_onboarded=true` ($set) | server | backend |
| `withdrawal_requested` | Callable walletWithdraw validée (ledger débité) | `withdrawal_id` · `seller_id` · `amount_cents` · `balance_after_cents` | server | backend |
| `withdrawal_paid` | Webhook payout Stripe payé | `withdrawal_id` · `amount_cents` · `days_to_payout num` | server | backend |
| `withdrawal_failed` | Payout en échec / retourné | `withdrawal_id` · `amount_cents` · `failure_code` | server | backend |
| `swap_topup_paid` | Webhook Stripe complément d'échange → payment_pending→accepted — distinct_id = payer_id | `swap_id` · `cash_top_up_cents` · `payer_id` | server | backend |
| `swap_completed` | Les deux réceptions confirmées / meetup terminé — distinct_id = initiateur | `swap_id` · `items_count int` · `had_cash_top_up bool` · `days_to_complete num` | server | backend |
| `swap_expired` | Scheduled function expire un swap — distinct_id = initiateur | `swap_id` · `status_before` · `days_open num` | server | backend |
| `swap_dispute_resolved` | Résolution d'un litige swap — distinct_id = initiateur | `swap_id` · `resolution` · `automated bool` | server | backend |
| `shop_tier_activated` | Webhook Stripe pose le forfait boutique (le tier réel est serveur, jamais client) — distinct_id = propriétaire | `shop_id` · `tier enum(pro\|premium)` · `period_months` · `amount_cents` · `is_renewal bool` — pose `shop_tier` ($set) | server | backend |
| `account_deleted` | deleteUserAccount résolu — distinct_id = uid supprimé | `signup_method` · `account_age_days num` · `had_sales bool` · `had_wallet_balance bool` — suivi d'une suppression/anonymisation PostHog du profil (Loi 25) | server | backend |

---

## Annexe A — Funnels clés

> **Règle de construction** : un funnel PostHog suit UN SEUL `distinct_id`. Chaque étape ci-dessous est annotée avec son acteur ; une séquence qui change d'acteur ne peut PAS être un funnel PostHog — elle se mesure par **jointure sur id métier** (`transaction_id`, `swap_id`, `chat_id`, `article_id`) en insight SQL/HogQL. Les événements serveur portent le `distinct_id` spécifié en §12.

**F1 · Inscription** — acteur unique : le prospect (conversion : `signup_completed`)
`auth_sheet_opened` → `auth_submitted` → `auth_succeeded(outcome=needs_consent)` → `username_checked(result=available)` → `signup_profile_submitted` → `signup_completed` [→ `onboarding_completed` si premier lancement]
*Abandons : `auth_sheet_dismissed` (avant compte) · `signup_back_blocked` + absence de `signup_completed` (après compte) · reprise mesurée par `signup_resumed`.*

**F2 · Publication d'article** — acteur unique : le vendeur (conversion : `article_published`)
`sell_entry_tapped(outcome=opened)` → `sell_photo_added` → `sell_step_completed(step=capture)` → `sell_step_completed(step=photos_review)` → `ai_analysis_completed` | `ai_analysis_skipped` → `sell_step_completed(step=details)` → `sell_step_completed(step=pricing)` → `article_published`
*Frictions : `sell_validation_failed`, `sell_exit_prompted(confirmed_leave=true)`, `article_publish_failed` ; reprise : `sell_draft_resumed`.*

**F3 · Achat expédition** — acteur unique : l'acheteur, y compris les événements serveur `order_*` (conversion : `order_paid` server)
`article_viewed` → `buy_button_tapped(outcome=navigated)` → `checkout_started` → `checkout_delivery_selected(shipping)` → `shipping_estimates_loaded` → `shipping_rate_selected` → `payment_submitted` → [`payment_sheet_completed(result=success)` | `wallet_payment_completed`] → **`order_paid`** → `order_shipped` → `order_delivered` → `order_completed`
*La branche 100 % wallet ne présente AUCUN Payment Sheet : l'étape de confirmation est un OR des deux événements, sinon sous-comptage des conversions.*

**F4 · Achat meetup / offre négociée** — DEUX acteurs : la séquence complète se mesure par jointure `chat_id`/`article_id`/`transaction_id`, pas en funnel mono-utilisateur.
- *Côté acheteur (funnel valide)* — direct : `checkout_started` → [`checkout_delivery_selected(meetup)` — étape **optionnelle** : absente en auto-sélection (`checkout_started.auto_selected_delivery`, ou SHIPPING_ENABLED=false qui force meetup sans tap)] → `meetup_spot_selected` → `offer_sent(source=checkout_direct)` ; négocié : `article_viewed` → `offer_modal_opened` → `offer_amount_confirmed` → `offer_sent(source=article|chat)`.
- *Côté vendeur (funnel valide)* : `offer_responded(action=accept)` → `meetup_confirmed`.
- *Issue (l'un ou l'autre)* : `meetup_completed` → `order_completed` (server, distinct_id acheteur) ; branche shipping post-acceptation : `offer_pay_tapped` → F3 à partir de `payment_submitted`.
*Toutes les offres (article, chat, checkout direct) vivent dans le flux unique `offer_sent` — le breakdown se fait sur `source`, jamais en sommant plusieurs événements.*

**F5 · Swap** — DEUX acteurs (initiateur / receveur) : cross-acteur par jointure `swap_id` (conversion : `swap_completed` server, distinct_id initiateur)
- *Côté initiateur (funnel valide)* : `swap_zone_viewed` → `swap_items_deposited` → `swap_propose_opened` → `swap_proposal_sent(outcome=success)` (porte `swap_id`).
- *Côté receveur (funnel valide)* : `swap_viewed` → `swap_accepted` → [si payeur du complément : `swap_topup_payment_started` → `payment_sheet_completed(source=swap_topup)` → `swap_topup_paid` server].
- *Exécution (chaque partie, deux branches selon `swap_exchange_mode_selected.mode`)* : [shipping : `swap_photos_uploaded` → `swap_shipping_confirmed` → `swap_reception_confirmed`] | [hand_delivery : `swap_reception_confirmed` directement, sans photos ni envoi] → **`swap_completed`** → `swap_rated`.

**F6 · Activation vendeur** — acteur unique : le vendeur, rendu possible par `sale_paid` (distinct_id vendeur ; `order_paid` porte le distinct_id ACHETEUR et casserait le funnel)
`seller_onboarding_viewed` → `seller_account_submitted(success)` → [`kyc_document_uploaded` si requis] → **`seller_activated`** → `article_published` → `sale_paid` (server) → `withdrawal_requested` → `withdrawal_paid`

---

## Annexe B — Actions non trackées (avec raison)

Toute action des cartographies absente des tables ci-dessus figure ici. Catégories de raison : **micro** (interaction sans valeur décisionnelle, volume élevé), **$screen** (couvert par le screen tracking automatique), **état-final** (l'état est capté par l'événement de soumission), **dérivable** (mesurable par différence entre deux événements existants), **monitoring** (relève de Sentry, pas du produit), **doublon serveur** (le fait est déjà capté par un événement server, seule vérité).

| Action (cartographie) | Raison |
|---|---|
| onboarding_welcome_continue | dérivable — drop welcome→form = onboarding_gate_resolved vs onboarding_skipped(step)/onboarding_completed |
| onboarding_back_to_welcome | micro — navigation intra-écran |
| sign_out_tap / annulation de l'Alert | dérivable — seule l'issue confirmée (`user_signed_out`) compte |
| add_password_visibility_toggle | micro — oeil du champ mot de passe |
| consent_legal_link_open, legal_page_view, about_legal_link_tap | $screen — routes /legal/* et /settings/* distinguent public vs authentifié |
| home_tab_repress_scroll_top | micro |
| home_discover_load_more, search_results_load_more, favorites_load_more, search_brand_sheet_load_more | micro — pagination à fort volume ; profondeur dérivable de `article_card_tapped.position` |
| home_section_render_error | monitoring — crash technique → Sentry |
| search_query_cleared | micro — le commit suivant est capté par search_performed |
| search_recent_delete | micro — gestion mineure de l'historique |
| search_filter_chip_open, search_category_drill, search_brand_sheet_search, zone_filter_sheet_opened | état-final — la sélection est captée par search_filter_applied |
| search_result_long_press | câblage optionnel non confirmé hors favoris ; le retrait favori est couvert par article_unfavorited |
| save_search_button_tap | dérivable — intent = saved_search_created + saved_search_cancelled ; gate invité = auth_sheet_opened |
| saved_searches_screen_open | $screen — gate invité couvert par auth_sheet_opened |
| visual_search_retake | micro — itération avant visual_search_submitted |
| article_image_swipe, article_image_zoom_close, sell_preview_photo_swipe | micro — volume élevé, faible valeur |
| article_more_options_open, my_articles_menu_open, chat_more_options_open, profile_more_menu_open, swap_dispute_opened_menu | micro — ouverture de menu ; l'action choisie est trackée |
| article_favorite_toggle_failed | monitoring — rollback réseau silencieux → Sentry |
| sell_camera_flip, sell_torch_toggle | micro — réglages caméra |
| sell_photo_make_primary, edit_article_photo_make_primary | micro — curation photo, faible valeur décisionnelle |
| sell_details_field_edit (frappe titre/description), sell_price_input | état-final + PII — frappe à volume élevé ; état capté par sell_step_completed / article_published |
| edit_article_field_change (frappe titre/description/prix) | état-final + PII — frappe à volume élevé en édition ; état capté par article_updated (price_cents, photo_count, outcome) |
| sell_category_sheet_open, sell_brand_sheet_open | état-final — sélection captée par sell_field_edited |
| sell_photos_review_back, sell_preview_modify | micro — navigation retour, couverte par $screen |
| sell_success_view_article, sell_success_return_home | $screen — navigation post-succès |
| my_articles_swipe_delete_reveal | micro — la suppression confirmée est article_deleted(entry=swipe) |
| my_articles_login_cta, orders_login_cta_tapped, messages_guest_login_tap, guest_connect_tap, favorites_browse_tap (invité) | fusionné — tous captés par auth_sheet_opened(source, gate_key) |
| favorites_browse_cta (état vide connecté) | $screen — navigation vers home |
| checkout_continue_tapped | $screen — transition captée par le mount de /checkout/meetup ou /checkout/shipping |
| shipping_address_prefilled | non-action — comportement automatique au montage |
| shipping_province_selected | état-final + PII — province captée par address_saved |
| shipping_transaction_created | doublon serveur — la vérité est `order_created(source=shipping_checkout)` (server) ; la latence de création côté client relève du monitoring (Sentry), pas du produit |
| payment_sheet_cancelled_choice | dérivable — le choix aboutit à payment_retried ou order_cancel_submitted |
| success_primary_cta_tapped, success_go_home_tapped | $screen — navigation post-confirmation |
| orders_list_viewed, sales_list_viewed, my_swaps_viewed | $screen — compteurs disponibles côté data serveur |
| order_review_cta_tapped, sale_review_cta_tapped | $screen — mount de /review/[txId] ; l'issue est review_submitted |
| review_rating_selected | état-final — note captée par review_submitted |
| wallet_withdraw_form_cancelled | dérivable — withdrawal_cta_tapped(outcome=form_opened) sans withdrawal_submitted |
| wallet_protection_info_opened | micro — lecture d'info |
| wallet_bank_account_link_tapped, stripe_bank_link_tapped, wallet_payouts_blocked_banner_tapped | $screen — navigation ; l'état bloqué est porté par wallet_viewed(payouts_blocked) |
| kyc_document_picked, stripe_kyc_document_pick | état-final — l'issue est kyc_document_uploaded ; permission via permission_denied |
| bank_account_viewed, bank_replace_form_opened, bank_account_form_open | $screen / état-final — l'issue est bank_account_saved |
| chat_image_pick_open, chat_image_pick_cancelled | micro — l'issue est message_sent(type=image) ou rien |
| chat_image_viewer_open | micro |
| user_block_cancelled | dérivable — seule l'issue user_blocked compte |
| report_reason_select, report_reason_change, report_step_back | état-final — raison captée par report_submitted ; abandon par report_abandoned |
| offer_mode_select | état-final — mode capté par offer_amount_confirmed / offer_sent |
| offer_counter_panel_open, offer_modal_back | micro — l'issue est offer_countered / offer_modal_abandoned |
| markMessagesAsRead | non-action — automatique à l'ouverture, confondu avec conversation_opened |
| profile_menu_item_tap, profile_edit_tap, settings_item_tap, privacy_rgpd_item_tap, shop_manage_tier_tap | $screen — navigations ; gates par auth_sheet_opened |
| profile_photo_pick | état-final — photo_changed dans profile_updated ; permission via permission_denied |
| address_autocomplete_select, address_manual_mode_toggle | état-final — mode capté par address_saved(mode) |
| pref_size_toggle, pref_shoe_size_toggle, pref_brand_selector_open, pref_brands_confirm | état-final — counts dans preferences_saved |
| shop_image_select | micro — galerie boutique |
| shop_tier_select, shop_tier_period_select | état-final — tier+période dans shop_upgrade_submitted |
| swap_zone_back_tapped | micro — navigation |
| deposit_article_toggled | état-final — sélection captée par swap_items_deposited |
| zone_item_remove_tapped / annulation | dérivable — l'issue est swap_item_removed |
| zone_multi_select_item_toggled, zone_multi_select_cancelled | dérivable — swap_multi_select_started sans swap_propose_opened = abandon |
| propose_swap_receiver_selector_opened, propose_swap_initiator_selector_opened, propose_swap_selector_item_toggled, propose_swap_selector_closed, propose_swap_item_removed | état-final — composition captée par swap_proposal_sent |
| propose_swap_complement_payer_changed, propose_swap_complement_amount_changed | état-final — cash_payer/cash_top_up_cents dans swap_proposal_sent |
| propose_swap_message_typed | PII + volume — has_message dans swap_proposal_sent |
| my_swaps_load_failed | monitoring — Sentry ; retry capté par error_retry_tapped |
| swap_decline_tapped, swap_cancel_tapped | dérivable — issues captées par swap_declined / swap_cancelled |
| swap_photos_upload_started | état-final — l'issue est swap_photos_uploaded |
| swap_shipping_confirm_tapped, swap_reception_confirm_tapped | dérivable — issues captées par swap_shipping_confirmed / swap_reception_confirmed |

---

## Annexe C — Renvois inter-domaines (actions dont l'événement vit dans un autre domaine)

| Action cartographiée | Domaine d'origine | Événement du catalogue (domaine propriétaire) |
|---|---|---|
| buy_button_tapped, make_offer_opened, offer_* (checkout-payment) | checkout-payment | `offer_*` → chat-notifications ; `buy_button_tapped` → checkout-payment |
| meetup_request_submitted, meetup_request_failed (checkout) | checkout-payment | `offer_sent(source=checkout_direct)`, `offer_send_failed(source=checkout_direct)` (chat-notifications) |
| article_buy_tap, article_make_offer_open, offer_* (article-sell) | article-sell | `buy_button_tapped`, `offer_modal_opened`, `offer_amount_confirmed`, `offer_sent` (chat-notifications) |
| article_propose_swap, propose_swap_opened_from_article | article-sell | `swap_propose_opened` (swapzone) |
| article_report_open, report_* (article-sell, profile-settings) | article-sell / profile-settings | `report_opened`, `report_submitted`, `report_abandoned` (chat-notifications) |
| user_block_tap/confirm (profil) | profile-settings | `user_blocked(source=profile)` (chat-notifications) |
| user_unblock, user_unblock_confirm (écran /settings/blocked-users, cartographie chat-notifications) | chat-notifications | `user_unblocked` (profile-settings) |
| seller_contact_tap, swap_contact_tapped | profile-settings / swapzone | `chat_started(source)` (chat-notifications) |
| seller_like_toggle (home) | home-search | `seller_followed` / `seller_unfollowed` (profile-settings) |
| favorite_toggle, favorite_remove_longpress (profile-settings) | profile-settings | `article_favorited` / `article_unfavorited` (article-sell) |
| profile_share | profile-settings | `content_shared(content_type=profile)` (article-sell) |
| shop_view_articles_tap | profile-settings | `search_opened(source=shop)` (home-search) |
| shop_tier_payment_result, swap_topup_payment_result | profile-settings / swapzone | `payment_sheet_completed(source)` (checkout-payment) |
| zone_filter_applied, zone_filters_cleared | swapzone | `search_filter_applied` / `search_filters_cleared` (screen=swap_zone) (home-search) |
| verify_email_send/check (auth-onboarding) | auth-onboarding | `email_verification_sent` / `email_verification_checked` (profile-settings) |
| add_password_* (auth-onboarding) | auth-onboarding | `password_link_submitted`, `reauth_performed` (profile-settings) |
| preferences_save (auth-onboarding) | auth-onboarding | `preferences_saved` (profile-settings) |
| shipping_carrier_toggled (checkout-payment) | checkout-payment | `carrier_preference_toggled` (profile-settings) |
| stripe_*/bank_*/kyc_* (profile-settings) | profile-settings | `seller_onboarding_viewed`, `seller_account_submitted`, `seller_status_refreshed`, `kyc_document_uploaded`, `bank_account_saved` (checkout-payment) |
| home_notifications_tap | home-search | `notification_center_opened` (chat-notifications) |
| home_article_tap, home_seller_tap, home_brand_tap, home_swap_zone_tap, home_section_see_all_tap, home_quick_category_tap, home_search_bar_tap, home_visual_search_open | home-search | `article_card_tapped`, `profile_viewed`, `search_opened`, `swap_zone_viewed`, `visual_search_opened` (voir tables) |

---

*Total : **184 événements client** (§5 : 23 · §6 : 19 · §7 : 25 · §8 : 41 · §9 : 29 · §10 : 26 · §11 : 21) + **4 helpers transverses** (§2) + **21 événements serveur** (§12) = **209 événements**. Instrumentation recommandée via un wrapper unique `lib/analytics.ts` (typé, enum des noms d'événements, validation des props en dev — y compris le rejet des props redondantes avec les super properties) — aucun appel `posthog.capture` inline dans les écrans.*
