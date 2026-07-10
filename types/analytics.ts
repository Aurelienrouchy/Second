/**
 * Typed PostHog event catalogue.
 *
 * Source of truth: `analytics-events.md` (repo root). Every CLIENT event lives
 * in `AnalyticsEvents`; server-only events (posthog-node in Cloud Functions)
 * are mirrored in `ServerAnalyticsEvents` for documentation. To add an event,
 * add it to the catalogue first, then here — `lib/analytics.ts#track` keys off
 * `AnalyticsEvents`, so any name not in this map is a type error.
 *
 * PII rules (Loi 25) are enforced by convention: no email / displayName /
 * @pseudo / DOB / full address / phone / bank numbers in event props. The
 * only human identifier allowed anywhere is `username` — and only as a user
 * property (see `UserTraits`), never on an event.
 */

// ── Shared enums ──────────────────────────────────────────────────────────

type Platform = 'ios' | 'android';
type AuthMethod = 'email' | 'google' | 'apple';
type AuthMode = 'signin' | 'signup' | 'forgot_password';
type SignupMethod = 'email' | 'google' | 'apple';
type SizeSystem = 'US' | 'EU';
type DeliveryType = 'meetup' | 'shipping';
type OfferMode = 'meetup' | 'shipping';
type Role = 'buyer' | 'seller';
type SuccessOutcome = 'success' | 'error';
type DialogOutcome = 'confirmed' | 'cancelled';
type PaymentSource = 'checkout' | 'payment' | 'shop_upgrade' | 'swap_topup';
type ListScreen =
  | 'home'
  | 'search'
  | 'favorites'
  | 'my_articles'
  | 'my_orders'
  | 'my_sales'
  | 'wallet'
  | 'notifications'
  | 'swap_zone'
  | 'my_swaps';
type ArticleCardSource =
  | 'home_new_arrivals'
  | 'home_pour_toi'
  | 'home_price_drops'
  | 'home_discover'
  | 'search'
  | 'visual_search'
  | 'favorites'
  | 'public_profile'
  | 'my_articles'
  | 'chat_banner';
type FavoriteSource =
  | 'article_detail'
  | 'home_new_arrivals'
  | 'home_pour_toi'
  | 'home_price_drops'
  | 'home_discover'
  | 'search'
  | 'visual_search'
  | 'favorites';
type FilterScreen = 'search' | 'swap_zone';
type FilterType =
  | 'sort'
  | 'category'
  | 'colors'
  | 'sizes'
  | 'materials'
  | 'brands'
  | 'condition'
  | 'price';
type TargetType = 'article' | 'user' | 'message';
type SwapStatus =
  | 'proposed'
  | 'payment_pending'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'photos_pending'
  | 'shipping'
  | 'completed'
  | 'disputed'
  | 'expired';

// ── Client events ───────────────────────────────────────────────────────────

export interface AnalyticsEvents {
  // §2 — Fondations (transverse helpers)
  list_refreshed: { screen: ListScreen; items_count: number };
  list_filtered: {
    screen: 'messages' | 'my_articles' | 'my_swaps' | 'public_profile';
    filter: string;
    filtered_count: number;
    unread_count?: number;
  };
  error_retry_tapped: { screen: string; error_context: string; error_code?: string };
  permission_denied: {
    permission: 'camera' | 'photos';
    context: 'visual_search' | 'sell_capture' | 'chat_image' | 'profile_photo' | 'kyc';
    can_ask_again: boolean;
    action_taken?: 'settings' | 'gallery_fallback' | 'cancel';
  };

  // §5 — auth-onboarding
  onboarding_gate_resolved: { needs_onboarding: boolean };
  onboarding_completed: {
    sex_value: string;
    sizes_top_count: number;
    sizes_bottom_count: number;
    sizes_shoes_count: number;
    size_system: SizeSystem;
  };
  onboarding_skipped: {
    step: 'welcome' | 'form';
    sex_selected: boolean;
    sizes_selected_count: number;
  };
  onboarding_preference_changed: {
    field: 'sex' | 'size_system' | 'size';
    value: string;
    selected?: boolean;
    category?: 'top' | 'bottom' | 'shoes';
    from_system?: SizeSystem;
    to_system?: SizeSystem;
    system_change_confirmed?: boolean;
    sizes_reset?: boolean;
  };
  onboarding_save_failed: { retry_chosen: boolean; attempt_number: number };
  guest_session_started: { is_first_launch: boolean };
  auth_sheet_opened: {
    source: string;
    gate_key: string;
    gate_message?: string;
    has_pending_action: boolean;
  };
  auth_sheet_dismissed: {
    auth_mode: AuthMode;
    had_pending_action: boolean;
    email_field_filled: boolean;
  };
  auth_mode_switched: {
    from_mode: AuthMode;
    to_mode: AuthMode;
    email_prefilled?: boolean;
    reset_email_sent?: boolean;
  };
  auth_submitted: {
    method: AuthMethod;
    mode: 'signin' | 'signup';
    had_pending_action: boolean;
    apple_available?: boolean;
    display_name_length?: number;
  };
  auth_succeeded: {
    method: AuthMethod;
    outcome: 'signed_in' | 'needs_consent';
    had_pending_action: boolean;
  };
  auth_failed: { method: AuthMethod; mode: 'signin' | 'signup'; error_message_key: string };
  auth_form_error_shown: {
    field: 'email' | 'password' | 'display_name';
    mode: 'signin' | 'signup';
  };
  password_reset_requested: { result: 'sent' | 'error'; error_message_key?: string };
  username_checked: {
    result: 'available' | 'taken' | 'invalid_local' | 'invalid' | 'network_error';
    invalid_reason?: 'too_short' | 'invalid_chars' | 'too_long';
    username_length: number;
    attempt_index: number;
  };
  signup_age_checked: {
    result: 'valid' | 'invalid_date' | 'underage';
    age_band?: '16-17' | '18-24' | '25-34' | '35-44' | '45+';
  };
  consent_toggled: { consent_type: 'terms' | 'privacy' | 'marketing'; checked: boolean };
  signup_profile_submitted: {
    signup_method: SignupMethod;
    marketing_opt_in: boolean;
    username_length: number;
  };
  signup_completed: {
    signup_method: SignupMethod;
    marketing_opt_in: boolean;
    had_guest_session: boolean;
    had_pending_action: boolean;
  };
  signup_profile_failed: {
    error_code: 'username_taken' | 'username_invalid' | 'age_invalid' | 'consent_required' | 'network';
    username_length: number;
  };
  signup_back_blocked: { fields_filled_count: number };
  signup_resumed: { signup_method: SignupMethod; cold_resume: true };
  user_signed_out: { source: 'user_action' | 'account_deletion' };

  // §6 — home-search
  search_opened: {
    source:
      | 'home_header'
      | 'home_quick_category'
      | 'home_see_all'
      | 'home_brand'
      | 'shop'
      | 'saved_search'
      | 'visual_fallback'
      | 'deep_link'
      | 'other';
    entry_source: 'query' | 'category' | 'category_path' | 'brands' | 'shop' | 'filters' | 'browse' | 'none';
    is_browse_all: boolean;
    initial_category_path?: string[];
    initial_brands?: string[];
    section_id?: string;
    brand_name?: string;
  };
  search_performed: {
    trigger: 'typed' | 'submit' | 'recent' | 'trending' | 'restored';
    query: string;
    query_length: number;
    has_active_filters: boolean;
    active_filter_keys: string[];
    category_path?: string[];
    sort_by: string;
    trending_term?: string;
    history_item_age?: number;
  };
  search_results_loaded: {
    outcome: 'success' | 'empty' | 'error';
    results_count: number;
    has_next_page: boolean;
    latency_ms: number;
    query_length: number;
    active_filter_keys: string[];
    sort_by: string;
    category_path?: string[];
    is_browse_all: boolean;
    empty_reason?: 'query' | 'filters';
    error_code?: string;
  };
  search_closed: { had_results: boolean; query_length: number; any_filter_active: boolean };
  search_filter_applied: {
    screen: FilterScreen;
    filter_type: FilterType;
    values?: string[];
    values_count?: number;
    sort_value?: string;
    category_path?: string[];
    category_depth?: number;
    size_system?: string;
    min_price_cents?: number;
    max_price_cents?: number;
    price_was_swapped?: boolean;
    results_count_after?: number;
  };
  search_filter_removed: {
    screen: FilterScreen;
    filter_type: FilterType;
    remaining_active_filter_keys: string[];
  };
  search_filters_cleared: {
    screen: FilterScreen;
    cleared_filter_keys: string[];
    query_length?: number;
  };
  custom_brand_added: {
    brand_label: string;
    source: 'search_filter' | 'sell_form' | 'preferences';
  };
  article_card_tapped: {
    article_id: string;
    source: ArticleCardSource;
    position?: number;
    price_cents: number;
    brand?: string;
    condition?: string;
    is_sold: boolean;
    reduction_pct?: number;
    similarity_pct?: number;
    price_changed?: boolean;
    query_length?: number;
  };
  saved_search_created: {
    outcome: SuccessOutcome;
    notify_new_items: boolean;
    name_length: number;
    name_is_default: boolean;
    query_length: number;
    filter_keys: string[];
  };
  saved_search_cancelled: { notify_toggled: boolean; name_edited: boolean };
  saved_search_opened: {
    saved_search_id: string;
    new_items_count: number;
    has_query: boolean;
    filter_keys: string[];
    notify_enabled: boolean;
  };
  saved_search_deleted: {
    saved_search_id: string;
    outcome: 'confirmed' | 'error';
    notify_enabled: boolean;
  };
  saved_search_notify_toggled: {
    saved_search_id: string;
    new_value: boolean;
    outcome: SuccessOutcome;
  };
  visual_search_opened: { source: 'home' | 'search'; query_length?: number };
  visual_search_photo_picked: {
    method: 'camera' | 'gallery';
    outcome: 'success' | 'cancelled' | 'error';
    facing?: 'back' | 'front';
    source: 'home' | 'search';
  };
  visual_search_submitted: { source: 'home' | 'search'; from_gallery: boolean };
  visual_search_performed: {
    outcome: 'success' | 'empty' | 'error';
    results_count: number;
    error_code?: 'unauthenticated' | 'resource-exhausted' | 'invalid-argument' | 'internal' | 'unavailable';
    latency_ms: number;
    is_retry: boolean;
  };
  visual_search_abandoned: {
    action: 'cancel' | 'new_search' | 'text_fallback';
    stage: 'camera' | 'preview' | 'results_empty' | 'permission_denied';
  };

  // §7 — article-sell
  article_viewed: {
    article_id: string;
    seller_id: string;
    price_cents: number;
    brand?: string;
    category_ids: string[];
    condition: string;
    is_sold: boolean;
    source: string;
    is_swap_context: boolean;
  };
  article_image_zoomed: { article_id: string; image_index: number; image_count: number };
  article_favorited: {
    article_id: string;
    seller_id?: string;
    price_cents?: number;
    brand?: string;
    source: FavoriteSource;
    favorites_count_after: number;
  };
  article_unfavorited: {
    article_id: string;
    seller_id?: string;
    price_cents?: number;
    brand?: string;
    source: FavoriteSource;
    favorites_count_after: number;
    via: 'heart' | 'long_press';
  };
  favorite_limit_reached: { article_id: string; favorites_count: number };
  content_shared: {
    content_type: 'article' | 'profile';
    content_id: string;
    price_cents?: number;
    brand?: string;
  };
  article_edit_opened: {
    article_id: string;
    outcome: 'loaded' | 'not_found' | 'not_owner' | 'sold_blocked' | 'load_error';
    source: 'article_detail' | 'my_articles';
  };
  sell_field_edited: {
    screen: 'sell' | 'edit';
    field:
      | 'category'
      | 'condition'
      | 'brand'
      | 'size'
      | 'colors'
      | 'materials'
      | 'neighborhoods'
      | 'package_size'
      | 'hand_delivery'
      | 'shipping';
    value?: string;
    enabled?: boolean;
    selected_count_after?: number;
    matched_ai_suggestion?: boolean;
    ai_confidence?: string;
  };
  article_updated: {
    article_id: string;
    outcome: 'saved' | 'validation_failed' | 'server_error';
    validation_error?: string;
    price_cents: number;
    photo_count: number;
    local_photos_uploaded_count: number;
    is_hand_delivery: boolean;
    is_shipping: boolean;
  };
  article_sold_toggled: {
    article_id: string;
    new_state: 'sold' | 'relisted';
    success: boolean;
    source: 'article_detail' | 'my_articles';
  };
  article_deleted: {
    article_id: string;
    is_sold: boolean;
    outcome: SuccessOutcome;
    source: 'article_detail' | 'my_articles';
    entry?: 'menu' | 'swipe';
    price_cents?: number;
  };
  sell_entry_tapped: {
    outcome: 'opened' | 'auth_gated' | 'age_gated' | 'email_gate';
    platform: Platform;
    has_existing_draft: boolean;
    source: 'tab' | 'my_articles_empty';
  };
  sell_draft_resumed: {
    draft_step: '1' | '1b' | '2' | '3' | '4';
    photo_count: number;
    has_ai_result: boolean;
    platform: Platform;
  };
  sell_draft_discarded: {
    draft_step: '1' | '1b' | '2' | '3' | '4';
    photo_count: number;
    platform: Platform;
  };
  sell_photo_added: {
    screen: 'capture' | 'photos_review' | 'edit';
    method: 'camera' | 'gallery';
    count_added: number;
    photo_count_after: number;
    cancelled?: boolean;
  };
  sell_photo_removed: {
    screen: 'capture' | 'photos_review' | 'edit';
    photo_index: number;
    photo_count_after: number;
  };
  sell_exit_prompted: {
    flow_step: 'capture' | 'details' | 'pricing' | 'edit';
    confirmed_leave: boolean;
    photo_count?: number;
    has_price?: boolean;
    has_unsaved_changes?: boolean;
  };
  sell_step_completed: {
    step: 'capture' | 'photos_review' | 'details' | 'pricing';
    photo_count?: number;
    prefilled_count?: number;
    ai_used?: boolean;
    category_ids?: string[];
    has_brand?: boolean;
    has_size?: boolean;
    colors_count?: number;
    materials_count?: number;
    price_cents?: number;
    is_hand_delivery?: boolean;
    is_shipping?: boolean;
    neighborhoods_count?: number;
    package_size?: 'small' | 'medium' | 'large';
  };
  sell_validation_failed: {
    step: 'details' | 'pricing';
    missing_fields: string[];
    errors: string[];
  };
  ai_analysis_started: {
    photo_count: number;
    hydrated_from_draft: boolean;
    attempt_number: number;
  };
  ai_analysis_completed: {
    photo_count: number;
    prefilled_count: number;
    detected_category: boolean;
    detected_brand: boolean;
    detected_size: boolean;
    duration_ms: number;
  };
  ai_analysis_failed: { photo_count: number; error_code: string; attempt_number: number };
  ai_analysis_skipped: {
    photo_count: number;
    analysis_state_at_tap: 'idle' | 'loading' | 'error';
  };
  article_published: {
    article_id: string;
    price_cents: number;
    category_ids: string[];
    condition: string;
    photo_count: number;
    has_brand: boolean;
    has_size: boolean;
    colors_count: number;
    materials_count: number;
    is_hand_delivery: boolean;
    is_shipping: boolean;
    neighborhoods_count: number;
    package_size?: string;
    ai_used: boolean;
  };
  article_publish_failed: {
    reason: 'client_validation' | 'server_error' | 'email_gate';
    error_code?: string;
    missing_fields?: string[];
  };

  // §8 — checkout-payment
  buy_button_tapped: {
    article_id: string;
    seller_id: string;
    price_cents: number;
    outcome: 'navigated' | 'blocked_sold' | 'blocked_own' | 'auth_gated';
  };
  checkout_started: {
    article_id: string;
    seller_id: string;
    price_cents: number;
    has_meetup_option: boolean;
    has_shipping_option: boolean;
    has_negotiated_price: boolean;
    auto_selected_delivery?: string;
  };
  checkout_blocked: {
    article_id: string;
    guard_type: 'network_error' | 'not_found' | 'sold' | 'own_article' | 'fallback_rate';
    cta_chosen?: 'retry_rates' | 'switch_meetup';
  };
  checkout_delivery_selected: {
    article_id: string;
    delivery_type: DeliveryType;
    via: 'card' | 'shipping_unavailable';
    price_cents: number;
  };
  meetup_spot_selected: {
    article_id: string;
    option: 'seller_spot' | 'via_chat';
    spot_category?: string;
    neighborhood_id?: string;
    seller_spots_count: number;
  };
  shipping_estimates_loaded: {
    article_id: string;
    rates_count: number;
    is_fallback: boolean;
    first_rate_cents: number;
    postal_code_fsa: string;
  };
  shipping_rate_selected: {
    carrier: string;
    service: string;
    amount_cents: number;
    delivery_days?: number;
    is_fallback_rate: boolean;
    rate_index: number;
  };
  wallet_payment_toggled: {
    screen: 'checkout' | 'payment';
    enabled: boolean;
    wallet_balance_cents: number;
    total_cents: number;
    covers_all: boolean;
  };
  payment_submitted: {
    screen: 'checkout' | 'payment';
    transaction_id?: string;
    article_id?: string;
    final_price_cents: number;
    shipping_cents: number;
    service_fee_cents: number;
    tax_cents: number;
    total_cents: number;
    uses_wallet: boolean;
    wallet_covers_all: boolean;
    card_amount_cents: number;
    is_fallback_rate?: boolean;
    has_negotiated_price?: boolean;
  };
  wallet_payment_completed: {
    screen: 'checkout' | 'payment';
    transaction_id: string;
    total_cents: number;
  };
  payment_sheet_presented: {
    source: PaymentSource;
    context_id: string;
    server_buyer_total_cents: number;
    wallet_amount_cents?: number;
    is_retry: boolean;
  };
  payment_sheet_completed: {
    source: PaymentSource;
    result: 'success' | 'cancelled' | 'failed';
    context_id: string;
    amount_cents: number;
    error_code?: string;
    decline_code?: string;
    error_type?: string;
  };
  payment_init_failed: {
    transaction_id?: string;
    failure_type: 'rate_expired' | 'article_unavailable' | 'rate_limited' | 'blocked_users' | 'other';
    error_code?: string;
  };
  payment_retried: { transaction_id: string; previous_error_code?: string; uses_wallet: boolean };
  payment_confirmation_polled: {
    transaction_id: string;
    outcome: 'confirmed' | 'timeout';
    poll_duration_ms: number;
  };
  order_confirmation_viewed: {
    delivery_type: DeliveryType;
    transaction_id?: string;
    total_cents?: number;
    has_chat_id: boolean;
  };
  payment_screen_viewed: {
    transaction_id: string;
    total_cents: number;
    delivery_type: DeliveryType;
    wallet_balance_cents: number;
  };
  payment_blocked: {
    transaction_id: string;
    reason: 'not_found' | 'forbidden' | 'already_processed';
  };
  order_cancel_submitted: {
    transaction_id: string;
    role: Role;
    source: 'checkout_failure' | 'payment_screen' | 'sale_detail';
    status_at_cancel: 'pending_payment' | 'paid' | 'label_created';
    total_cents?: number;
    success: boolean;
    error_code?: string;
  };
  order_card_tapped: {
    role: Role;
    transaction_id: string;
    status: string;
    delivery_type: DeliveryType;
    destination: 'payment' | 'chat' | 'article';
    from_deep_link?: boolean;
  };
  review_submitted: {
    transaction_id: string;
    article_id: string;
    transaction_type: 'achat' | 'vente';
    rating: number;
    comment_length: number;
  };
  review_submit_failed: {
    transaction_id: string;
    rating?: number;
    failure_type: 'validation_rating' | 'validation_comment' | 'server';
    error_code?: string;
  };
  review_blocked: { transaction_id: string; transaction_status: string };
  wallet_viewed: {
    has_wallet: boolean;
    balance_cents: number;
    pending_balance_cents: number;
    held_balance_cents: number;
    seller_debt_cents: number;
    has_active_dispute_hold: boolean;
    payouts_blocked: boolean;
    withdrawals_in_progress_count: number;
  };
  wallet_activated: { success: boolean; error_code?: string };
  withdrawal_cta_tapped: {
    outcome: 'form_opened' | 'blocked';
    balance_cents: number;
    blocked_reason?: 'debt' | 'no_stripe_account' | 'payouts_disabled';
    cta_chosen?: 'configure' | 'resolve' | 'later';
  };
  withdrawal_submitted: {
    amount_cents: number;
    validation_result: 'ok' | 'invalid' | 'below_min' | 'insufficient';
    success: boolean;
    failure_type?: 'dispute' | 'debt' | 'other';
    error_code?: string;
  };
  seller_onboarding_viewed: {
    has_account: boolean;
    account_status: 'none' | 'pending' | 'active' | 'restricted';
    charges_enabled: boolean;
    payouts_enabled: boolean;
    requirements_currently_due_count: number;
    requirements_past_due_count: number;
    shows_kyc_upload: boolean;
    age_gate_shown: boolean;
  };
  seller_account_submitted: {
    validation_result: 'ok' | 'field_error';
    failed_field?: string;
    success: boolean;
    charges_enabled_after?: boolean;
    requirements_count_after?: number;
    error_code?: string;
  };
  seller_status_refreshed: {
    screen: 'stripe_onboarding' | 'bank_account';
    account_status_before: string;
    account_status_after: string;
    payouts_enabled_after?: boolean;
  };
  kyc_document_uploaded: {
    has_back_side: boolean;
    success: boolean;
    requirements_remaining_count?: number;
    payouts_enabled_after?: boolean;
    error_code?: string;
  };
  bank_account_saved: {
    is_replacement: boolean;
    validation_result: 'ok' | 'transit_invalid' | 'institution_invalid' | 'account_invalid';
    success: boolean;
    error_code?: string;
  };
  tracking_refreshed: { transaction_id: string; tracking_status: string; success: boolean };
  tracking_link_opened: {
    transaction_id: string;
    carrier_code: string;
    tracking_status: string;
  };
  shipping_label_downloaded: { transaction_id: string; status: string };
  transaction_problem_reported: {
    transaction_id: string;
    status: string;
    reason_code: 'not_received_despite_delivered' | 'not_as_described' | 'damaged' | 'other';
    details_length: number;
    success: boolean;
    error_code?: string;
  };
  refund_requested: {
    transaction_id: string;
    status: 'delivery_failed' | 'lost';
    success: boolean;
    redirected_to_report: boolean;
    error_code?: string;
  };
  return_requested: {
    transaction_id: string;
    reason_code: 'not_as_described' | 'damaged' | 'wrong_item' | 'other';
    success: boolean;
    error_code?: string;
  };
  return_label_opened: { transaction_id: string };
  automated_decision_explained: {
    transaction_id: string;
    decision_type: string;
    opened: boolean;
  };
  automated_decision_contested: {
    transaction_id: string;
    decision_type: string;
    reason_code: 'disagree_decision' | 'incorrect_information' | 'special_circumstances' | 'other';
    success: boolean;
  };

  // §9 — chat-notifications
  conversation_opened: {
    chat_id: string;
    conversation_type: 'ventes' | 'achats' | 'autres';
    unread_count: number;
    is_blocked: boolean;
    has_article: boolean;
    article_id?: string;
    last_message_type: 'text' | 'image' | 'offer' | 'system';
  };
  chat_started: {
    chat_id: string;
    source: 'article' | 'profile' | 'swap';
    article_id?: string;
    other_user_id: string;
    is_new_chat: boolean;
    outcome: SuccessOutcome;
  };
  message_sent: {
    chat_id: string;
    message_type: 'text' | 'image';
    message_length?: number;
    has_article: boolean;
    is_seller: boolean;
    outcome: SuccessOutcome;
  };
  blocked_action_attempted: {
    chat_id: string;
    attempted_action: 'message' | 'image' | 'offer';
  };
  offer_modal_opened: {
    source: 'article' | 'chat';
    article_id: string;
    price_cents: number;
    default_mode: OfferMode;
    blocked_reason:
      | 'none'
      | 'user_blocked'
      | 'no_price'
      | 'sold'
      | 'inactive'
      | 'pending_offer_exists'
      | 'own_article'
      | 'auth_gated';
  };
  offer_amount_confirmed: {
    article_id: string;
    offer_amount_cents: number;
    list_price_cents: number;
    discount_pct: number;
    mode: OfferMode;
    validation_result: 'ok' | 'invalid' | 'too_high' | 'low_warned_continued' | 'low_warned_cancelled';
    message_length: number;
  };
  offer_location_selected: {
    neighborhood_id?: string;
    spot_category?: string;
    is_custom_spot: boolean;
    is_seller_neighborhood?: boolean;
    search_used?: boolean;
  };
  offer_sent: {
    article_id: string;
    seller_id: string;
    chat_id: string;
    message_id: string;
    source: 'article' | 'chat' | 'checkout_direct';
    mode: OfferMode;
    offer_amount_cents: number;
    list_price_cents: number;
    discount_pct: number;
    has_message: boolean;
    spot_category?: string;
    neighborhood_id?: string;
  };
  offer_send_failed: {
    article_id: string;
    source: 'article' | 'chat' | 'checkout_direct';
    mode: OfferMode;
    offer_amount_cents: number;
    failure_type?: 'blocked_users' | 'server_error';
    error_code?: string;
  };
  offer_modal_abandoned: {
    article_id: string;
    step_at_close: 'offer' | 'location' | 'confirm';
    mode: OfferMode;
    offer_amount_entered: boolean;
  };
  offer_responded: {
    chat_id: string;
    message_id: string;
    article_id: string;
    action: 'accept' | 'reject';
    dialog_outcome: DialogOutcome;
    result?: SuccessOutcome;
    error_code?: string;
    offer_amount_cents: number;
    is_meetup_offer: boolean;
    role: Role;
  };
  offer_countered: {
    chat_id: string;
    article_id: string;
    counter_type: 'price' | 'location' | 'time';
    original_amount_cents?: number;
    new_amount_cents?: number;
    neighborhood_id?: string;
    hours_until_meetup?: number;
    validation_result: 'ok' | 'invalid' | 'too_high' | 'empty' | 'bad_format' | 'past_date';
    success: boolean;
  };
  offer_pay_tapped: {
    chat_id: string;
    article_id?: string;
    offer_amount_cents: number;
    transaction_exists: boolean;
    destination: 'payment' | 'checkout' | 'error';
  };
  meetup_confirmed: {
    chat_id: string;
    message_id: string;
    article_id: string;
    offer_amount_cents: number;
    dialog_outcome: DialogOutcome;
    result?: SuccessOutcome;
  };
  meetup_completed: {
    chat_id: string;
    article_id: string;
    transaction_id?: string;
    offer_amount_cents: number;
    role: Role;
    dialog_outcome: DialogOutcome;
    result?: SuccessOutcome;
    error_code?: string;
  };
  meetup_no_show_reported: {
    chat_id: string;
    article_id: string;
    role: Role;
    dialog_outcome: DialogOutcome;
    result?: SuccessOutcome;
  };
  user_blocked: { blocked_user_id: string; source: 'chat' | 'profile'; success: boolean };
  report_opened: {
    target_type: TargetType;
    target_id: string;
    source_screen: 'chat' | 'public_profile' | 'article_detail';
  };
  report_submitted: {
    target_type: TargetType;
    target_id: string;
    reason:
      | 'harassment'
      | 'scam'
      | 'spam'
      | 'inappropriate_content'
      | 'counterfeit'
      | 'dangerous_item'
      | 'other';
    has_description: boolean;
    success: boolean;
  };
  report_abandoned: { target_type: TargetType; step_reached: 'reason' | 'description' };
  notification_center_opened: { unread_count: number };
  notification_opened: {
    notification_id: string;
    notification_type: string;
    was_unread: boolean;
    destination: 'deep_link' | 'chat' | 'article' | 'swap_party' | 'none';
  };
  notification_deleted: { notification_type: string; was_unread: boolean };
  notifications_marked_all_read: { unread_count: number; total_count: number };
  notification_pref_toggled: {
    pref_key:
      | 'push'
      | 'email'
      | 'newMessages'
      | 'newOrders'
      | 'priceDrops'
      | 'articleFavorited'
      | 'offerReceived'
      | 'offerResponse';
    new_value: boolean;
    os_permission_missing: boolean;
    success: boolean;
  };
  push_permission_requested: {
    granted: boolean;
    can_ask_again: boolean;
    chose_open_settings: boolean;
  };
  push_received: { notification_type: string; suppressed_in_active_chat: boolean };
  push_opened: {
    notification_type: string;
    from_killed_state: boolean;
    destination_route: 'chat' | 'article' | 'swap' | 'my-orders' | 'search' | 'notifications' | 'deep_link_fallback';
  };
  push_token_registered: {
    permission_status: string;
    is_fcm_token: boolean;
    platform: Platform;
  };

  // §10 — profile-settings
  profile_viewed: {
    profile_user_id: string;
    outcome: 'loaded' | 'not_found';
    is_own_profile: boolean;
    articles_count?: number;
    reviews_count?: number;
    followers_count?: number;
    rating?: number;
    source: 'home_featured' | 'article' | 'chat' | 'review' | 'liked_sellers' | 'search' | 'other';
  };
  seller_followed: {
    seller_id: string;
    source: 'public_profile' | 'home_featured' | 'liked_sellers';
    liked_sellers_count_after: number;
  };
  seller_unfollowed: {
    seller_id: string;
    source: 'public_profile' | 'home_featured' | 'liked_sellers';
    liked_sellers_count_after: number;
  };
  shop_viewed: {
    shop_id: string;
    shop_type: string;
    shop_status: string;
    articles_count: number;
    is_owner: boolean;
    has_website: boolean;
    has_social: boolean;
  };
  shop_contact_tapped: {
    shop_id: string;
    channel: 'phone' | 'email' | 'website' | 'instagram' | 'facebook';
  };
  shop_upgrade_submitted: {
    shop_id: string;
    tier: 'pro' | 'premium';
    period_months: 1 | 3 | 6 | 12;
    estimated_total_cents: number;
    current_tier: string;
    success: boolean;
  };
  profile_updated: {
    success: boolean;
    validation_error?: 'empty_name' | 'invalid_name_chars';
    error_code?: string;
    photo_changed: boolean;
    bio_length: number;
  };
  address_saved: {
    mode: 'autocomplete' | 'manual';
    province: string;
    has_geo?: boolean;
    success: boolean;
    validation_error?: 'missing_fields';
  };
  email_change_submitted: {
    auth_provider: 'password' | 'google' | 'apple';
    success: boolean;
    validation_error?: string;
    error_code?: string;
  };
  email_verification_sent: { is_resend: boolean; result: SuccessOutcome };
  email_verification_checked: { result: 'verified' | 'not_verified' | 'error' };
  phone_saved: { success: boolean; validation_error?: 'invalid_ca_number' };
  password_changed: {
    success: boolean;
    validation_error?: 'empty' | 'too_short' | 'mismatch';
    error_code?: string;
  };
  password_link_submitted: {
    auth_provider: 'google' | 'apple';
    result: 'success' | 'validation_error' | 'reauth_required' | 'reauth_cancelled' | 'error';
    validation_error?: 'empty_email' | 'empty_fields' | 'too_short' | 'mismatch';
    after_reauth: boolean;
    error_code?: string;
  };
  reauth_performed: {
    context: 'email_change' | 'delete_account' | 'add_password';
    provider: 'google' | 'apple' | 'password';
    result: 'success' | 'cancelled' | 'error';
  };
  carrier_preference_toggled: {
    carrier_id: 'postes_canada_bureau' | 'ups_access_point' | 'penguin_pickup' | 'hand_delivery';
    enabled: boolean;
    enabled_carriers_count_after: number;
    success: boolean;
  };
  preferences_saved: {
    sizes_count: number;
    shoe_sizes_count: number;
    brands_count: number;
    success: boolean;
  };
  privacy_setting_toggled: {
    setting_key: 'showProfilePhoto' | 'aiProfilingConsent';
    new_value: boolean;
    success: boolean;
  };
  marketing_consent_changed: { new_value: boolean; success: boolean };
  user_unblocked: {
    blocked_user_id: string;
    outcome: SuccessOutcome;
    blocked_count_before: number;
  };
  data_export_requested: { outcome: 'shared' | 'sharing_unavailable' | 'error' };
  account_deletion_started: { auth_provider: string };
  account_deletion_abandoned: { step_at_abort: 'info' | 'confirm' };
  account_deletion_submitted: {
    auth_provider: string;
    outcome: 'success' | 'server_refused' | 'validation_failed' | 'error';
  };
  faq_item_opened: { faq_key: string; expanded: boolean };
  support_contacted: { outcome: 'opened' | 'mail_unavailable' | 'error' };

  // §11 — swapzone
  swap_zone_viewed: {
    outcome: 'loaded' | 'error';
    source: 'home' | 'profile' | 'my_swaps_empty' | 'deep_link';
    total_items_count?: number;
    my_items_count?: number;
    other_items_count?: number;
  };
  swap_deposit_opened: { entry_variant: 'add_button' | 'drop_zone'; my_items_count: number };
  swap_items_deposited: {
    articles_count: number;
    article_ids: string[];
    total_value_cents: number;
    outcome: SuccessOutcome;
  };
  swap_deposit_abandoned: { selected_count_at_dismiss: number; had_inventory: boolean };
  swap_item_removed: { article_id: string; outcome: SuccessOutcome };
  swap_multi_select_started: { seller_id: string; item_id: string };
  swap_propose_opened: {
    entry_source: 'zone_single' | 'zone_multi' | 'article_detail';
    receiver_id: string;
    initial_receiver_items_count: number;
    initial_total_value_cents?: number;
  };
  swap_proposal_sent: {
    outcome: 'success' | 'validation_failed' | 'blocked_user' | 'error';
    swap_id?: string;
    receiver_id: string;
    initiator_items_count: number;
    receiver_items_count: number;
    initiator_total_cents: number;
    receiver_total_cents: number;
    has_cash_top_up: boolean;
    cash_top_up_cents: number;
    cash_payer?: 'initiator' | 'receiver';
    has_message: boolean;
  };
  swap_propose_abandoned: {
    initiator_items_count: number;
    receiver_items_count: number;
    had_message: boolean;
  };
  swap_viewed: {
    swap_id: string;
    outcome: 'loaded' | 'not_found';
    status: SwapStatus;
    is_initiator: boolean;
    is_top_up_payer: boolean;
    cash_top_up_cents: number;
    exchange_mode?: string;
    source: 'my_swaps' | 'push' | 'post_proposal' | 'deep_link';
  };
  swap_accepted: {
    swap_id: string;
    outcome: SuccessOutcome;
    surface: 'sticky_bar' | 'inline';
    cash_top_up_cents: number;
  };
  swap_declined: { swap_id: string; outcome: SuccessOutcome; cash_top_up_cents: number };
  swap_cancelled: { swap_id: string; outcome: SuccessOutcome };
  swap_topup_payment_started: {
    swap_id: string;
    cash_top_up_cents: number;
    outcome: 'sheet_presented' | 'init_failed';
  };
  swap_exchange_mode_selected: { swap_id: string; mode: 'hand_delivery' | 'shipping' };
  swap_photos_uploaded: {
    swap_id: string;
    photos_count: number;
    outcome: 'success' | 'error' | 'picker_cancelled';
  };
  swap_shipping_confirmed: { swap_id: string; exchange_mode: string; outcome: SuccessOutcome };
  swap_reception_confirmed: { swap_id: string; exchange_mode: string; outcome: SuccessOutcome };
  swap_dispute_opened: {
    swap_id: string;
    reason: string;
    status: string;
    outcome: SuccessOutcome;
  };
  swap_rated: { swap_id: string; score: number; is_initiator: boolean };
  legacy_route_redirected: { legacy_route: string; legacy_party_id?: string };
}

// ── User properties (identify / $set) — non-PII traits ────────────────────────

export interface UserTraits {
  username?: string;
  signup_method?: SignupMethod;
  created_at?: string;
  province?: string;
  has_shop?: boolean;
  shop_tier?: 'basic' | 'pro' | 'premium';
  seller_onboarded?: boolean;
  articles_count?: number;
  email_verified?: boolean;
  marketing_consent?: boolean;
  has_wallet?: boolean;
  onboarding_completed?: boolean;
  preferred_size_system?: SizeSystem;
}

// ── Server events (posthog-node, Cloud Functions) — documentation only ────────

export interface ServerAnalyticsEvents {
  order_created: {
    transaction_id: string;
    article_id: string;
    buyer_id: string;
    seller_id: string;
    delivery_type: DeliveryType;
    amount_cents: number;
    negotiated: boolean;
    source: 'shipping_checkout' | 'meetup_accept' | 'offer_accept';
  };
  order_paid: {
    transaction_id: string;
    article_id: string;
    buyer_id: string;
    seller_id: string;
    item_amount_cents: number;
    shipping_cents: number;
    service_fee_cents: number;
    tax_cents: number;
    buyer_total_cents: number;
    application_fee_cents: number;
    wallet_amount_cents: number;
    card_amount_cents: number;
    payment_method: 'card' | 'wallet' | 'mixed';
    delivery_type: DeliveryType;
  };
  sale_paid: {
    transaction_id: string;
    article_id: string;
    seller_id: string;
    buyer_id: string;
    item_amount_cents: number;
    seller_net_cents: number;
    delivery_type: DeliveryType;
  };
  shipping_label_purchased: {
    transaction_id: string;
    carrier: string;
    service: string;
    label_cost_cents: number;
    is_return: boolean;
  };
  order_shipped: { transaction_id: string; carrier: string; days_since_paid: number };
  order_delivered: { transaction_id: string; carrier: string; transit_days: number };
  order_completed: {
    transaction_id: string;
    delivery_type: DeliveryType;
    seller_net_cents: number;
    days_to_complete: number;
  };
  order_cancelled: {
    transaction_id: string;
    cancelled_by: 'buyer' | 'seller' | 'system_expiry';
    stage: 'pending_payment' | 'paid' | 'label_created';
    refunded_cents: number;
    article_relisted: boolean;
  };
  order_refunded: {
    transaction_id: string;
    refund_cents: number;
    reason: 'delivery_failed' | 'lost' | 'dispute' | 'seller_cancel' | 'return';
  };
  dispute_opened: {
    transaction_id: string;
    type: 'problem' | 'return' | 'no_show';
    reason_code: string;
    held_cents: number;
  };
  dispute_resolved: {
    transaction_id: string;
    resolution: 'refund_buyer' | 'release_seller' | 'partial';
    automated: boolean;
    days_open: number;
  };
  seller_activated: {
    seller_id: string;
    days_since_signup: number;
    kyc_document_required: boolean;
  };
  withdrawal_requested: {
    withdrawal_id: string;
    seller_id: string;
    amount_cents: number;
    balance_after_cents: number;
  };
  withdrawal_paid: { withdrawal_id: string; amount_cents: number; days_to_payout: number };
  withdrawal_failed: { withdrawal_id: string; amount_cents: number; failure_code: string };
  swap_topup_paid: { swap_id: string; cash_top_up_cents: number; payer_id: string };
  swap_completed: {
    swap_id: string;
    items_count: number;
    had_cash_top_up: boolean;
    days_to_complete: number;
  };
  swap_expired: { swap_id: string; status_before: string; days_open: number };
  swap_dispute_resolved: { swap_id: string; resolution: string; automated: boolean };
  shop_tier_activated: {
    shop_id: string;
    tier: 'pro' | 'premium';
    period_months: number;
    amount_cents: number;
    is_renewal: boolean;
  };
  account_deleted: {
    signup_method: string;
    account_age_days: number;
    had_sales: boolean;
    had_wallet_balance: boolean;
  };
}
