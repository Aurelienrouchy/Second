# Firestore Data Model - Second

## Collections Overview

| # | Collection | Type | Description |
|---|-----------|------|-------------|
| 1 | `articles` | Root | Main product listings (source of truth for articles) |
| 2 | `products` | Root | Legacy product docs (search index source, kept in sync) |
| 3 | `users` | Root | User profiles and preferences |
| 4 | `users/{uid}/savedSearches` | Sub-collection | User's saved search alerts |
| 5 | `users/{uid}/searchHistory` | Sub-collection | User's recent search queries |
| 5b | `users/{uid}/consents` | Sub-collection | Legal consent records (CGU, privacy policy, marketing) — server-write only |
| 5c | `usernames` | Root | Uniqueness registry for the immutable `@handle` (doc id = username) — server-only |
| 6 | `favorites` | Root | Per-user favorite article IDs |
| 7 | `chats` | Root | Chat threads between two users |
| 8 | `messages` | Root | Individual chat messages |
| 9 | `transactions` | Root | Purchase transactions (Stripe Connect payments) |
| 10 | `withdrawal_requests` | Root | Seller withdrawal requests |
| 11 | `avis` | Root | User reviews / ratings |
| 12 | `swaps` | Root | Swap proposals between users (optional Stripe cash top-up) |
| 13 | `swapParties` | Root | Single permanent generalist Swap Zone (doc id `generalist`) |
| 14 | `swapPartyItems` | Root | Articles deposited in the Swap Zone |
| 16 | `notifications` | Root | Push notification records |
| 16b | `operational_notice_receipts` | Root | Server-only immutable in-app commit receipts and resumable optional transport state; not proof of device delivery or reading |
| 16c | `privacy_incidents/{id}/cai_notifications` | Sub-collection | Private immutable operator declarations of documented external CAI actions; the app does not send these actions |
| 16d | `privacy_incidents/{id}/notice_campaigns` | Sub-collection | Frozen message version and recipient set, qualified individual in-app receipts and completion |
| 16e | `privacy_incidents/{id}/notice_requests` | Sub-collection | Private actor/request/payload binding for exact campaign replay |
| 17 | `drafts` | Root | Unsaved article drafts |
| 18 | `guest_preferences` | Root | Onboarding preferences for unauthenticated users |
| 19 | `moments` | Root | Seasonal/event moments for curated feeds |
| 20 | `embeddings` | Root | Vertex AI multimodal embeddings per article |
| 21 | `search_index` | Root | Denormalized search documents |
| 22 | `stats` | Root | Aggregated platform statistics |
| 23 | `rate_limits` | Root | Rate limiting counters for Cloud Functions |
| 24 | `wallets` | Root | Virtual wallet balances (all amounts in cents) |
| 25 | `wallets/{uid}/ledger` | Sub-collection | Wallet transaction ledger entries |
| 26 | `platform_ledger` | Root | Platform accounting ledger (shipping cost variance, server-only) |
| 27 | `failed_operations` | Root | Dead-letter queue for failed money/shipping side-effects (server-only, replayed by `retryFailedOperations`) |
| 28 | `stripe_events` | Root | Stripe webhook idempotency markers keyed by `event.id` (server-only) |
| 29 | `privacy_incidents` | Root | Privacy/security incident register (Loi 25 / RGPD breach log) — admin-read, server-write only |
| 30 | `disputes` | Root | Buyer "delivered but problem" tickets (CF-owned, freezes the linked transaction) |
| 31 | `automatic_decisions_log` | Root | Transparency log of automated decisions (Loi 25 art. 12.1) — party-read, server-write only |
| 32 | `automated_decision_contestations` | Root | Human-review requests against automated decisions (Loi 25 art. 12.1) — author-create, author/admin-read |
| 33 | `admin_alerts` | Root | Operator-facing alerts for non-auto-recoverable financial cases (F43/F85) — server-write only |
| 34 | `job_locks` | Root | Anti-overlap locks for scheduled jobs with paid side-effects (F82) — server-only |
| 35 | `brands` | Root | Brand catalog (seeded from `vinted-brands.txt`). Powers UI brand picker + IA brand matching. |
| 36 | `article_sold_requests` | Root | Private server receipts for explicit sold/relist intentions; no client read/write |
| 37 | `article_privacy_evidence` (+ `public_projection_evidence`) | Root / sub-collection | Private withdrawal source and captured projections; access through qualified callables only |
| 38 | `article_privacy_commands` | Root | Native non-execution receipts for conflicting owner commands; no client access |
| 39 | `article_media_promotions` | Root | Native permission recorded before public media IO; unresolved IO prevents withdrawal completion |
| 40 | `profile_privacy_media/{uid}/sources` | Sub-collection | Private generation-qualified avatar copies; no direct client access |
| 41 | `transactions/{id}/dispute_decisions` | Sub-collection | Private native previews, commercial decisions and non-execution receipts bound to the examined source and financial intent; callables only |
| 42 | `support_requests/{id}` (+ `commands`) | Root / sub-collection | Private versioned intake, native actor/request receipts, correspondence and separate internal notes; no direct client access, bounded callables only |
| 43 | `article_moderation/{id}` (+ `decisions`, `appeals`, order instructions) | Root / sub-collection | Private versioned restriction/favorable decisions and exact source receipts; owner/admin allowlisted callables, no direct client access |
| 44 | `account_access_intake/{reference}` | Root | Private public-intake command and secret hash; public responses expose only an opaque receipt, operator readers require current Auth and private admin role |
| 45 | `shipping_receipt_declarations/{transactionId}` | Root | Immutable buyer declaration, explicitly distinct from carrier delivery or content validation; buyer/seller allowlisted reader, no client permissions |
| 46 | `shipping_receipt_declaration_commands/{hash(uid,requestId)}` | Root | Exact native declaration/neutralization receipts; no client access or financial, deadline or recourse mutation |
| 47 | `transactions/{id}/tracking_history/{captureId}` (+ `pages/{n}`) | Sub-collection | Immutable private projection of supplied carrier tracking, qualified UTC or unknown dates, bounded display text and original text hashes; pure party reader and capture-bound pages, no client access |
| 48 | `{transactions,swaps}/{id}/hold_reviews/{observationId}` | Sub-collection | Private hold observations and permanent review receipts; qualified attributed amount or unknown, source revision, no direct client access |
| 49 | `transactions/{id}/late_transport_incidents/{incidentId}` | Sub-collection | Immutable post-refund tracking observation with essential notices and operator alert committed atomically; owner/admin allowlisted reader, no financial or inventory authorization |
| 50 | `swaps/{id}/swap_hold_reviews/{observationId}` | Sub-collection | Private attributed top-up hold review, source qualification and durable operator receipt; participant allowlisted pure reader, no direct client access |
| 51 | `swaps/{id}/topup_release/committed` | Sub-collection | Native exact top-up release receipt linked to swap, payee and ledger movement; a historical timestamp alone is not a qualified release |
| 52 | `transactions/{id}/return_to_sender_cases/{caseOrCommandId}` | Sub-collection | Explicit participant report, original source and exact command/neutralization receipts; private allowlisted readers, no carrier-derived RTS or physical receipt certification |
| 53 | `fraud_review_cases/{caseId}` (+ `events`, `observations`, `operator_receipts`) | Root / sub-collection | Private Stripe risk observations and durable event/operator receipts, exact attribution or reconciliation required; no direct client access or financial authority |
| 54 | `fraud_review_decisions/{decisionId}` | Root collection | Private immutable human review document and content hash; exact native cases/sources, no money, inventory or identity authority |
| 55 | `fraud_review_commands/{commandId}` | Root collection | Private actor/request/payload command and neutralization receipts; genuine historical result precedes new-permission checks |
| 56 | `transactions/{id}/transport_reviews/{caseOrPreviewOrCommandId}` | Sub-collection | Native transit declaration, documentary inquiry, delivery correction and EX review; exact source-bound previews/receipts, no direct client access or automatic money/stock authority |
| 57 | `product_review_cases/{caseId}` (+ `source_captures`, `contributions`, `communications`, `evidence`, `documentary_captures`, `admission_decisions`, `physical_signals`, `physical_instructions`, `commercial_return_previews`, `commercial_return_instructions`, `routing_decisions`) | Root / sub-collections | Private article-review sources, statements, evidence receipts, exact corpus manifests, listing admission decisions and physical/commercial return instructions; owner reads own contributions/evidence and addressed communications, original other-party evidence remains team-private |
| 58 | `product_review_commands/{commandId}` | Root collection | Private exact actor/request/payload and neutralization receipts; genuine historical receipt precedes new-source and role checks |
| 59 | `product_review_workflow_commands/{commandId}` | Root collection | Private source-bound operator/participant communication and neutralization receipts; no automatic physical, financial or inventory authority |
| 60 | `product_review_evidence_commands/{commandId}` | Root collection | Private exact upload intentions, attempts and receipts; same-object creation-only recovery, no absence/deletion certified from missing responses |
| 61 | `product_review_admission_commands/{commandId}` | Root collection | Private exact operator admission and neutralization receipts; business permission limited to current child-safety sources, independent from publication and financial actions |
| 62 | `article_child_publication_commands/{commandId}` | Root collection | Private exact owner publication and neutralization receipts; current preparation, admission and other guards required before a new visibility change; historical replay never republishes |
| 63 | `product_physical_commands/{commandId}` | Root collection | Private exact operator physical instruction and neutralization receipts; current source-bound permission applies only to its recorded forward or return leg, with no financial authority |
| 64 | `label_lifecycle_cases/{caseId}` (+ `entries`, `route_amendment`, `route_entries`) | Root / sub-collections | Private source-bound label observations, stop/void instructions, replacement quotes, consents and immutable purchase/adoption proofs; route amendments keep separate native proposals, party acceptances and notices; bounded owner/admin callables only, no client access |
| 65 | `label_lifecycle_commands/{commandId}` | Root collection | Private actor/request/exact-command receipts and recovery states; genuine effects and GET-only recovery precede new-permission checks, with no implicit buyer debit or carrier settlement |
| 66 | `transactions/{id}/parcel_problem_origins/{originId}` | Sub-collection | Private native parcel-claim origin keyed by actor, contribution and leg; exact dispute, command receipt and permanent notice proofs deduplicate requests without renewing the hold or consuming another creation quota; no client access |
| 67 | `transactions/{id}/refund_agreements/{agreementId}` | Sub-collection | Private versioned monetary terms, proposal and separate native party acceptances; an external statement or proposal is not bilateral consent or a financial effect |
| 68 | `transactions/{id}/refund_allocations/{intentId}` | Sub-collection | Private cumulative native allocation reservations and settlements bound to one financial intent, original basis and selected components; no direct client access |
| 69 | `transactions/{id}/refund_history/{intentId}` | Sub-collection | Private preserved prior financial intentions and effect proofs, inspected by bounded GET-only reconciliation without creating a new refund |
| 70 | `purchase_refund_agreement_commands/{commandId}` | Root collection | Private exact actor/request/command and neutralization receipts; historical result servicing precedes new-agreement admission, no direct client access |
| 71 | `transactions/{id}/return_route_captures/{captureId}` | Sub-collection | Immutable private operational route captures bound to the same native return request, only before provider preparation/IO; exact reads, no renewal of the request date or window |
| 72 | `privacy_retention_guards/{uid}` | Root collection | Private monotone preservation scope shared transactionally by written privacy requests and actual Firestore deletions; bounded legacy coverage or conservative unknown, no client access or release authority |
| 73 | `transactions/{id}/refund_repairs/{repairId}` | Sub-collection | Private technical card-repair reservation, provider identities and observed proofs for the same refund obligation; no wallet/seller replay, source-reviewed after fixes, local business stage enabled, payment/shipping launch gates separate |
| 74 | `transactions/{id}/refund_repair_commands/{commandId}` | Sub-collection | Private exact actor/request receipts and operator motivation; party reader exposes only the communicable instruction, never an external payment attestation |
| 75 | `transactions/{id}/refund_repair_previews/{previewId}` | Sub-collection | Private actor-bound source revision and bounded provider observations preceding a repair instruction; no direct client access |
| 76 | `transactions/{id}/late_commercial_admissions/{admissionId}` | Sub-collection | Immutable private admission or review decision bound to the existing late support ticket, native product statement and exact financial reference; backend and RN source-reviewed after fixes, local business stage enabled, launch payment/shipping gates separate |
| 77 | `transactions/{id}/late_commercial_commands/{commandId}` | Sub-collection | Exact actor/request receipts and neutralizations, available to the actor before new-admission permissions; no direct client access |
| 78 | `transactions/{id}/late_commercial_observations/{observationId}` | Sub-collection | Private bounded business deduplication of the examined source and operator decision; no financial effect or renewed deadline |
| 79 | `message_report_commands/{commandId}` | Root collection | Private actor/request/exact-command receipts for the selected message report; captured evidence remains under reports/{id}/native_evidence, backend and RN source-reviewed with native evidence and current operator authority |
| 80 | `transactions/{id}/late_transport_incidents/{incidentId}/physical_recovery/{documentId}` | Sub-collection | Private current state, immutable party statements and operator review entries, exact command receipts and previews bound to the same late incident/article/refund/corpus; server-only stock qualification, backend and RN source-reviewed after fixes, local business stage enabled |
| 81 | `product_routing_commands/{commandId}` | Root collection | Private exact actor/request/command and neutralization receipts for source-bound routing review; immutable decisions under product_review_cases/{caseId}/routing_decisions, no direct client access or financial authority; backend and RN source-reviewed after callback isolation fix, local business stage enabled |
| 82 | `content_moderation_cases/{caseId}` (+ `originals`, `entries`, `media`) | Root / sub-collections | Private source-bound content reports, human visibility decisions, contests, preserved originals and qualified media-withdrawal attempts; no direct client reads, no financial or identity authority |
| 83 | `content_moderation_commands/{commandId}` | Root collection | Private exact actor/request receipts and bounded media recovery linked to the same hide decision; genuine historical receipts precede NEW operator permissions |
| 84 | `chat_media_restrictions/{chatId}` | Root collection | Native private path restrictions for masked chat images, coupled with server-owned chat preview restriction; not a proof of bearer URL revocation or copies erased |
| 85 | `account_relationship_pairs/{pairId}` (+ `entries`) | Root / sub-collection | Private examined relationship, independent pair and order-release scopes, source-bound human decisions and contests; no identity/fraud inference, current lifting authority requalified at NEW consumption |
| 86 | `support_requests/{id}/relationship_commands/{commandId}` | Sub-collection | Private exact actor/request decision and neutralization receipts; addressed participants resolve native references without access to another person's ticket; local business stage closed pending remaining rail/client validation |
| 87 | `product_mixed_order_links/{groupId}` | Root collection | Private bounded links of native affected orders; parties receive only their own context-specific signal and addressed instruction, never group identifiers or other buyers' references |
| 88 | `product_mixed_order_commands/{commandId}` | Root collection | Private exact mixed-parcel link/review command receipts; native per-order signals and decisions under product_review_cases/{caseId}/mixed_order_signals and mixed_order_decisions, backend and RN source-reviewed including additive native mixed reason, local business stage enabled |
| 89 | `swaps/{id}/topup_checkout/{stateId}` | Sub-collection | Private manual top-up intention and exact legacy-retirement observations; no direct client access, backend/RN source-reviewed after recovery fixes, local business stage enabled |
| 90 | `swaps/{id}/topup_checkout_commands/{commandId}` (+ `results/receipt`) | Sub-collection | Private exact actor/request/command journal and preserved native result; interrupted operations reconciled by provider reads, no client secret persisted |
| 91 | `swap_topup_reconciliation/{reviewId}` | Root collection | Private durable reconciliation for an observed top-up whose current native authorization or identity is unknown; no blind replacement of current PI or financial success |
| 92 | `transactions/{id}/transport_reviews/contact_case_{hash}` (+ `observations`, `instructions`, `source_captures`, `previews`) | Sub-collection | Private source-bound collection/refusal records; exact contact_command_* receipts and human contact_followup_* reminders share transport_reviews, separate from V1 case_*; transportContactNetworkReturn restricts only new label operations; backend/RN source-reviewed after explicit-declaration and full-corpus fixes, local business stage enabled |
| 93 | `transactions/{id}/commercial_claim_reviews/{claimHash}` | Sub-collection | Private source-bound documentary withdrawal and reexamination state for the original native commercial claim; no direct client access, backend/RN source-reviewed after current-admission and documentary-guard fixes, local business stage enabled |
| 94 | `transactions/{id}/commercial_claim_review_entries/{entryId}` | Sub-collection | Immutable exact buyer statements, withdrawal references and post-withdrawal native product contributions; no financial or deadline effect |
| 95 | `transactions/{id}/commercial_claim_review_commands/{commandId}` | Sub-collection | Private exact actor/request receipts and neutralizations; operator admission reuses late_commercial_* journals and the same original claim, no new ledger |
| 96 | `bank_dispute_cases/{disputeId}` (+ `observations`, `events`, `entries`) | Root / sub-collections | Private native banking case bound to one qualified platform payment; current provider facts, historical commands and durable signed-event observations remain separate from wallet effects and H19, local stage reopened after independent image-consultation callback delta review |
| 97 | `bank_dispute_cases/{disputeId}/commands/{commandId}` (+ `results/receipt`, sibling `files`) | Sub-collections | Private exact actor/request effects and file identities tied to native product proofs; uncertain uploads/submissions/acceptance remain observations without blind resends, no direct client access |
| 98 | `withdrawal_requests/{wi}/private_preflight/observation` | Sub-collection | Server-only platform cash observation and source hash; owner-readable root keeps only the exact technical refusal, without global balance or platform account identity. J20 backend/RN independently reviewed, exact non-execution receipt and explicit fresh observation preserve SDK servicing, local stage open. Isolated Dev/test may record `observation.testMode=seconde_dev_commerce_v1` and `observation.accountRestrictionsQualification=not_exposed_in_stripe_test_mode` when the exact bound native sandbox platform omits `requirements`; native CAD balance/mode/request IDs remain required and both optional fields are hash-bound. No unrestricted-account claim. |
| 99 | `transactions/{id}/transport_reviews/carrier_case_{hash}` (+ `observations`, `instructions`, `source_captures`, `previews`) | Sub-collections | Private carrier billing/indemnity documents bound to an initial or replacement label purchase; exact carrier_command_* receipts share transport_reviews, no financial or guard effect. Backend/RN independently reviewed after monetary-corpus and image-consultation fixes, local stage open |
| 100 | `bank_dispute_cases/{du}/financial_reconciliations/{fr_hash}` | Sub-collection | Private append-only provider movement graphs and native local-effect observations, source-bound documentary instructions only; exact edge provenance and complete visible history independently re-reviewed, local documentary stage open, financial resolution still unauthorized |
| 101 | `bank_dispute_cases/{du}/financial_reconciliation_commands/{commandHash}` (+ `results/receipt`) | Sub-collections | Exact actor/request capture intentions and minimal SDK receipts; bounded GET-only recovery, unknowns and financial guards preserved, no report data in permission-independent receipts |
| 102 | `support_confidentiality_commands/{commandHash}` | Root collection | Server-only exact actor/request protection receipts without original text; pending native command protection never proves business execution. Backend/RN independent delta reviews PASS after copy/provenance/cache/servicing corrections; local stage open, original access denied by default |
| 103 | `support_confidential_command_guards/{guardHash}` | Root collection | Native ticket/actor/request/payload guard inherited by a matching late support command; enables reference-only SDK servicing while originals remain private and retained. Current admin copies use private support_requests.supportFieldSources and native ownerSnapshot provenance; supportConfidentiality.copies binds each confined copy to field/hash/exact command/version/date, stripped from ordinary DTOs |
| 104 | `support_confidential_access/{accessHash}` | Root collection | Content-free original-access audit. V1 remains denied; V2 binds current private admin/recent session, one exact native field/context/purpose, necessity and minimization. Audit and receipt commit before the first field release; opaque servicing never rediscloses the original |
| 105 | `swaps/{id}/dispute_review/current` | Sub-collection | Current native documentary review version and exact entry reference; no swap closure, financial permission or item release. Backend/RN independently reviewed, local documentary stage open |
| 106 | `swaps/{id}/dispute_review_entries/{sdr_hash}` | Sub-collection | Source-bound documentary recommendations, two party messages and atomic native notice references; original swap episode, current guards and bounded native fact coverage remain distinct from settlement |
| 107 | `swaps/{id}/dispute_review_commands/{commandHash}` | Sub-collection | Exact SDK actor/request/payload receipts, observe and neutralize before fresh private admission; absence remains unknown and a terminal receipt does not prove financial or physical resolution |
| 108 | `swaps/{id}/expiry_reviews/{sourceVersionHash}` | Sub-collection | Private documentary progression witness for a still-current old postacceptance source, atomically paired with admin_alerts/swap_progression_{hash}; no expiration, refund, reservation/item release or claim of human notification |
| 109 | `job_locks/pendingPaymentPreparation_cursor` | Existing root collection, new document | Bounded pending-payment preparation scan cursor with native Timestamp/ID and revision CAS; unknown historical rows rotate without becoming resolved or rewriting order dates |
| 110 | `transactions/{id}/convenience_return/{documentId}` | Sub-collection | `current` preserves V1; additive `current_v2` freezes buyer-paid return/article-only terms. `reception_{hash}` is a seller declaration only; `variance_{hash}` is the private cost resolution, terminal request/purchase tombstones block late resurrection and `late_{hash}` retains terminal observations without PDF or money |
| 111 | `transactions/{id}/convenience_return_commands/{commandHash}` | Sub-collection | Versioned exact owner/request/payload receipts and neutralizations before current private admission; source CAS, record and two native notices atomic, server-only under implicit deny |
| 112 | `transactions/{id}/return_deposit/current` | Sub-collection | First qualified document furnishing, buyer session/PDF evidence and native party notices, Toronto civil deadline and source-bound motivated extensions; native_label_commit preserved, qualified variance adoption uses member_document_furnishing_v1 only on buyer read; no automatic fault, financial or shipping decision |
| 113 | `transactions/{id}/return_deposit_commands/{commandHash}` | Sub-collection | Exact actor/request extension receipts and neutralizations, recoverable before current role/profile admission; owner projection excludes private operator motivations |
| 114 | `job_locks/checkShippedTracking_late_return_cursor` | Existing root collection, new document | Bounded rotating late-return label/ID scan under native lease and post-work checkpoint CAS, independent of commercial status; no new scheduled export |
| 115 | `swaps/{id}/topup_refund/{documentId}` | Sub-collection | Native `prepared` work before provider IO, immutable first-authorized `current` body and exact `committed` provider/local settlement receipt; legacy unknowns do not authorize another POST |
| 116 | `job_locks/swapPostAcceptanceReview_cursor` | Existing root collection, new document | Owned lease, rotating start status and finite per-status ID cycles; per-row checkpoint shares the documentary witness/alert transaction, no expiration or financial authority |
| 117 | `inventory_units/{unitOrArticleLinkId}` | Root collection | Server-only seller-declared common unit, bounded membership, exact purchase/Troc/manual engagement and private per-article links/receipts; no direct client permissions or physical identity certification |
| 118 | `admin_alerts/gfr_{hash}` + `sources`, `references`, `movements`, `pages`, `commands` | Existing root, private sub-collections | Account/mode/CAD/UTC-scoped documentary financial reconciliation, native source captures, provider edges, reverse audit and exact versioned command/page receipts; no financial effects or global snapshot certification |

| 119 | `support_legal_review_commands/{commandHash}` | Root collection | Exact V2 actor/area/request opaque receipts and tombstones; no original field or file bytes, native SDK servicing remains separate from new admin authority |
| 120 | `support_requests/{case}/review_evidence` + `legal_v2_evidence_reads`, `legal_v2_authorizations`, `legal_v2_access`, `legal_v2_events` | Private sub-collections | Actual held JPEG generations, bounded exact-source human examinations and package authorization/access; human send and external acknowledgment are separate documentary acts, never app-performed delivery |
| 121 | `admin_alerts/exception_{contextHash}` + `exceptional_commands`, `exceptional_evidence` | Existing root / private sub-collections | Native exceptional restitution instructions, exact receipts and private evidence; unique wallet reserve/void or Seconde compensation liability, no inferred Stripe settlement or bank arrival |
| 122 | `support_requests/{id}/deadline_alerts/{hash}` and `bank_dispute_cases/{id}/deadline_alerts/{hash}` | Private sub-collections | Native clock observation and resumable current-admin notice fan-out; missing admin stays awaiting, no delivery or legal completion claim |
| 123 | `failed_operations/capture_{hash}.orphanRefund` + `orphan_refund_previews` and `eligibility_audit/ocr_{hash}` | Existing roots / private preview children | Exact original-card reservation and outcome receipts for an unassigned platform capture; independent lifetime/attempt/POST witnesses prevent replay after native restoration |
| 124 | `support_requests/{id}/privacy_commands`, `privacy_captures/{id}/entries`, `privacy_copies`, `privacy_corrections`, `privacy_dispositions` | Private sub-collections | Opaque command receipts, fixed-point native capture, explicitly minimized owner copies, CAS corrections and exact-target disposal steps; no global erasure claim |
| 125 | `privacy_preservation_catalogues/native_support_v1` and `privacy_disposition_fences/{ownerHash}` | Private roots | Causal native preservation semaphore and one-attempt lease/fence; a new hold invalidates disposal or leaves an explicit in-flight conflict, never a global hold release |
| 126 | `admin_alerts/bc_{planHash}` + `cessation_pages`, `cessation_exports`; `admin_alerts/cc_{claimHash}`; `admin_alerts/business_cessation_operations/cessation_commands/{commandHash}` | Existing private root / private sub-collections | I20 documentary inventory at a fixed native point, own-obligation claims and exact operation receipts; immutable independent export pins, no financial settlement or commercial-control mutation |
| 127 | `financial_subject_guards/{ownerHash}`, `financial_subject_catalogue_unknown/native_v1`; `support_requests/{id}/privacy_inspections/{inspectionId}` + `pages`, `page_reviews` | Private roots / private sub-collections | K12 atomic financial invalidation per native subject; attributed effects and counters share one commit. Fixed-point paged legal/financial inspection, exact per-page human reviews and hashes; a counter never establishes a restore baseline or legal erasure authority |

The optional I17 `controlBalanceMode: global_control_balance_v1` adds private `control_components`, `control_effects`, `control_events`, `control_provider_refs`, `control_provider_usage`, and `control_provider_fee_claims` below the same report. It requires complete-known coverage and a fixed native point at the period boundary. Independent generation/hash-pinned provider boundaries, source inventories and writer drain are compared with the exact recognized catalogue and code registry. Closing stocks, period variations and causal evidence are separate; per-component and per-event bridges prevent opposite errors from cancelling. Native payment references and transfer/payout destinations must agree with the selected provider object. Qualified provider fees may satisfy only an exact native fee claim, never a residual plug. Missing or contradictory facts remain unknown; all monetary permissions stay false. Old scopes, hashes and command receipts are unchanged without the opt-in.

Prospective service charges retain an opaque `operator_tax_decision_v2` bound to their native recipient/address source and documentary server policy, including justified non-collection when the technical tax flag is off. New forfait operations optionally add `taxPricingVersion: shop_tier_tax_pricing_v2`, canonical pricing and its decision hash. PI metadata binds the pricing hash to the existing POST-body witness; `shop_tier_settlement_v2` binds the same original amounts and exact commit date. `platform_ledger/shop_tier_revenue_{pi}` stores net revenue separately from GST/QST and total cash collected, without a second tax-cash entry. Existing V1 operations/settlements and snapshots remain absent rather than retroactively enriched; current policy never reprices their servicing. No official operator policy, registration or legal qualification is supplied by these fields.

I17 reports use `global_financial_reconciliation_v1` through the existing support callables. `prepare` fixes the scope; `advance` records one bounded page; `observe`/`page` are readers; `seal` closes only the documentary report with its limits. Native/provider/audit cursors remain independent. Unknown provider outcomes keep the same command and cursor. An absent concurrent or stale RID can receive an immutable `not_executed` disposition; a pending/unknown native command cannot be relabelled as unexecuted. Old exact calls cannot advance a new page. Current Auth/private admin authority is requalified before and after IO; loss of role permits only the actor's opaque receipt, without private scope, groups or pages. Parallel tax entries are never added as another revenue or wallet movement. A qualified existing Stripe V1 summary and matching provider flow do not certify a coherent restored Firestore snapshot, other accounts, bank arrival or a fiscal period.

I17 optional `scope.nativeCapture` freezes a server-provided Firestore readTime with exact seconds/nanoseconds; old V1 scopes/hashes remain unchanged when absent. Financial roots, children, joins, connected-account references and audit reads use read-only transactions at that point, while documentary pages/commands and current Auth/admin authority remain current. Unavailable/expired reads retain the same pending/unknown command and cursor, without a live fallback. Coverage distinguishes known-source capture completion from period-end coverage and from global source-set/balance qualification. The client captures the point before preparation and cannot replace it in a pending run; no financial mutation is introduced.

L04 adds `financialRecoveryWitness` to server-owned native financial sources. Its five fields are `protocol: financial_recovery_source_witness_v1`, `installationId`, `epoch`, exact document `ref`, and `nativeSourceHash`. A current witness or exact independently qualified manifest entry is required for an existing source; a new witness requires an absent native snapshot and atomic creation. Source projections distinguish missing values from zero and preserve native Timestamp seconds/nanoseconds. Witnesses do not grant commerce, identity, recourse or monetary permissions; restrictive business guards still apply. Shop paid rights and witnesses are server-only even for admin clients; unchanged historical fields do not prevent ordinary profile/moderation updates.

An optional independent indexed manifest V2 stores no new Firestore document. Its pinned root and bounded immutable children retain exact installation/project/database/environment/platform/epoch identity and generation/content hashes. SHA256 routing uses the exact UTF-8 document reference; there is no global 2000-source cap in V2. A missing route means no admission; an unavailable declared child blocks qualification instead of proving absence. V1's existing format and limit remain unchanged. Lookup caches bind the full control context and pins, while each operation retains its IO/time budget and UNKNOWN recovery semantics. This is a source-qualification reader, never an automatic inventory, drain certificate or authority to reopen.

The independent L04 control is outside Firestore: `FINANCIAL_RECOVERY_BUCKET`, `FINANCIAL_RECOVERY_CONTROL_OBJECT`, `FINANCIAL_RECOVERY_PREFIX`, `FINANCIAL_RECOVERY_INSTALLATION_ID`, `FINANCIAL_RECOVERY_FIRESTORE_PROJECT_ID`, `FINANCIAL_RECOVERY_FIRESTORE_DATABASE_ID`, `FINANCIAL_RECOVERY_ENVIRONMENT`, and `FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID` must be qualified explicitly. No default Firebase Storage bucket or automatic normal-mode bootstrap exists. Runtime IAM must read control/manifests and create immutable evidence without updating/deleting them. Modes are `normal`, `draining`, `recovery`; unavailable control blocks new effects. Permits stay open until their actual invocation ends, with no TTL-based claim of quiescence or settlement. GCS uses an isolated SDK client, bounded IO and no automatic retry; provider responses and authenticated webhook facts can still be preserved after financial admission closes. `financial_recovery_status_v1` only observes the control: drainage is not measured and reopening belongs to independent IAM. Actual IAM, source-set/drain qualification, backup/PITR and a restoration exercise remain unverified; the app cannot reopen from a restored admin role. Connect creation/deletion additionally uses a generation/hash-pinned identity policy and lifetime installation/UID claims outside Firestore; a restored missing native operation cannot authorize a second POST. Old identities require an exact qualified parent manifest, and deletion requires the financial-absence projection in addition to identity qualification. The `connect_identity_recovery_v1` reader exposes an opaque own/admin observation without create/reset/delete authority. A missing external claim never proves absence of a Stripe effect. The generation/hash-pinned `financial_recovery_connect_identity_policy_v2` binds the exact bucket/prefix, continuity identifier and protected frontier; v1 cannot grant NEW effects. New `financial_recovery_connect_identity_claim_v2` objects include policy/store hashes and are created with `temporaryHold:true` under generation-match0. The actual hold is re-read after creation, collision and before POST; no automatic release, reset or migration exists. Historical v1/unheld observations remain UNKNOWN readers only. A separate privileged actor releasing the hold then deleting evidence would violate the qualified continuity and is not claimed detectable. Independent IAM, historical completeness and actual store preservation remain operational requirements.

Fiscal workpapers use `admin_alerts/tax_operator_{year}` and `admin_alerts/tax_seller_{uidHash}` with private `events`/`versions` and annual `years/{year}` documents, command receipts and document streams. The input `subject` distinguishes operator (`ownerId:null`, admin only) from seller (exact native UID, including an ordinary UID literally equal to `operator`). Events retain gross seller consideration before debt, first credit date and original-period corrections; withdrawals and releases are not another sale. Prospective credit/refund/repair writers atomically record provisional events with the actual commit serverTimestamp, not a precommit clock; qualification resolves that native committed source and retains the original period. Annual captures under the existing dossier persist a fixed readTime, independent phase/child cursors, entries and exact receipts; there is no annual 500-source cap or live fallback after point expiry. All native joins use that point, while Auth and private roles remain current. A completed capture covers known native sources only, not a legally exhaustive universe or qualified writer drain. External evidence references bind a dedicated CMEK object generation/content hash and a signed access attestation with runtime PAP/UBLA/IAM consistency checks; effective inherited IAM and legal authenticity remain externally qualified, not inferred. Raw fiscal identifiers, names, address and DOB stay outside Firestore in the qualified external vault. A prepared declaration, imported filing receipt, delivery evidence and owner acknowledgment are separate acts. Private `copy_read` requires a recent authenticated owner and an independently signed individual-file binding to exact declaration/filing/delivery references, generation, SHA, MIME and size; bytes are returned only on explicit GET and never persisted in receipts/journals. Private file/signature metadata is excluded from document pages. Legacy delivery evidence without a binary stays unavailable; no app-performed filing, legal authenticity or device read is inferred. Existing callables expose `seller_tax_reporting_v1`; no new root collection or direct owner SDK access is granted. Individual credit-note files are optional private fields on new `credit_note_record` documents, stripped entirely from document-page DTOs. `credit_note_read` returns bytes only to the native buyer after recent current authentication. The independent file binding includes the original invoice/note/refund and exact immutable native settlement/ledger references, amounts, debt splits and Timestamp nanos. Historical reads preserve an already issued note after later provider/review changes; new imports still require qualified current settlement. Coherent replacement of native commit dates or ledger state invalidates the signed source and prevents export. OAuth reauthentication never acknowledges a file or refreshes a stale financial command implicitly.

Seller activity first-review commands live in the existing private eligibility collections. `seller_activity_review_v1` binds an order/article anchor, native seller, explicit UTC period, page cursor, source hash, eligibility version and versioned human criteria. The initial review, linked signal, owner-facing reason, private note, native notification and exact command receipt share one transaction. Observe/neutralize accept only the opaque actor/RID/payload descriptor; a terminal receipt grants no trading or fiscal permission. Appeals replace only the prior linked active review, preserving original decisions and unrelated signals. Existing participant projections exclude the private operator note.

A06 `account_control_proof_v1` uses private `support_requests/{id}/account_control/{proofId}`, child `consents/A` and `consents/B`, and sibling `account_control_commands/{receiptId}`. The native support case selects one exact declared second UID. Each party consents from its own current primary Firebase session with a genuinely linked provider. The pause command executes only in the existing owner closure transaction; a newly created closure and its immutable receipt share the actual commit serverTimestamp. An existing qualified pause requires a new explicit command, while advanced/malformed closures never become newly paused. `accountClosure.accountControlProof` is a causal link, not account recovery or a transfer of obligations. Notices carry only the recipient UID, ticket/proof references and opaque source hash. No invitation code enters push data or the persistent SDK journal. Observe/neutralize bind the exact actor/RID/action/hash; a neutralized absent command cannot execute later. These server-only children grant no direct client access, common physical identity, merged balance or permission to reopen commerce.

Privacy incident receipt servicing uses private `privacy_incidents/{incidentId}/command_controls/{hash(kind,actor,RID)}` through the existing three incident callables. `receipt_observe` performs no effect; an absent native command remains unrecorded. `receipt_neutralize` creates a source-bound tombstone only when both command and control are absent in the same transaction. All three execute paths read that control before writing, preventing late execution without relabelling an accepted partial campaign as unexecuted. A fresh current private session may receive its own opaque command receipt after loss of admin authority, without incident bodies or recipient counts. Current authority is required for full campaign status and explicit resume; a command acknowledgement never means notification completion or CAI delivery. V1 SDK journals remain compatible; V2 journals contain only exact references and receipts and cannot execute a command.

G10 incident records use the existing private `convenience_return` and `convenience_return_commands` sub-collections. `terminal_request_{hash}` contains an immutable closure capture, `terminal_purchase_{hash}` binds the external purchase tombstone, and `terminal_current` is only a pointer. Native predeposit neutralization uses `convenience_return_predeposit_terminal_v1`; an absent local request is never inferred terminal without this transactionally serialized proof. A terminal A does not replace an active B. Closure distinguishes `not_invoked`, `validation_rejected`, `purchased_unfurnished` and `unknown`; platform risk acceptance never certifies a carrier credit. The private `convenience_return_cost_resolution_v1` preserves the original reservation hash, qualified actual label proof, accepted/actual/deduction/net/platform-variance amounts, exact operator command and note. Only its allowlisted reference and monetary proof project onto the member-readable transaction. Owner/admin journals require exact native receipts; terminal late observations cannot recreate active label or financial effects.

The material review opt-in records commercial return instructions through the existing `product_review_workflow_commands` journal. `transactions.productCommercialReturnInstruction` and `returnRequest.commercialReturn` / `commercialReturnBasis` reference the exact native instruction and timely complaint basis; these pointers alone do not release held funds, authorize physical transport or certify returned contents. Backend and app wiring are source-reviewed, and the local business dispatcher is enabled; payment, shipping and tax launch gates remain separate.

The parcel review opt-in captures native parcel/leg/label references separately from participant declarations (`parcelStatement`) and operator assessments (`parcelAssessment`). Source V4 exposes only minimal route data to participants; exact captured routes require a qualified, recently reauthenticated operator. `transactions.parcelRecourseGuard` and `sellerParcelReport`, and `disputes.recourseScope` / `parcelTreatment`, distinguish buyer delivery claims, pre-delivery investigations and seller return reports. They do not certify carrier loss, physical receipt or financial success. Backend, RN activity guards and routes are source-reviewed; the local parcel business stage is enabled, with payment and shipping launch gates separate.

The negotiated refund opt-in keeps `transactions.refundAgreementContext` and `refundAllocationState` separate from the original sale contract. Five monetary components, card/wallet portions and sale-attributed seller/platform costs remain explicit; no per-item proration is inferred. A commercial disposition of a return does not certify arrival, returned contents, possession or stock availability. Backend, RN and three route connections are source-reviewed after targeted corrections and second reviews. The local business stage is enabled after the reviewed H19 conservative protection; payment/shipping launch gates remain separate. Terminal card-failure repair and differential bank reconciliation remain distinct open obligations. Any presence of `transactions.bankRefundReconciliation` keeps the shared bank guard active, without inferring a net loss, refund settlement or release from `lost`/`closed` alone. Native alert/notices and the retained dispute identifier keep the obligation discoverable before new refund, wallet or release effects.

`transactions.labelLifecycleStop.{forward,return}` and `labelLifecycleCurrent.{forward,return}` qualify each leg separately. The current replacement points to native purchase/adoption proofs while preserving the initial contract and receipt. A pending replacement blocks any new replacement quote or purchase. A stored document observation is historical; provider availability, validity, possession and cash refund are not certified by these pointers. Backend and app wiring are source-reviewed; the local business lifecycle stage is enabled, with payment and shipping launch gates separate.

The route-amendment opt-in keeps `transactions.labelRouteReview[leg]`, `operationalRoutes[leg]` and `returnRequest.routeAmendmentCapture` separate from the original contract. A proposal and two native acceptances do not certify non-deposit, current label availability, interception, shipping permission or a debit. Current route readers must qualify the actual purchase/adoption proof, without falling back to the old destination for an unknown amended route. Owner notices expose only opaque references and are requalified against the exact native entry, receipts and UID notification. Backend/RN corrections and second reviews are complete; the local route-amendment stage is enabled, with payment/shipping launch gates separate.

Operational notice projections also live on their native source: `transactions.meetupConfirmationNotice` / `meetupCompletionNotice` bind the declared meetup phase and actor; `shops.verificationDetails.operationalNotice` binds the versioned shop decision. A qualified immutable notice receipt proves the in-app commit, not payment, physical handover, device delivery or reading. Replays do not recreate a notification dismissed by its owner.

Cash agreements record `transactions.cashAgreement` and a separate `cashReservationRelease` qualified against the original agreement and no-show ticket. The behavioral ticket remains independent from the reservation; no outside payment or handover is certified. Native cash previews/decisions reuse `transactions/{id}/dispute_decisions`.

New shipping quotes and orders carry `purchasePolicy` with their immutable internal version and acceptance proof. `nonShipmentPolicyWindow` starts from qualified payment recording; the delivery window starts from the qualified carrier event. Existing deadlines remain historical evidence without a fabricated acceptance; `purchasePolicyReviewRequired` records insufficient or late sources. No new collection is required.

Policy V1 remains byte/hash compatible. New local V2 `shipping_purchase_2026_02` adds `preparationTerms`; `pendingPaymentPolicyWindow` is copied atomically to the order and claimed quote, bound to the native acceptance validation Timestamp, parties, rate, amount and policy hash. `purchasePreparationReviewRequired` / `purchasePreparationReview` report absent or inconsistent preparation sources without granting any financial action. Backend/RN independent reviews PASS; local V2 creation stage open, payment/shipping activation remains separate.

New publication V6 keeps `quantity: 1` and an internal stock record scoped to the listing. It no longer collects or writes `saleUnit`, `counterfeitStatus`, `inventoryUnitDeclaration`, `brandStatus`, `hasAlterations`, `alterationsDescription`, `hasKnownDefects` or `defectsDescription`; `brand` is optional. The server records the published content under the legacy `saleDeclaration` key using `version: listing_content_v2`, `scope: single_listing`, `source: seller_publication`, actor, article, native time, content/request hashes and previous content hash. This technical receipt has no `accepted`, sale-unit or authenticity answer. Its view uses `matching_listing_content`, distinct from historical `matching_seller_statement`. Edits refresh this technical receipt and retire obsolete fields only on the current listing; existing order/Troc snapshots, V1–V5 publication replay hashes and `listing_content_v1` projections remain unchanged. Frozen item snapshots preserve their actual `listingContentVersion` (V1 or V2), allowing whole-transaction returns without inventing a physical article/set answer. Missing legacy composition remains unknown. Stock reservations, ownership, admission, moderation, hygiene, child-safety and real recourse/dispute facts remain independent. Development can offer delivery as a listing preference only on cloud project `seconde-dev`; acquisition and carrier-label rails retain their separate guards, and shipping-only listings cannot start a new meetup purchase.

Child-safety preparations carry a native `childSafetyDeclaration` and `childSafetyPreparation`. A preparation requiring review remains pending/inactive; a current source-bound decision in `product_review_cases/{caseId}/admission_decisions` does not publish it. A separate explicit owner command requalifies the current admission, declaration, revision and other restrictions before visibility changes. These statements and decisions do not certify physical safety; withdrawn listings and historical receipts remain distinct.

Explicit order-linked recall or hygiene contributions carry a native `transactions.productPhysicalReview` signal barrier. `transactions.productPhysicalInstruction` points to the private instruction and its source-bound permission for one recorded transport leg. New signals, changed evidence or unqualified sources require another current review; historical labels remain documents without new shipping permission. Financial status and commercial recourse remain separate. This backend packet and its current-instruction projection have passed independent source review; RN integration and its documentary-admission coupling have passed independent source review.

Article reports use a deterministic identifier scoped to actor, article and request intent. Their `articleEvidence` is captured with `reports/{reportId}/native_evidence/capture`, inaccessible to clients and created atomically by the server. `articleReportEvidenceReportIds` on the article protects pending evidence before controlled media deletion. Old structures without the checkpoint remain historical/unknown; private generation-qualified images are exposed only through the authorized operator reader, never through the reporter receipt.

Removed server-controlled image paths receive a monotone `articles/{articleId}/retired_media/{pathHash}` marker in the same article-edit transaction. Both promotion preparation and edit commit reject reintroduction of that path; a fresh copy with a unique path remains possible. Kept images are compared by canonical storage path, so a URL token change does not retire an object still used by the article.

---

## Security Rules — server-only enforcement (P1/P2 hardening)

The following are CF-only (Admin SDK) and **rejected on any client write**
(`firestore.rules`). Audit any future feature against this list before touching
the rules.

**Server-only collections** (no client write; read restricted as noted):

| Collection | Client read | Client write |
| --- | --- | --- |
| `wallets/{uid}` (+ `ledger`) | owner only | denied |
| `withdrawal_requests` | owner / admin | denied |
| `stripe_events` | admin only | denied |
| `failed_operations` | admin only | denied |
| `admin_alerts` | admin only | denied |
| `job_locks` | denied | denied |
| `platform_ledger` | admin only | denied |
| `privacy_incidents` | admin only | denied |
| `automatic_decisions_log` | party (buyer/seller of tx) / admin | denied |
| `automated_decision_contestations` | author / admin | author-create only (must be party to tx + self-tag `userId`); update/delete denied |
| `rate_limits` | denied | denied |
| `article_sold_requests` | denied (implicit deny) | denied (implicit deny) |
| `article_privacy_evidence` (+ `public_projection_evidence`) | denied | denied |
| `article_privacy_commands` | denied | denied |
| `article_media_promotions` | denied | denied |
| `profile_privacy_media` | denied | denied |
| `transactions/{id}/dispute_decisions` | denied (implicit deny) | denied (implicit deny) |
| `support_requests` (+ `commands`) | denied (implicit deny) | denied (implicit deny) |
| `privacy_retention_guards` | denied (implicit deny) | denied (implicit deny) |
| `transactions/{id}/{refund_repairs,refund_repair_commands,refund_repair_previews}` | denied (implicit deny) | denied (implicit deny) |
| `transactions/{id}/{late_commercial_admissions,late_commercial_commands,late_commercial_observations}` | denied (implicit deny) | denied (implicit deny) |
| `message_report_commands` | denied (implicit deny) | denied (implicit deny) |
| `reports/{id}/native_evidence` | denied (implicit deny) | denied (implicit deny) |
| `transactions/{id}/late_transport_incidents/{incidentId}/physical_recovery` | denied (implicit deny) | denied (implicit deny) |

**`transactions` — client-immutable fields** (a client may only confirm a
meetup: `status: meetup_pending -> meetup_confirmed` by the seller, optionally
with `meetupConfirmedAt`/`updatedAt`). Every field below is blocked by
`diff().affectedKeys().hasAny([...])` and may change **only** via Cloud
Functions: `status`, `amount`, `totalAmount`, `sellerPayout`, `serviceFee`,
`serviceFeePercent`, `sellerCreditedCents`, `walletAmountUsed`, `paidVia`,
`shippingCost`, `actualShippingCost`, `shippingCostDelta`, `insuranceCost`,
`shippingReconciledAt`, `fundsReleaseAt`, `fundsReleasedAt`, `disputed`,
`disputeId`, `disputedAt`, `disputeReason`, `statusBeforeDispute`,
`disputeOutcome`, `disputeClosedAt`, `labelCreationPending`, `labelCreationNote`,
`labelAttempts`, `lastLabelAttemptAt`, `labelStaleNudgedAt`, `shipEngineRateId`,
`shipEngineLabelId`, `trackingNumber`, `trackingUrl`, `trackingStatus`,
`shippingLabelUrl`, `carrierCode`, `stripePaymentIntentId`, `stripeChargeId`,
`stripeRefundId`, `stripeRefundIssuedAt`, `refundReason`, `refundStartedAt`,
`refundedAt`, `cancelReason`, `cancelledBy`, `cancelledAt`, `meetupSpot`
(immutable after creation), `deliveryType`, `buyerReport`, and the buyer-return
(B2) fields `returnLabelId`, `returnTrackingNumber`, `returnLabelUrl`,
`returnCarrierCode`, `returnLabelCost`, `returnReason`, `returnTrackingStatus`,
`returnRequestedAt`, `returnDeliveredAt`, and all server timestamps
(`paidAt`, `labelCreatedAt`, `shippedAt`, `deliveredAt`, `deliveryFailedAt`,
`completedAt`, `createdAt`).

The `wallets` balance buckets (`balance`, `pendingBalance`, `heldBalance`,
`sellerDebt`) are protected by the blanket `wallets` write-deny (this collection
replaced the removed legacy `seller_balances`).

---

## Document Structures

### `article_sold_requests/{receiptKey}`

Local backend contract added on 2026-10-12; client integration/review/native verification still pending. No deployment performed.

`receiptKey = SHA256(JSON.stringify([uid, requestId]))`. The `toggleArticleSold` callable creates the receipt atomically with the article update. It now requires an explicit `observe` then `set` intention; it never blindly inverts the current status.

| Field | Type | Meaning |
| --- | --- | --- |
| `protocolVersion` | number (`1`) | Receipt protocol |
| `articleId` | string | Article being changed |
| `sellerId` | string | Authenticated owner |
| `requestId` | string | Stable identifier for this intention and its retries |
| `desiredIsSold` | boolean | Explicit requested state |
| `expectedIsSold` | boolean | State observed before confirmation |
| `expectedRevision` | string | Opaque hash of native document updateTime, including nanoseconds |
| `inputHash` | string | Binds article/request/state/revision to the same payload |
| `appliedAt` | timestamp | Server timestamp of the committed intention |

Existing receipts never authorize a second write. Reusing the requestId with a different payload is rejected. A superseded receipt remains historical proof; the caller must reconcile the current article in read-only mode rather than infer that the original commit failed. No query or index was added; access relies on the existing default deny. No TTL is implemented. Retention/privacy policy for these receipts remains to be reviewed in the corresponding business packet.

Exact callable DTO and replay qualifications: `_audit-reports/production-readiness/PACKAGE_ADMISSION_RN_B2_V4_SOLD_BACKEND_2026-10-12/CONTRACT.md`.

### `articles/{articleId}`

Main product listing collection. Source of truth for article data.

Phase 1 initial unconfigured installations may carry a server-only
`localCatalogueWitness` on listings and native `inventory_units/unit_*` records:
`{ protocol: 'local_catalogue_source_v1', installationId, epoch, ref,
nativeSourceHash, financialSettlement: 'not_asserted' }`. It binds the exact
native stock/owner/reservation projection, not a payment, balance, physical
identity or financial reconciliation. An existing listing is admitted only by
the inventory planner after native owner, revision, link and bounded-history
checks in its transaction. A present invalid witness or financial witness is
never silently replaced. Initial catalogue witnesses cannot be used in a
restored epoch or a test/live financial installation. A visibility-only removal
of an unadopted listing can remain witnessless: it neither releases stock nor
authorizes a later sale. All writes stay server-only under existing rules.

Owner privacy withdrawal stores the exact prior native article and update time
in private `article_privacy_evidence/{articleId}`. The public article retains an
explicit typed allowlist of stock identity, quantity, availability, ownership and
current engagement fields, plus a strict
`privacyWithdrawal: {schemaVersion: 1, articleId, operationId, withdrawnAt}`.
The dedicated transaction may refresh a valid local catalogue witness for the
visibility change only; it cannot adopt a legacy source or qualify money.
Malformed local stock proofs remain closed (`null` marker) with their complete
original captured privately. Known financial witnesses are retained as history,
never refreshed: changing visibility may make their old source hash noncurrent.
Paid or ambiguous contracts remain byte-equivalent except for a strict
`articlePrivacyWithdrawal` (purchase) or `articlePrivacyWithdrawals[articleId]`
(swap) documentary marker. Local agreement hashes exclude only these overlays;
every later native mutation requires the exact constant marker and matching
immutable private owner evidence. Private captures and public barriers cannot
be erased or changed outside the dedicated withdrawal scope. No wallet/ledger,
new acquisition, stock release or monetary reconciliation is authorized.

B03 keeps the common identity, membership, engagement and per-article receipt
in private `inventory_units` records. Public listings carry only an individual
opaque declaration marker and availability state, without another listing or
contract identifier. Owner-only `updateArticle` mode `inventory_unit` exposes
the qualified native group and opaque CAS revision. A new listing or explicit
legacy adoption must declare a new unit or the same unit as an owned reference;
current native identity is immutable. Publication V4 adds this independent
intent without changing sale-declaration V3 or publication V1/V2/V3 hashes.
Acquisitions, qualified releases and Troc completion share the unit transaction
with listing projections; historical receipts precede new commerce admission.
Party-readable commitments use an opaque unit and membership hash, not a member
list. This is a seller declaration, not recognition or proof of physical return.

```typescript
interface ArticleDocument {
  id: string;                    // Document ID
  title: string;                 // Article title
  description: string;           // Detailed description
  price: number;                 // Current price in CAD
  originalPrice?: number;        // Original price before price drop

  // Media
  images: {
    url: string;                 // Firebase Storage URL
    blurhash?: string;           // Blur placeholder hash
    width?: number;
    height?: number;
    order: number;               // Display order (0-based)
  }[];

  // Categorization
  category?: string;             // Main category
  categoryId?: string;           // Category ID
  categoryIds?: string[];        // Full category path IDs
  subcategory?: string;
  brand?: string;                // Primary brand
  brands?: string[];             // All brands (multi-brand support)
  size?: { value: string; system: 'US' | 'EU' } | null;  // ArticleSize object (US/EU never collide)
  color?: string;
  colors?: string[];
  material?: string;
  materials?: string[];
  pattern?: string;
  condition: 'neuf' | 'neuf sans étiquette' | 'très bon état' | 'bon état'
           | 'satisfaisant';

  // Seller
  sellerId: string;
  sellerName: string;
  sellerImage?: string;

  // Location
  location?: {
    city?: string;
    postalCode?: string;
    province?: string;
    coordinates?: { lat: number; lon: number };
    geohash?: string;
  };

  // Delivery
  isHandDelivery?: boolean;        // Supports in-person pickup
  isShipping?: boolean;            // Supports shipping
  packageSize?: 'small' | 'medium' | 'large'; // For shipping cost estimation
  deliveryOptions?: {              // Legacy structure (some older articles)
    pickup: boolean;
    shipping: boolean;
    shippingCost?: number;
  };

  // Meetup neighborhoods
  neighborhoods?: {                // Preferred meetup locations (max 10)
    id: string;
    name: string;
    city?: string;
  }[];
  neighborhood?: {                 // Primary meetup location (first of neighborhoods)
    id: string;
    name: string;
    city?: string;
  };

  // Status
  isActive: boolean;             // Visible in listings
  isSold: boolean;               // Has been sold
  activeTransactionId?: string;  // Server-owned accepted/reserved engagement
  isPromoted?: boolean;          // Sponsored listing
  // Auto-approved on creation (no moderation flow yet). ABSENT on legacy
  // articles created before this field existed; the search-index trigger and
  // the backfill script treat absent === approved and only de-index on an
  // explicit 'pending' | 'rejected'.
  moderationStatus?: 'approved' | 'pending' | 'rejected';

  // Engagement
  views?: number;
  likes?: number;
  favoritesCount?: number;       // Denormalized from favorites

  // Price drop tracking
  lastPriceDropAt?: Timestamp;
  priceDropPercent?: number;
  promotionActive?: boolean;

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
  soldAt?: Timestamp;
  deletedAt?: Timestamp;         // Set during GDPR cleanup

  // Search
  searchKeywords?: string[];
}
```

### `products/{productId}`

Legacy product documents used for search index updates. Kept in sync with `articles`.

Same structure as `articles` plus:
- `moderationStatus: 'pending' | 'approved' | 'rejected'`
- `isReported: boolean`
- `titleLowercase: string`

### `users/{userId}`

```typescript
interface UserDocument {
  id: string;                    // Firebase Auth UID
  email: string;
  displayName: string;           // Freely editable; DECOUPLED from username.
  // Persistent, unique, IMMUTABLE @handle (e.g. "marie.dupont"). Derived ONCE
  // from displayName at account creation by the assignUsername callable (Admin
  // SDK, runTransaction) and reserved in the usernames/{username} registry.
  // Never chosen or editable by the user. Client cannot add/edit/remove it
  // (protected in firestore.rules on both create and update). Optional to
  // tolerate the brief transient state before assignment completes.
  username?: string;
  profileImage?: string;
  authProvider: 'password' | 'google' | 'apple'; // Set by onUserCreated trigger

  // Profile
  bio?: string;
  phoneNumber?: string;
  accountType?: 'user' | 'seller' | 'admin';

  // Age gate — ISO "YYYY-MM-DD" string (NOT a Date/object, to avoid timezone
  // drift). Written server-side by the recordSignupConsent callable after
  // validating age >= 16 (MIN_AGE_REGISTER). Selling (Stripe Connect onboarding)
  // additionally requires age >= 18 (MIN_AGE_SELL, enforced in createStripeConnectAccount).
  dateOfBirth?: string;

  // Addresses
  addresses?: {
    id: string;
    label: string;
    street: string;
    city: string;
    postalCode: string;
    province?: string;
    country: string;
    coordinates?: { lat: number; lon: number };
    isDefault: boolean;
  }[];

  // Preferences
  preferences?: {
    notifications?: {
      email?: boolean;
      push?: boolean;
      messages?: boolean;
      likes?: boolean;
      sales?: boolean;
      articleFavorited?: boolean;
      priceDrops?: boolean;
      swapZoneReminder?: boolean;
    };
    privacy?: {
      showEmail?: boolean;
      showPhone?: boolean;
      showProfilePhoto?: boolean;  // When false, getUserPublicProfile returns null profileImage
      showLastSeen?: boolean;
    };
    sizes?: string[];                                    // Onboarding-derived clothing sizes (top + bottom merged)
    shoesSizes?: string[];                               // Onboarding-derived shoe sizes
    sex?: 'femme' | 'homme' | 'les-deux' | 'enfant';     // Onboarding-derived audience
    // AI profiling opt-in (RGPD). ABSENT or false => profilage IA DÉSACTIVÉ.
    // This is an opt-in flag: default = false.
    aiProfilingConsent?: boolean;
  };

  // Onboarding
  // NOTE: the legacy nested `onboardingPreferences` snapshot is no longer written
  // by saveOnboardingPreferences. Onboarding answers now live exclusively in the
  // canonical flat `preferences` map above (sizes / shoesSizes / sex). Some pre-
  // existing user docs may still carry an inert `onboardingPreferences` field that
  // is never read.
  onboardingCompleted?: boolean;

  // Style profile (AI-generated)
  styleProfile?: {
    styleTags: string[];
    styleDescription: string;
    recommendedBrands: string[];
    suggestedSizes: { top: string; bottom: string };
    confidence: number;
    generatedAt: Timestamp;
  };

  // Social
  likedSellers?: string[];      // User IDs of liked sellers
  sellerLikesCount?: number;    // How many users liked this seller
  fcmTokens?: string[];         // Android FCM push notification tokens
  expoPushTokens?: string[];    // iOS Expo gateway tokens (private owner document)

  // Stats
  rating?: number;              // Average review rating (0-5)
  reviewCount?: number;
  articlesCount?: number;       // Active & not-sold listings. Canonical writer: updateSellerArticlesCount trigger (triggers/products.ts)

  // Stripe Connect Custom — ALL CF-only (Stripe webhook + onboarding callables
  // via Admin SDK). Locked in firestore.rules: a client can never self-set or
  // mutate these (payout redirect / KYC skip / fake bank verification).
  stripeAccountId?: string;        // Stripe Connect Custom account ID (acct_xxx)
  stripeAccountStatus?: 'pending' | 'pending_verification' | 'partially_active' | 'restricted' | 'active';
  stripeChargesEnabled?: boolean;  // Can receive payments via platform
  stripePayoutsEnabled?: boolean;  // Can receive payouts from Stripe
  stripeDetailsSubmitted?: boolean; // Onboarding details submitted
  stripeAccountCreatedAt?: Timestamp;
  stripeBankAccountAdded?: boolean;  // Bank account attached to Custom account
  stripeBankAccountLast4?: string;   // Last 4 digits of default bank account
  stripeBankAccountStatus?: string;  // Default external account verification (new|validated|verified|errored)
  // KYC continuous remediation (F59) — written by handleAccountUpdated +
  // getStripeAccountStatus + uploadStripeIdentityDocument. Never undefined.
  stripeRequirementsCurrentlyDue?: string[];   // Stripe requirements currently due
  stripeRequirementsPastDue?: string[];        // Past-due requirements (=> restricted)
  stripeRequirementsDisabledReason?: string | null; // Payout disabled reason, or null
  stripeRequirementsCurrentDeadline?: number | null; // Unix seconds deadline, or null

  // Status
  isVerified?: boolean;
  isActive: boolean;
  isAdmin?: boolean;             // Admin flag (protected, cannot be self-set)
  lastSeen?: Timestamp;

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

#### Sub-collection: `users/{uid}/savedSearches/{searchId}`

```typescript
interface SavedSearchDocument {
  name?: string;                 // User-defined search name
  query?: string;               // Text query
  filters?: {
    categoryIds?: string[];
    brands?: string[];
    sizes?: { value: string; system: 'US' | 'EU' }[];  // ArticleSize objects (patterns removed)
    colors?: string[];
    materials?: string[];
    condition?: string;
    minPrice?: number;
    maxPrice?: number;
  };
  notifyNewItems: boolean;       // Push notifications enabled
  lastNotifiedAt?: Timestamp;
  newItemsCount?: number;        // Count of unviewed new matches
  createdAt: Timestamp;
}
```

#### Sub-collection: `users/{uid}/searchHistory/{entryId}`

```typescript
interface SearchHistoryEntry {
  query: string;
  timestamp: Timestamp;
}
```

#### Sub-collection: `users/{uid}/consents/{autoId}`

Legal consent ledger. One document per accepted consent, append-only.

**Written SERVER-SIDE ONLY** by the `recordSignupConsent` and
`setMarketingConsent` callables (Admin SDK). Firestore rules: owner can READ;
`create/update/delete: if false` (no client writes ever). The `acceptedAt`
timestamp and `version` are authoritative proof of consent and must never be
client-tamperable.

```typescript
interface ConsentDocument {
  type: 'terms' | 'privacy_policy' | 'marketing';
  version: string;        // Policy version, e.g. "2026-05-31" (POLICY_VERSION)
  acceptedAt: Timestamp;  // serverTimestamp()
  channel: 'app';
  // Present on type 'marketing' docs written by setMarketingConsent:
  // true = consent granted, false = consent withdrawn. Each grant/withdrawal
  // appends a NEW doc (never mutates prior ones) — the ledger keeps the full
  // history (Loi 25 art. 14 / LCAP proof). Absent on legacy signup-time
  // marketing docs (implicitly granted at signup).
  granted?: boolean;
}
```

At signup, `recordSignupConsent` always writes `terms` + `privacy_policy`, and
additionally `marketing` only when the user opted in (`marketingOptIn === true`).

**`setMarketingConsent({ enabled })`** (callable, region
`northamerica-northeast1`): handles marketing consent grant/withdrawal post-signup.
It (a) appends a new `marketing` consent doc with `granted: enabled` (append-only
proof — existing docs are never modified), and (b) enforces the effect server-side
by setting `users/{uid}.preferences.marketingConsent = enabled` and the marketing
notification flags `preferences.notifications.{priceDrops, articleFavorited,
swapZoneReminder} = enabled`. Those flags are re-read by the favorites triggers
before any send, so a withdrawal stops all marketing emissions. Returns
`{ ok: true, enabled }`.

The `users/{uid}.preferences.aiProfilingConsent` boolean flag (opt-in AI
profiling, default **false** / absent ⇒ disabled) is a SEPARATE preference,
managed via the preferences flow — NOT written by `recordSignupConsent`.

### `usernames/{username}`

Uniqueness registry for the unique, immutable `@handle`. The document ID **is**
the username (e.g. `usernames/marie.dupont`). Acts as a lock: reserving the doc in
a transaction guarantees a username is owned by exactly one user.

**WRITTEN SERVER-SIDE ONLY** (Admin SDK, inside a `runTransaction`) by:
`recordSignupConsent` (chosen-username reservation at signup, primary path),
`assignUsername` (auto-derived legacy/rescue path), and the `backfillUsernames`
script. Firestore rules: `read, write: if false` — fully server-only (no client
read either: this prevents username enumeration and the mapping leaks nothing
useful client-side).

```typescript
interface UsernameDocument {
  uid: string;          // The user that owns this username
  createdAt: Timestamp; // serverTimestamp() (or the user's createdAt for backfilled entries)
  backfilled?: boolean; // present only on entries created by backfillUsernames
}
```

**PIVOT (2026-06): user-chosen handle.** The handle is now CHOSEN by the user on
the signup route (not auto-derived). The format rules for a chosen handle live in
`functions/src/callable/username.ts` as `validateChosenUsername()`:
- length **3–20** (`USERNAME_MIN_LEN = 3`, `CHOSEN_USERNAME_MAX_LEN = 20`),
- charset `[a-z0-9._-]`,
- no leading/trailing separator, no doubled separators.
Input is trimmed + lowercased, otherwise accepted/rejected as typed (no
transliteration). This validator is shared by both the availability probe and the
submit, so they can never drift.

**`checkUsernameAvailability()`** (callable, `northamerica-northeast1`, 512MiB,
auth required): read-only probe (client debounces ~350ms). Input `{ username }`.
Output `{ ok: true, available: boolean, reason?: 'too_short' | 'too_long' |
'invalid_chars' | 'taken' }`. Reserves NOTHING; a direct `usernames/{username}`
doc lookup (no query). Anti-enumeration: never reveals the owning uid.

**`recordSignupConsent()`** (callable, single submit entry point): reserves the
chosen handle ATOMICALLY with the consent write in one `runTransaction`. Input
adds `desiredUsername?`. Re-validates format server-side; if taken by ANOTHER uid
→ `HttpsError('already-exists', …, { field: 'username' })` (NO auto suffix —
inline field error client-side, account NOT rolled back). Idempotent: an existing
`users/{uid}.username` is immutable and returned unchanged. Output
`{ ok: true, age, username? }`.

**`assignUsername()`** (callable, `northamerica-northeast1`, 512MiB): LEGACY /
RESCUE auto-derivation. Derives a slug from `displayName` (transliterate accents →
lowercase → spaces to `.` → strip chars outside `[a-z0-9._-]` → collapse repeated
separators → trim borders, bounded 3–30 chars, deterministic `user.<uid6>`
fallback). If the slug is taken, appends a numeric suffix (`.2`, `.3`, …). Reserves
`usernames/{final}` + writes `users/{uid}.username = final` in a transaction.
**Idempotent / immutable**. Still wired as the `authStore` rescue net for legacy
accounts that signed up before the chosen-username route existed.

**`backfillUsernames` script** (`functions/scripts/backfillUsernames.ts`, run by
the founder locally, NOT deployed): one-shot idempotent backfill that guarantees
every `users/*` with a `username` has a matching `usernames/{username}` entry.
Conflicts (registry entry owned by a different uid) are logged and LEFT UNTOUCHED.
Run order prerequisite — see deploy order below.

### `privacy_incidents/{incidentId}`

Privacy/security incident register (Loi 25 / RGPD breach log). **WRITTEN
SERVER-SIDE ONLY** (Admin SDK via the `reportPrivacyIncident` callable and
automated handlers such as the `deletion_failed` path in `deleteUserAccount`).
Firestore rules: **admin READ only**; `create/update/delete: if false`.

```typescript
interface PrivacyIncidentDocument {
  type: string;            // e.g. "data_breach", "deletion_failed", "unauthorized_access"
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detectedAt: Timestamp;   // serverTimestamp()
  affectedUserIds: string[];
  affectedDataFields: string[];
  measures: string;        // mitigation/remediation taken or planned
  notifiedCAI: boolean;    // whether the Commission d'accès à l'information was notified
  notifiedCAIAt?: Timestamp;  // serverTimestamp() — set by escalatePrivacyIncidentToCAI
  caiReference?: string | null; // CAI dossier reference, or null if none provided
  notifiedUsersAt?: Timestamp;  // serverTimestamp() — set by notifyAffectedUsers once fan-out completes
  status: 'open' | 'investigating' | 'contained' | 'resolved';
}
```

**Escalation thresholds (Loi 25 — "incident de confidentialité"):** `severity`
`critical`/`high` ⇒ CAI notification **mandatory**; `medium` ⇒ at the privacy
officer's discretion; `low` ⇒ register-only. Target delay: **72 h** from
`detectedAt` to `notifiedCAIAt` / `notifiedUsersAt` (auditable via those stamps).

Escalation is performed **server-side only** by two admin-only callables:
- `escalatePrivacyIncidentToCAI(incidentId, caiReference?)` — sets `notifiedCAI=true`,
  `notifiedCAIAt`, `caiReference`, and advances `status` `open → investigating`
  (never regresses a more advanced status).
- `notifyAffectedUsers(incidentId, message)` — sends a `privacy_incident` in-app
  notification (best-effort per user) to each `affectedUserIds` entry and stamps
  `notifiedUsersAt`.

### Data-retention purge (`retentionPurge` scheduled function)

Inspection quotidienne bornée de candidats anciens. **Aucune suppression ni autre mutation** tant que la politique de disposition n'est pas qualifiée. Les seuils suivants servent au repérage opérationnel ; ils n'établissent aucune expiration légale. Les sources inconnues sont distinctes des demandes natives de conservation, `deleted` reste à zéro et la couverture n'est pas présentée comme exhaustive.

| Target | Threshold | Notes |
|--------|-----------|-------|
| `articles` (`isActive === false`) | `updatedAt` > 3 years | composite index `(isActive ASC, updatedAt ASC)` |
| `guest_preferences` | `createdAt` > 90 days | |
| `notifications` | `createdAt` > 180 days | |
| `users/{uid}/searchHistory` | `timestamp` > 12 months | collection-group index on `timestamp` |
| `drafts` | `updatedAt` > 90 days | abandoned sell-flow drafts; staleness = last modification |

Les transactions ne font pas partie de ce job ; leur durée de conservation applicable reste à qualifier séparément.

### `automatic_decisions_log/{logId}`

Extension K19 : les refus propres de création d'annonce, d'acceptation de rencontre, de proposition et d'acceptation Troc utilisent `protocol: admission_refused_v1`, `decisionType: admission_refused`, `transactionId: null`, `ownerId === userId`, opération/portée/politique, motifs et messages figés, critères déclaratifs minimaux et contexte natif. Écriture atomique avant tout engagement, exception après commit ; déduplication par source/politique/critères/version d'admissibilité/jour civil et quotas dans `rate_limits`. Le lecteur propriétaire dédié passe par la callable ; les règles de lecture directe liées à une transaction ne sont pas élargies. Les journaux historiques gardent leurs qualifications et limites.

Deux opérations additives gardent ce protocole : `updateArticle`, scope `sell`, contexte `{kind:'article_edit', articleId, articleRevision, inputHash}` ; `relistArticle`, scope `sell`, contexte `{kind:'article_relist', articleId, articleRevision, requestId, inputHash}`. Révision et empreintes natives sont figées après qualification du propriétaire ; première décision avant copie média, admission/source/session relues au commit. Les quatre anciennes identités restent inchangées. La projection, le lecteur propriétaire et le recours qualifient opération/contexte/référence exacte ; observation/retrait et reçus déjà commis ne deviennent pas de nouvelles admissions.

Extension Troc : `protocol: swap_funds_released_v1`, `sourceKind: swap`, `swapId`, `transactionId: null`, participants et bénéficiaire internes, critères historiques et `executedAt`. Le journal déterministe, le mouvement wallet, le ledger, le reçu `swaps/{id}/topup_release/committed` enrichi de `decisionId`/`decisionProtocol` et les deux avis `swap_update` partagent une seule transaction. Le lecteur callable `getAutomatedDecisionLog / swap_fund_release` exige session et participation actuelles, puis qualifie le reçu et le journal exacts sans reconstituer l’historique. DTO `swap_fund_release_log_v1` : `recorded` avec entrée minimale, `not_recorded` ou `unqualified` sans entrée ; `internalReleaseRecorded: true`, `externalPayoutVerified: false`. Aucun nouveau droit direct Firestore et aucun backfill des anciennes libérations. Le réexamen humain lié à cette décision reste distinct de l’aide générale Troc.

Transparency log of decisions taken **without human intervention** (Loi 25,
art. 12.1). **WRITTEN SERVER-SIDE ONLY**. Les libérations d'achat de
`releaseHeldFunds` écrivent leur explication dans le même commit que les fonds,
le statut et les avis. L’expiration locale `pending_payment` de `transactionExpiration`
fait également partie de ce commit local, sans attestation d’atomicité de l’appel Stripe externe.
D'autres producteurs historiques utilisent encore
`logAutomatedDecision` après l'effet, en best effort, sans couverture rétroactive.
Firestore rules: **READ by a party** (buyer or
seller of the linked transaction, resolved via `get()`) **or admin**;
`create/update/delete: if false`.

```typescript
interface AutomaticDecisionLogDocument {
  transactionId: string;        // links the decision to a transaction
  userId: string;               // the party the decision concerns (seller for funds_released, buyer for refunds/expiry)
  decisionType: 'funds_released' | 'transaction_expired' | 'label_refund';
  criteria: Record<string, unknown>; // human-readable criteria that drove the decision (e.g. { status, disputed, fundsReleaseAt, disputeWindowDays })
  result: string;               // human-readable outcome summary
  executedAt: Timestamp;        // serverTimestamp()
}
```

The three automated decisions: `funds_released` (heldBalance→balance after the
7-day dispute window, `releaseHeldFunds`), `transaction_expired`
(meetup 48h / pending_payment 1h / paid-not-shipped 7d cancellation,
`expireOrphanedTransactions`), `label_refund` (refund after the shipping label
could never be created, `sweepPendingLabels`). At the moment of each decision
the affected party also receives an in-app/push notification stating the
decision was **automatic** and that it can be contested.

Composite index required (used by `getAutomatedDecisionLog`):
`(transactionId ASC, executedAt DESC)`.

### Private authority cases in `support_requests/{id}`

Les acteurs natifs et les valeurs `buyerId`/`sellerId` des paquets conservent les UID Firebase exacts, espaces et forme Unicode inclus. Ils ne passent pas par le validateur de texte ou d'identifiant documentaire ; ces derniers gardent leurs règles existantes.

K20 réutilise la collection existante avec `kind: authority_request_private`, `protocol: authority_request_private_v1`, `ownerId: null`, `initiatedByAdminId`, réceptions/examens déclaratifs, portée explicite, version native et référence du dernier paquet. Les documents `commands/authority_cmd_*` portent les commandes privées et reçus exacts ; `commands/authority_package_*` porte le paquet occulté immuable. Aucune action héritée `submit` n'est produite. Seul l'opt-in administratif dédié peut lire le dossier ou préparer un paquet ; le propre reçu minimal peut être relu après perte du rôle. Les lecteurs, projections et mutations ordinaires refusent ce type. Aucune notification au membre visé, communication externe, permission juridique ou préservation des sources n'est déduite de ces documents. Aucun index ou chemin de collection supplémentaire.

Les dossiers support ordinaires, distincts de K20, engagent leurs avis de réponse/précisions dans `notifications` et `operational_notice_receipts` au même commit que la commande. Le tuple public `support_owner_update_v1` contient seulement le propriétaire exact, ticket, hash de commande, action et version ; aucun récit, contact ou UID d'agent. La clé d'événement est déterministe ; replay/observation/refus ne créent pas d'avis supplémentaire. Le reçu atteste le commit interne, sans lecture humaine ou communication juridique prouvées. L'ouverture relit le dossier propriétaire actuel ; ni l'avis ni sa lecture ne changent la réception initiale ou la conservation.

### Captures fiscales des nouveaux devis et achats

`pricingVersion: shipping_purchase_pricing_v2` et `taxSnapshot` lient les nouvelles sources, devis, acceptations de politique et commandes. Le snapshot `service_fee_tax_v1` contient les frais taxables réduits, TPS, TVQ, total CAD et configuration technique capturée ; `registrationStatusVerified:false` distingue ce calcul d'une qualification fiscale. `pricingBaseHash` reste privé dans la source ; son enveloppe lie le snapshot sans recalculer les empreintes historiques. Les anciennes sources positives non liées restent inconnues pour le remboursement, aucun backfill au taux actuel. Aucun changement des flags fiscaux ni des versions de politique ou de transport historiques.

### Clauses transport figées

La source privée des nouveaux `shipping_quotes` conserve `transportPolicy`, `transportAdmission` et `transportBaseHash`. La commande et son `shippingSnapshot` reçoivent seulement la capture sûre `shipping_transport_admission_v1` : services, valeur/prix article, plafond, franchise, bénéficiaire, exclusions et consignes, sans compte transporteur, empreinte stable de clé ni référence documentaire privée. L'engagement opaque de compte est contextualisé par la politique et la source. `transactions.transportBaseHash` relie cette capture à l'empreinte d'origine déjà contenue dans `purchasePolicy.sourceHash` ; il ne permet pas de la remplacer par deux copies concordantes.

`transportTermsAcceptance` est figé sur devis et commande avec `termsHash`, acheteur, devis/tarif, politique d'achat et le même `acceptedAt` natif. L'intention RN existante ajoute `expectedTransportTermsHash` ; les anciennes intentions gardent leur absence. Les contextes d'étiquette portent un `shipping_transport_leg_v1` aller/retour lié aux adresses et au colis d'origine. Une nouvelle acquisition exige la jointure native privée, y compris après perte de tous les marqueurs publics ; l'observation d'un achat déjà engagé peut reconstruire son contexte en mémoire sans réécrire la source ou créditer le vendeur depuis une preuve amputée. Le lecteur propriétaire historique ne remplace pas ces conditions par la configuration actuelle. Couverture réelle, ouverture d'un dépôt et collecte physique ne sont pas attestées par ces champs.

### Sessions après confinement de compte

Les nouvelles commandes privées `eligibility_audit/security_*` ajoutent `identityOrigin`, `identityObservationClaim` et `identityBaseline` : empreintes du jeton initial lié à la commande/barrière, réservation durable de la première observation Auth et intersection des seuls moyens déjà présents. Aucun JWT, courriel ou sujet fournisseur brut n'est conservé. Une première observation manquante/échouée et les commandes anciennes restent `baseline_unknown` ; aucune nouvelle connexion ne complète rétroactivement cette origine. Les indicateurs de vérification du courriel sont des observations distinctes, sans preuve de possession ou de rotation. Ces champs privés ne donnent aucun droit de récupération ou de nouvelle opération.

La commande privée `eligibility_audit/security_*` porte aussi `mediaSecurity` et des enfants `media_work/{pathHash}` : cutoff natif, curseurs chats/messages, autorisations de copie/révocation et preuves de conservation. La file initiale partage le commit de la barrière avant Auth ; les anciennes commandes ne sont reprises que depuis leur barrière exacte. Chaque retrait de jeton exige une copie privée génération/CRC/SHA commise puis PATCH CAS génération/métagénération, réconcilié par GET après interruption. Les sources remplacées ou postérieures au cutoff ne sont pas mutées. Une erreur Firestore de jointure conserve la page, les timestamps sont comparés à la nanoseconde. Le job existant reprend ces tâches dans une phase bornée distincte des mouvements financiers. Le DTO propriétaire n'expose que progression et compteurs, jamais chemins ou originaux ; fin des références natives scannées ne signifie ni couverture globale, ni retrait des caches déjà téléchargés, ni permission de récupération.

La présence de `eligibility_profiles.accountSecurityBarrier`, y compris null/malformée, ne vaut jamais absence de confinement. Les nouvelles gardes privées refusent une session authentifiée avant ou pendant la seconde de `recordedAt` ; une nouvelle authentification ultérieure peut retrouver l'historique sans retirer la barrière des nouveaux effets. Les CF du paquet requalifient aussi Auth courant, cutoff et liaison à la commande `eligibility_audit/security_*`. Les Rules valident forme et date sur données serveur, sans prétendre reproduire cette vérification cryptographique. Les lectures directes Storage `chat_images` sont fermées : le lecteur serveur existant qualifie message/chat/participant, restriction et session avant/après les octets sous génération native. Le client ne rend aucun ancien bearer en fallback. Les autres lecteurs hors paquet et les jetons précédemment diffusés restent distincts ; la restitution de l’historique ne donne pas à elle seule un droit commercial ni une réattribution Firebase.

La présence du marqueur privé serveur `eligibility_profiles.legacyDeletionFence`
ferme aussi la session SDK Firestore/Storage, indépendamment de sa valeur et de
`auth_time`. Même null ou malformé, il interdit modification et recréation du
profil, écritures de sous-collections et nouveaux drafts après suppression de
`users/{uid}`. Il ne peut être supprimé par le client. Son absence conserve les
gardes de session et de confinement existantes ; les lectures publiques du
catalogue ne deviennent pas des lectures privées.

La reprise explicite utilise des commandes privées `eligibility_audit/recovery_*` (`account_security_recovery_v1`) distinctes du confinement V1. Elles lient UID/épisode/source/version de confirmation et portent reçu immuable, état restored/neutralized, preuve native de fournisseur/sujet/cutoff/auth_time et, lors d’un renouvellement, `previousReceiptHash` et `previousStateHash`. Aucun secret Firebase, courriel ou sujet fournisseur brut supplémentaire n’est exposé. Un reçu n’accorde aucune nouvelle permission par lui-même.

`eligibility_profiles.accountSecurityRecovery` projette uniquement épisode, commande/requestId, source/receipt/state hashes et commit ; `eligibility_audit/recovery_state_<H(uid,episodeId)>` conserve la révision monotone et le dernier reçu. État, reçu et projection sont atomiques ; pertes sélectives ou source contradictoire refusent NEW. Ce témoin est dans la même base et ne certifie aucune continuité PITR hors Firestore. Avant chaque nouvelle action, jointure du profil natif attendu, du confinement original, de la baseline, du témoin et du reçu, puis Auth actuel ; seul un clone éphémère qualifié ouvre le prédicat partagé. Les anciens reçus et les autres restrictions sont conservés. Le nouveau confinement remplace seulement le pointeur d’épisode courant et ferme immédiatement toute ancienne permission.

### `automated_decision_contestations/{contestationId}`

Human-review requests against an automated decision (Loi 25, art. 12.1 right to
request human intervention). Opened by the `contestAutomatedDecision` callable
(Admin SDK). **REVERSES NOTHING automatically** — a human agent decides the
outcome out-of-band. Firestore rules: **READ by the author** (`userId`) **or
admin**; **CREATE allowed for the authenticated author** scoped to being a party
(buyer/seller) of the linked transaction and self-tagging `userId == uid`;
`update/delete: if false`.

```typescript
interface AutomatedDecisionContestationDocument {
  transactionId: string;
  userId: string;               // the contesting user (author == request.auth.uid)
  buyerId: string | null;       // snapshot of the transaction parties
  sellerId: string | null;
  decisionType: 'funds_released' | 'transaction_expired' | 'label_refund';
  reason: string;               // free-text justification (capped 2000 chars)
  status: 'open';               // opened; resolution is admin/CF-owned
  createdAt: Timestamp;         // serverTimestamp()
}
```

Opening a contestation also writes a low-severity `privacy_incidents` register
entry (`type: 'automated_decision_contestation'`) so the on-call admin dashboard
surfaces it for human review.

### `favorites/{userId}`

Single document per user containing all favorite article IDs.

```typescript
interface FavoritesDocument {
  userId: string;
  articleIds: string[];          // Array of favorited article IDs
  updatedAt: Timestamp;
}
```

### `favorite_memberships/{articleId}/users/{userId}`

Server-only projection acknowledgment (`counted: boolean`, `updatedAt: Timestamp`).
The owner may read their own acknowledgment so the UI preserves an optimistic
counter until the server has reconciled the live `favorites` source. Clients
cannot write it. Article/search counters are transactionally counted from the
canonical favorites query; this projection is not a second source of truth.

### `meetup_offer_threads/{threadId}` and `meetup_offer_requests/{requestId}`

Server-only proposal coordination; clients have no access under the default-deny
rules. `threadId` is SHA-256 of the JSON pair `[articleId, buyerId]`, independent
of the chat ID. `sendMeetupProposal` adopts legacy conversations on the first
write, then atomically replaces the current pending proposal through this shared
contention document. Different buyers have separate proposal threads; acceptance
also reads/writes the article's single `activeTransactionId` commitment.

```typescript
interface MeetupOfferThreadDocument {
  articleId: string;
  buyerId: string;
  chatId: string;
  messageId: string;
  status: 'pending' | 'accepted' | 'rejected';
  transactionId?: string; // Exact agreement link when accepted.
  updatedAt: Timestamp;
}

interface MeetupOfferRequestDocument {
  chatId: string;
  senderId: string;
  messageId: string; // Existing proposal on an idempotent replay/deduplication.
  createdAt: Timestamp;
}
```

Request IDs are reused across a retry, scoped to the sender/chat by the callable,
and currently retained without a TTL. Accepted cards link `offer.transactionId`
to `transactions.offerMessageId`; stale rejects never mutate that transaction.
Historical agreements with ambiguous or missing terms require explicit review
rather than silent replacement.

### `chats/{chatId}`

Chat thread between two users, optionally scoped to an article.

**Document ID format (dual-format, both coexist in production):**
- General chat (from profile): `${minUid}__${maxUid}` (2 segments)
- Article-scoped chat: `${minUid}__${maxUid}__${articleId}` (3 segments)
- Legacy chats may also have auto-generated IDs (pre-deterministic fix)

New chats initiated from an article page use the 3-segment format so that
two users can have separate conversations per article. Chats initiated
from a profile page (no article context) use the 2-segment format.

```typescript
interface ChatDocument {
  participants: string[];        // Exactly 2 user IDs
  // NOTE: Two formats exist in production (dual-format, both must be handled):
  //   Map format (current): { [userId]: { userName, profileImage } }
  //   Array format (legacy): [{ odlUserId, userName, userImage }]
  // New code writes map format. Reads must handle both.
  participantsInfo: {
    [userId: string]: {
      userName: string;
      profileImage?: string | null;  // Legacy array format uses `userImage` instead
    };
  };
  // Article context (set when chat initiated from an article)
  sellerId?: string;             // Seller UID — optional, may be null on legacy
                                 // chats created before this field was added.
                                 // Cloud Functions (e.g. createTransaction) read
                                 // sellerId from the article, not the chat.
  articleId?: string;            // Article being discussed
  articleTitle?: string;
  articleImage?: string;
  articlePrice?: number;

  lastMessage?: string;
  lastMessageType?: 'text' | 'image' | 'offer' | 'system';
  lastMessageTimestamp?: Timestamp;
  unreadCount?: { [userId: string]: number };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `messages/{messageId}`

Individual message within a chat.

```typescript
interface MessageDocument {
  chatId: string;                // Reference to parent chat
  senderId: string;              // Sender UID or 'system'
  receiverId: string;            // Receiver UID or 'system'
  participants: string[];        // Copy of chat participants (for rules)

  // Content
  content: string;
  type: 'text' | 'image' | 'offer' | 'system';
  origin?: 'participant_declaration'; // Set by postChatSystemMessage for a member-requested declaration, distinct from native server events elsewhere.
  declaredBy?: string;           // Current participant UID qualified with membership, blocking and containment in the same transaction.
  status: 'sent' | 'delivered' | 'read';
  isRead: boolean;

  // Offer data (type === 'offer')
  offer?: {
    amount: number;
    status: 'pending' | 'accepted' | 'rejected' | 'completed'
          | 'counter_price' | 'counter_location' | 'counter_time'
          | 'expired';
    message?: string;
    shippingAddress?: ShippingAddress;
    shippingEstimate?: ShippingEstimate;
    totalAmount?: number;            // amount + shipping
    expiresAt?: Timestamp;
    offerId?: string;                // Reference to MeetupOffer document

    // Meetup details (present when offer involves in-person exchange)
    meetup?: {
      location: MeetupSpot;          // { name, address, category, neighborhood }
      dateTime?: Timestamp;          // Optional — date/time agreed via chat
      proposedBy: 'buyer' | 'seller';
      confirmedAt?: Timestamp;
      completedAt?: Timestamp;
      noShow?: {
        reportedBy: string;          // userId who reported
        reportedAt: Timestamp;
        reason?: string;
      };
    };

    // Negotiation history (counter-offers, status changes)
    history?: {
      action: string;                // e.g. 'created', 'counter_price', 'accepted'
      by: string;                    // userId
      timestamp: Timestamp;
      previousValue?: any;
      newValue?: any;
      message?: string;
    }[];
  };

  // Shipping label (system messages)
  shippingLabel?: {
    labelUrl: string;
    trackingNumber: string;
    trackingUrl: string;
  };

  // Timestamps
  timestamp: Timestamp;
  readAt?: Timestamp;
}
```

### `transactions/{transactionId}`

Purchase transaction tracking from checkout to delivery.

```typescript
interface TransactionDocument {
  // Parties
  buyerId: string;
  buyerName?: string;
  buyerEmail?: string;
  sellerId: string;
  sellerName?: string;

  // Article
  articleId: string;
  articleTitle?: string;
  articleImage?: string;

  // Amounts (dollars)
  amount: number;                // Article price
  shippingCost?: number;         // Estimated shipping cost billed to the buyer (server re-priced)
  actualShippingCost?: number;   // Real ShipEngine label cost (shipment_cost + insurance_cost),
                                 // set when the label is created (reconcileShippingCost)
  shippingCostDelta?: number;    // actualShippingCost - shippingCost. > $2 absolute => CRITICAL log
                                 // + platform_ledger 'shipping_cost_variance' entry
  insuranceCost?: number;        // Real insurance cost on the label (dollars), 0 when none
  shippingReconciledAt?: Timestamp; // When the label cost was reconciled
  serviceFee?: number;
  serviceFeePercent?: number;
  totalAmount?: number;          // What the buyer pays (amount + shipping + fee)
  sellerPayout?: number;         // What the seller receives

  // Status flow:
  //   Shipping: pending_payment -> paid -> label_created -> shipped -> delivered -> completed
  //             | cancelled | disputed | refunded | delivery_failed
  //   DECOUPLED (P1): the shipping label being purchased sets 'label_created'
  //   (NOT 'shipped'). 'shipped' is set only on the FIRST real carrier scan
  //   (tracking poller / ShipEngine webhook). This distinguishes a seller who
  //   printed a label from one who actually handed the parcel to the carrier;
  //   the tracking poller nudges sellers whose label_created parcel has had no
  //   scan for 3 days (labelStaleNudgedAt).
  //   Delivered funds enter a 7-day dispute window (heldBalance). At J+7 without
  //   dispute, releaseHeldFunds moves delivered -> completed (heldBalance -> balance).
  //   Meetup:   meetup_pending -> meetup_confirmed -> meetup_completed | cancelled
  //   Failed:   pending_payment -> cancelled (via payment_failed webhook)
  //   Expiry (P1): pending_payment -> cancelled only after expireOrphanedTransactions
  //   confirms the Stripe PaymentIntent is NOT in flight (retrieve -> not in
  //   requires_capture/processing/succeeded) and cancels the PI. An in-flight PI
  //   defers expiry (avoids cancelling a captured payment). A PI.succeeded landing
  //   AFTER cancellation triggers an idempotent auto-refund (rf_${txId}).
  //   Seller-no-ship refund (P1): paid -> refund_in_progress -> refunded. The
  //   3-phase refund (mark in_progress -> Stripe refund w/ idempotencyKey
  //   rf_${txId} + persist stripeRefundId -> apply wallet movements + set
  //   refunded) is crash-safe; a stuck refund_in_progress is resumed by the same
  //   scheduled job (re-uses persisted stripeRefundId, no double refund). Final
  //   status 'refunded' makes the inbound charge.refunded webhook a no-op.
  //   Delivery failure (carrier FAILURE/exception via poller or ShipEngine
  //   webhook): label_created|shipped -> delivery_failed (disputed=true, funds
  //   NOT released). Resolution = adminRefundTransaction.
  //   Dispute:  paid|label_created|shipped|delivered -> disputed
  //             -> (won: restore prev status) | (lost: refunded)
  //   Buyer return: requestReturn records the native intent, then an accepted
  //   quote before label purchase. returnDeliveredAt is a carrier observation;
  //   a delivery scan alone never grants a NEW refund or proves the contents.
  //   G10 schema2 is separate from the original non-conformity schema1:
  //   explicit seller agreement + accepted financial addendum reserve the GROSS
  //   article budget before the platform buys the label. A separate qualified
  //   financial instruction reverses the gross article price from the seller
  //   and refunds gross minus the accepted return cost to the buyer. Original
  //   shipping, service fee and service taxes remain excluded. Unknown purchase
  //   results preserve the reservation and allow exact GET-only recovery.
  status: 'pending_payment' | 'meetup_pending' | 'meetup_confirmed'
        | 'meetup_completed' | 'paid' | 'label_created' | 'shipped'
        | 'delivered' | 'completed' | 'cancelled' | 'disputed' | 'refunded'
        | 'refund_in_progress' | 'delivery_failed' | 'lost' | 'return_requested';
        // 'refund_in_progress' (P1): transient state during the seller-no-ship
        // 3-phase refund (Stripe refund issued, wallet movements pending). Always
        // resolves to 'refunded' within the same or a subsequent scheduled run.

  // Payment method
  paidVia?: 'wallet' | 'wallet_and_card';  // Set when wallet is used (absent = card-only destination charge)
  walletAmountUsed?: number;       // Wallet portion in cents (for mixed payments)
  walletCheckoutAttemptId?: string; // Server-generated reservation id; stable on retries.
  walletCheckoutOutcome?: 'creating' | 'unknown'; // No refund/expiry without certified Stripe outcome.
  sellerPendingCreditCents?: number; // Net sale amount entering escrow (gross minus debt repaid).
  sellerDebtRepaidCents?: number;  // Debt paid down at original sale credit.
  sellerHeldCreditCents?: number; // Actual cents moved pending -> held for this sale.
  sellerReleasedCents?: number;   // Actual held cents consumed at release (including debt repayment).
  sellerCreditedCents?: number;    // Gross refund exposure, including debt repaid (in cents).
  sellerCreditRecordedAt?: Timestamp; // First actual seller-credit commit, including debt-only credit; old absence stays unknown, no fiscal-period inference.
                                   // ATOMICITY (P1): for SHIPPING transactions the seller is credited
                                   // ONLY after the shipping label is successfully created (label step
                                   // or sweepPendingLabels), so this field is ABSENT while a shipping
                                   // tx is still 'paid' + labelCreationPending. For non-shipping it is
                                   // set at payment. Its presence is the authoritative signal that the
                                   // seller was credited: a refund/lost dispute debits precisely this
                                   // figure (cascading pendingBalance -> heldBalance -> balance); when
                                   // ABSENT the debit target is 0 (never credited => no false debt).
                                   // Any shortfall already withdrawn is recorded as sellerDebt.

  // Stripe Connect payment
  stripePaymentIntentId?: string;  // Stripe PaymentIntent ID
  stripeCheckoutCreatedAt?: Timestamp;
  stripeChargeId?: string;         // Latest charge ID from webhook
  stripeRefundId?: string;         // Stripe refund ID (if refunded)
  stripeRefundIssuedAt?: Timestamp; // P1: stamped when the expiry job / auto-refund
                                   // successfully calls Stripe refunds.create (before
                                   // wallet movements). Crash-recovery marker so a
                                   // resumed refund_in_progress skips re-calling Stripe.
  refundReason?: string;           // P1: machine-readable refund reason set at PHASE 1
                                   // (e.g. seller_did_not_ship_7d)
  refundStartedAt?: Timestamp;     // P1: stamped when status -> refund_in_progress

  // Dispute window (7-day held funds)
  fundsReleaseAt?: Timestamp;      // deliveredAt + 7d; when heldBalance becomes withdrawable
  fundsReleasedAt?: Timestamp;     // Set by releaseHeldFunds when heldBalance -> balance

  // Dispute / cancellation
  bankDispute?: {                  // Server-only, independent of commercial status/recourse.
    id: string;                   // Stripe dossier identity retained after closure.
    state: 'open' | 'closed';
    outcome: null | 'won' | 'lost' | 'warning_closed';
    stripeStatus: string;         // Unknown outcomes remain open; never authorize release.
    reason: string | null;
    amountCents: number;
    freezeCents: number;           // Exact withdrawable, transaction-attributed cents frozen.
    statusBeforeOpen: string | null;
    commercialDisputedBeforeOpen: boolean; // Active commercial context, not historical buyerReport presence.
    openedAt: Timestamp;
    closedAt?: Timestamp;
    ledgerReconciledAt?: Timestamp; // Full LOST ledger/debt reconciliation committed atomically (not a Stripe refund confirmation).
    reconciliationRequired?: boolean; // Partial/unqualified loss or refund/hold race needs operator review.
    conflictingDisputeId?: string; // A second dossier blocks automatic settlement pending reconciliation.
  };
  disputeId?: string;              // Active/legacy Stripe projection; retained through required local reconciliation, identity also in bankDispute.id.
  disputed?: boolean;              // True while a dispute is open (Stripe chargeback OR buyer report).
                                   // Blocks seller withdrawals AND held-funds release (releaseHeldFunds
                                   // no-ops while disputed === true).
  disputedAt?: Timestamp;
  disputeReason?: string;
  statusBeforeDispute?: string;    // Status captured at dispute.created (or buyer report), restored if won
  disputeFreezeCents?: number;     // Exact amount moved balance -> heldBalance at dispute.created;
                                   // released back to balance by dispute.closed (won/closed, or LOST surplus)
  disputeOutcome?: 'won' | 'lost' | 'dismissed' | string; // Set by charge.dispute.closed; 'dismissed' by resolveDispute (admin closes in favor of seller, no refund)
  disputeClosedAt?: Timestamp;
  disputeResolvedAt?: Timestamp;   // Set by resolveDispute (admin dismissal — F27/F88/F10)
  disputeResolutionNote?: string;  // Optional admin note attached by resolveDispute (<= 500 chars)
  returnEscalatedAt?: Timestamp;   // F26: set ONCE by expireOrphanedTransactions when a return_requested
                                   // leg has no DELIVERED scan after 21d — a dispute doc is opened for admin review
  buyerReport?: {                  // Set by reportTransactionProblem (buyer "delivered but problem").
    reason: 'not_received_despite_delivered' | 'not_as_described' | 'damaged' | 'other';
    details?: string;              // Optional free text (<= 1000 chars; omitted when empty)
    reportedAt: Timestamp;
  };
  refundInitiatedAt?: Timestamp;   // Stamped by requestRefund when status -> refund_in_progress
                                   // (buyer auto-refund on carrier-confirmed delivery_failed/lost).
                                   // Cleared on rollback if the refund core throws.

  // Buyer return leg — transport, physical declarations and refunds are distinct.
  returnLabelId?: string;          // ShipEngine label id of the RETURN parcel (buyer -> seller)
  returnTrackingNumber?: string;   // Tracking number of the RETURN parcel (polled / webhook-matched)
  returnLabelUrl?: string | null;  // Downloadable PDF of the return label
  returnCarrierCode?: string | null; // Carrier of the return parcel (poller getTracking)
  returnLabelCost?: number;        // Native label cost in DOLLARS, not a refund instruction.
  returnReason?: 'not_as_described' | 'damaged' | 'wrong_item' | 'other' | 'change_of_mind';
  returnTrackingStatus?: string;   // Best-effort visibility of the return parcel's mapped status
  returnRequestedAt?: Timestamp;   // Stamped when the buyer requested the return (status -> return_requested)
  returnDeliveredAt?: Timestamp;   // Carrier-reported return delivery, not contents or refund proof.
  // returnRequest.schemaVersion: 1 non-conformity; 2 qualified G10 with immutable
  // convenienceReturnFinancialTerms/Hash in quote and explicit cost/net acceptance.
  // convenienceReturnFinancialReservation: convenience_return_financing_v1,
  // reservedAt + termsHash + consumedByRefundIntentId (null until financial reserve).
  // terms: convenience_return_cost_terms_v1, native agreement/request/basis/cumulative
  // hashes, grossArticleCents, returnLabelCostCents, netRefundCents and CAD.
  // G10 H allocation uses purchase_refund_allocation_v2 / purchase_refund_terms_v2:
  // article budget and seller reversal are GROSS; card+wallet are NET; the return
  // deduction consumes the difference once. Existing V1 meanings stay unchanged.
  // convenienceReturnFinancialSettlement: convenience_return_financial_settlement_v1,
  // exact native reference/intent/decision, gross/cost/net/rails/seller cents and
  // recordedAt; physicalPossessionVerified, inventoryReleaseAuthorized and
  // bankArrivalVerified remain false. No relisting follows this receipt.
  // convenienceReturnCostResolution: minimal public native reference/proof and
  // gross/accepted/actual/deduction/net/platform-variance cents, never the full
  // operator document. Deduction=min(accepted cost, actual cost); seller debit
  // remains gross. The original quote/reservation and historical hashes stay fixed.
  // Full cost resolution, command and private note live in convenience_return/
  // variance_{hash}; effectiveFinancingTerms is a qualified reader projection.
  // Operator adoption commits labelUrl=null; only the qualified buyer PDF read
  // publishes the document and member_document_furnishing_v1 civil clock atomically.

  cancelReason?: string;           // Machine-readable reason (payment_failed, meetup_expired_48h, pending_payment_expired_1h, seller_did_not_ship_7d, label_creation_failed, etc.)
  cancelledBy?: string;            // UID of user who cancelled (manual cancel only)
  refundedAt?: Timestamp;

  // Delivery type
  deliveryType: 'shipping' | 'meetup';

  // Shipping (ShipEngine)
  shipEngineRateId?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  trackingStatus?: string;       // 'LABEL_CREATED' (label bought, no carrier scan yet),
                                 // 'TRANSIT' | 'IN_TRANSIT' (carrier scanned -> status 'shipped'),
                                 // 'DELIVERED', 'FAILURE' (-> status 'delivery_failed'), 'UNKNOWN'
  shippingLabelUrl?: string;
  shipEngineLabelId?: string;
  carrierCode?: string;
  labelCreationPending?: boolean;  // True when the shipping label could not be created at payment
                                   // (ShipEngine down/5xx, expired or fallback_* rateId). The tx stays
                                   // 'paid', the seller is NOT credited, and sweepPendingLabels (hourly)
                                   // re-rates + retries createLabel. Cleared (false) on success.
  labelCreationNote?: string;      // Human-readable reason the label was deferred
  labelAttempts?: number;          // Number of sweepPendingLabels createLabel attempts. After 4 failures
                                   // the buyer is refunded and the transaction is cancelled.
  lastLabelAttemptAt?: Timestamp;  // Timestamp of the last sweepPendingLabels attempt
  labelStaleNudgedAt?: Timestamp;  // Last time the tracking poller nudged the seller about a
                                   // label_created parcel with no carrier scan (3-day window)
  actualShippingCost?: number;     // Real ShipEngine label cost (dollars), reconcileShippingCost
  shippingCostDelta?: number;      // actualShippingCost - estimated shippingCost (dollars)
  insuranceCost?: number;          // Real insurance cost on the label (dollars)
  shippingReconciledAt?: Timestamp;

  // Shipping address (deliveryType === 'shipping')
  shippingAddress?: {
    name?: string;
    street: string;
    city: string;
    postalCode: string;
    province?: string;
    country: string;
  };

  // Meetup (deliveryType === 'meetup')
  meetupSpot?: {                   // Agreed meeting location
    name: string;
    address: string;
    category: string;              // e.g. 'cafe', 'metro', 'parc'
    neighborhood: {
      id: string;
      name: string;
      city?: string;
    };
    coordinates?: { lat: number; lon: number };
  };
  meetupConfirmedAt?: Timestamp;
  meetupCompletedAt?: Timestamp;

  // Chat
  chatId?: string;

  // Timestamps
  createdAt: Timestamp;
  paidAt?: Timestamp;
  labelCreatedAt?: Timestamp;     // When the shipping label was purchased (status 'label_created')
  shippedAt?: Timestamp;          // When the carrier FIRST scanned the parcel (status 'shipped')
  deliveredAt?: Timestamp;
  deliveryFailedAt?: Timestamp;   // When a carrier FAILURE/exception flipped the tx to delivery_failed
  cancelledAt?: Timestamp;
  completedAt?: Timestamp;        // When meetup was completed
  refundReason?: string;          // Free-text reason set by adminRefundTransaction
  updatedAt?: Timestamp;
}
```

Les commandes sous décision opérateur d’annonce peuvent conserver
`moderationInstruction: { schemaVersion:1, id, articleId, decisionId, buyerId,
sellerId, action:'pause'|'continue', message, decidedAt }`, écrit uniquement
serveur et lisible par les parties avec leur commande. Motivation d’autorité,
références de preuve, acteur et reçu d’idempotence restent privés dans
`article_moderation/{articleId}/decisions/{decisionId}/orders/{transactionId}/instructions/{id}`.
La décision courante est relue avant nouvelle étiquette/libération ; une autre
décision invalide l’instruction précédente. Les reçus privés `notices/{hash}`
dédupliquent les avis in-app des parties, sans exposer le signalant ni les preuves.
`labelReconciliationRequired`/`labelReconciliationReason` conservent le besoin
de rapprochement d’une étiquette déjà achetée sans rendre l’ordre expédiable.

### `withdrawal_requests/{withdrawalId}`

Withdrawal record. Created atomically (`status: 'processing'`) inside the
`walletWithdraw` debit transaction, then closed out asynchronously by the
`payout.paid` (-> `completed`) / `payout.failed` (-> `failed` + re-credit)
Stripe webhook handlers, matched via `metadata.withdrawalRequestId` on the
Stripe payout. Server-only (see rules chantier).

The original submitter may persist the exact payout ID while an observer reads
Stripe. Only this null-to-same-ID enrichment is accepted with the same frozen
intention, owner, amount, account, transfer, debit and bank. An old
`payout_changed_during_recovery` marker remains held unless its exact pending
operator witness and a fully submitted modern intention can be requalified by
current native payout/transfer GETs and the original debit, without compensation
or recovery. Successful qualification closes the private failed-operation row
with `resolution.protocol=withdrawal_completion_requalification_v1`, exact
payout/transfer/debit IDs, the native-proof qualification, observation time and
`providerMutationSubmitted=false`. Other identity holds remain preserved.

```typescript
interface WithdrawalRequestDocument {
  withdrawalId: string;
  userId: string;
  amount: number;                 // In CENTS
  currency: 'cad';
  ledgerEntryId: string;          // Linked wallets/{userId}/ledger entry id
  stripeAccountId: string;        // Seller's Stripe Connect Custom account
  stripeTransferId?: string;      // Platform->connected transfer (tr_xxx) — persisted at walletWithdraw
                                  // so a lost payout.failed can be reverted (revertFailedPayout)
  stripePayoutId?: string;        // Stripe Payout ID (po_xxx) — persisted at walletWithdraw + payout.* webhook
  status: 'processing' | 'completed' | 'failed';
  payoutOutcome?: 'unknown' | 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled'; // Unknown keeps funds reserved.
  failureReason?: string;         // Set if status is 'failed'
  failedAt?: Timestamp;           // Set if status is 'failed'
  completedAt?: Timestamp;        // Set if status is 'completed'
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `shops/{shopId}` — paid-tier fields (F134)

Whole shop documents are private to their owner/admin: historical `legalInfo`
may contain tax or bank identifiers and is never a public projection. Client
creation and changes to `legalInfo` are refused, including administrator writes,
null, dotted paths and deletion; an unchanged historical value remains private.
Public discovery uses the explicit `shop_public_projection_v1` capability on
`getFeaturedSellers`, with allowlisted nested fields and bounded ID pagination.
Dates and positions without a qualified native value remain unknown/null in
the projection; they do not become today's date or coordinates `(0,0)`.

Shops are owner-writable for profile fields but the validation status, the
verification metadata, and the **paid forfait tier** are admin/Cloud-Function
owned (firestore.rules `match /shops`). The fee-reduction tier and its expiry are
set ONLY by the `shop_tier` webhook (`handleShopTierSucceeded`) after a
`purchaseShopTier` PaymentIntent succeeds — a client can never self-attribute a
tier (CF-only fields locked on both create and update).

```typescript
interface ShopTierFields {
  // CF-ONLY (locked in firestore.rules — set by the shop_tier webhook):
  tier?: 'pro' | 'premium';        // basic (absent) → 0 reduction; pro → 0.5; premium → 1
  tierPaidUntil?: Timestamp;       // Forfait active only while > now; expired → basic (reduction 0)
  tierPaymentIntentId?: string;    // Current entitlement pointer; immutable per-operation receipt guards replays.
  tierChargeId?: string | null;
}
```

The buyer-fee reduction (`resolveBuyerFeeReduction`, `callable/payments.ts`) is
honoured ONLY when `status === 'approved'` AND `tierPaidUntil > now`. Pricing:
`SHOP_TIER_PRO_MONTHLY_CENTS` (2999) / `SHOP_TIER_PREMIUM_MONTHLY_CENTS` (7999),
overridable by env. Swap top-ups DELIBERATELY do not get the reduction (peer
balancing payment, no shop relationship).

L11 : `purchaseShopTier` also accepts the durable `shop_tier_purchase_v1`
protocol (prepare, observe, neutralize, cancel_known_unconfirmed). The exact
UID/requestId/command and frozen price live in private
`eligibility_audit/forfait_<hash>` records. Authorization/body hash precede the
single provider create; unknown dispatches are recovered by reads only. A
pre-dispatch tombstone prevents late creation. A known unconfirmed PI can only
be canceled after explicit confirmation and fresh native qualification; unknown
native cancellation authorization is read-only. The private
`forfait_slot_<hash(uid,shopId)>` record serializes requests and preserves the
qualified current entitlement `{operationId,proofHash}`. Unknown historical
entitlements prevent new purchases without rewriting their history.

The webhook atomically writes the shop grant, immutable
`shop_tier_settlement_v1` receipt and `shop_tier_revenue` row, after requalifying
the current entitlement and native operation. Replaying A after renewal B does
not extend the grant again. Settlement includes the original amount/CAD,
PI/charge, paidUntil, recordedAt and proofHash. Existing V1 intents and receipts
remain serviceable; new purchases require the durable protocol. No tax
registration or provider acceptance is inferred from these records.

### `platform_ledger/{entryId}`

Platform accounting ledger (server-only). Records platform-side
revenue and financial variances for tax/audit traceability — does not move user
funds. Writers:
 - `reconcileShippingCost` (`utils/labelFulfillment.ts`) — shipping cost variance.
 - `preparePurchasePlatformAccounting` (`utils/refundAccounting.ts`) — native
   purchase base, logical-refund counterentry and current private qualification,
   committed by the real card/wallet/refund/repair transaction.
 - `recordTransactionRevenue` (`utils/labelFulfillment.ts`, E6/F133c) — qualified
   missing processor-fee enrichment and historical accounting gaps.
 - `handleShopTierSucceeded` (`http/webhooks.ts`, F134) — paid-shop forfait revenue.

Doc ids are DETERMINISTIC for the revenue entries (`service_fee_revenue_${txId}`,
`tax_collected_${txId}`, `shop_tier_revenue_${paymentIntentId}`). Purchase revenue
and tax first commit atomically; an exact replay makes no write and keeps the
original dates and amounts. An absent processing fee may be enriched from a
qualified native charge/BalanceTransaction CAD observation, preserving established
carrier cost; the separate carrier-cost writer retains ownership of that field.
Existing zero fees are values, not missing evidence. Historical gaps, malformed
entries and contradictions keep their records and create the deterministic
`admin_alerts/revenue_accounting_${txId}` witness instead of backdating or replacing
them. This change does not alter the paid-shop writer or choose any tax period.

`purchase_refund_${supportHash([transactionId, refundIntentId])}` identifies the
logical refund, never a provider refund or repair attempt. Its negative dollar
components come from the original accepted allocation and fiscal capture, each
TPS/TVQ component separately; native source/base hashes, amounts and first date
are immutable. Current observation/qualification may change. A late card failure
keeps actual local effects but makes accounting unknown; a qualified H18 repair
of the same intent restores that same counterentry without another deduction.

`purchase_accounting_state_${transactionId}` is the bounded current projection
(at most 100 allocation sources). Only its qualified `currentTotals` represents
current component totals; incomplete history, a conflicting source, bank overlap
or a refund predating the base produces `null` and a deterministic private
`admin_alerts/purchase_accounting_${supportHash(transactionId)}` gap. The actual
settlement is preserved. The historical gross base and the parallel tax register
must not be summed as current net revenue. No tax period, official credit note,
margin or finance-wide reconciliation is inferred. No platform costs or private
accounting corpus are copied into party-readable transactions.

```typescript
type PlatformLedgerDocument =
  | {
      type: 'shipping_cost_variance';   // Real label cost differed from the billed estimate
      transactionId: string;
      estimatedShippingCost: number;    // shippingCost billed to the buyer (dollars)
      actualShippingCost: number;       // Real ShipEngine label cost (dollars)
      delta: number;                    // actual - estimated (dollars). Logged CRITICAL when |delta| > $2
      currency: 'cad';
      createdAt: Timestamp;
    }
  | {
      // E6 / F133c — platform GROSS revenue for one successful purchase. Net
      // margin = serviceFee + shippingCostCollected − processorFees − carrierCost (tax excluded).
      type: 'service_fee_revenue';
      transactionId: string;
      sellerId: string;
      serviceFee: number;               // buyer protection fee collected (dollars)
      taxCollected: number;             // TPS/TVQ on the fee (dollars; 0 when TAX_ENABLED=false)
      shippingCostCollected: number;    // shipping billed to the buyer (dollars)
      grossRevenue: number;             // serviceFee + taxCollected + shippingCostCollected
      processorFees?: number;           // Stripe fee on the charge (balance_transaction.fee, dollars)
      processorFeeChargeId?: string;    // Qualified native charge provenance for a new/enriched fee; legacy values are not backfilled.
      processorFeeBalanceTransactionId?: string; // CAD charge balance transaction supplying that fee.
      carrierCost: number;              // Carrier shipment + insurance cost (dollars).
      carrierCostEstimated: boolean;    // True before actual label cost is known.
      netMargin?: number;               // serviceFee + shippingCostCollected − processorFees − carrierCost
      accountingSourceHash?: string;    // Qualified native payment/component source; absent on old entries.
      currency: 'cad';
      createdAt: Timestamp;
    }
  | {
      // F133c — tax remittance register entry (only when TAX_ENABLED=true).
      type: 'tax_collected';
      transactionId: string;
      taxTotal: number;                 // TPS + TVQ on the service fee (dollars)
      currency: 'cad';
      createdAt: Timestamp;
    }
  | {
      type: 'purchase_refund_counterentry';
      protocol: 'purchase_platform_accounting_v1';
      transactionId: string;
      refundIntentId: string;
      source: Record<string, unknown>;   // Minimal native allocation identity/components, no private proof body.
      sourceHash: string;
      baseHash: string;
      serviceFee: number;                // Negative refunded components, dollars.
      shippingCostCollected: number;
      gst: number;
      qst: number;
      taxCollected: number;
      grossRevenue: number;
      qualification: 'qualified' | 'reconciliation_required';
      observation: Record<string, unknown>;
      observationHash: string;
      taxRegisterIsParallel: true;
      fiscalEffectiveDate: null;
      currency: 'cad';
      createdAt: Timestamp;              // Original counterentry date, never reset by repair.
      observedAt: Timestamp;
    }
  | {
      protocol: 'purchase_platform_accounting_v1';
      transactionId: string;
      baseHash: string;
      qualification: 'qualified' | 'reconciliation_required';
      reason: string | null;
      inspectedAllocations: number;
      historyComplete: boolean;
      taxRegisterIsParallel: true;
      currentTotals: {serviceFee: number; shippingCostCollected: number; taxCollected: number} | null;
      netMargin: null;
      fiscalEffectiveDate: null;
      projectionHash: string;
      observedAt: Timestamp;
    }
  | {
      // F134 — paid-shop forfait revenue (direct platform charge).
      type: 'shop_tier_revenue';
      shopId: string;
      ownerId: string | null;
      tier: 'pro' | 'premium';
      periodMonths: number;
      amount: number;                   // forfait price paid (dollars)
      paymentIntentId: string;
      chargeId: string | null;
      shopTierOperationId?: string;    // Native operation for an atomic qualified settlement.
      shopTierSettlementHash?: string; // Links the immutable per-operation receipt.
      currency: 'cad';
      createdAt: Timestamp;
    };
```

> **Taxes TPS/TVQ (F133) — activation = DÉCISION FISCALE DU FONDATEUR.** Le rail
> de taxe (`utils/fees.ts`, flag `TAX_ENABLED`, défaut `false`) est une
> infrastructure : OFF, la taxe vaut 0 et `buyerTotal` est inchangé. Activer
> `TAX_ENABLED=true` exige l'**immatriculation TPS (fédéral) + TVQ (Revenu
> Québec)** et le dépassement du seuil de petit fournisseur (30 000 $/4 trim.).
> Seul le **service fee** est taxé (fourniture taxable en facilitateur de
> marketplace) ; le **shipping refacturé est HORS SCOPE** — à trancher avec un
> fiscaliste avant de le taxer. Taux réglables par env : `GST_RATE` (0.05),
> `QST_RATE` (0.09975).

### `failed_operations/{opId}`

Dead-letter queue (server-only). A doc is written at every critical money/
shipping side-effect that fails after the point of no return (Stripe refund,
transfer/payout reversal, webhook amount mismatch, label give-up). The scheduled
`retryFailedOperations` (every 30 min) re-drives each `pending` doc idempotently
with exponential backoff, marking it `resolved` on success or `exhausted` after
6 attempts (a `CRITICAL` log fires on exhaustion for a log-based alert). The
`reconcileFinances` job (every 6h) also writes here when it detects a lost
PaymentIntent/payout webhook. Written via the `writeFailedOperation` helper
(`utils/failedOperations.ts`), which never throws. Purchase capture anomalies use
the separate mandatory `recordPaymentCaptureAnomaly` transaction: persistence
failure propagates and the webhook returns 500 without an event marker. Those
operator obligations stay pending, with proof refresh rather than financial replay.

The row is a locator, never financial authorization. Native purchase/Troc/refund
or withdrawal work owns any provider effect and its recovery. Orphan refund
aliases and `autoRefund` remain pending with `waiting_refund_action`; a transfer
reversal without a native withdrawal link uses `waiting_payment_reconciliation`.
These waits consume no attempts and make no POST, compensation or success
receipt, including when Stripe is unavailable. An empty provider observation
cannot recreate missing authority after restoration.

```typescript
interface FailedOperationDocument {
  type:
    | 'stripe_refund_failed'      // a refunds.create failed
    | 'transfer_reversal_failed'  // transfers.createReversal failed after a payout error
    | 'payout_reversal_failed'    // a payout could not be reversed/cancelled (or lost payout webhook)
    | 'payment_capture_reconciliation' // signed capture not safely attributable; operator only
    | 'amount_mismatch'           // webhook PI.succeeded amount != expected (deterministic)
    | 'label_refund_failed'       // legacy alias (older docs) — treated as stripe_refund_failed
    | 'admin_refund_failed';      // legacy alias (older docs) — treated as stripe_refund_failed
  refId: string;                  // Primary entity id (transactionId / withdrawalRequestId / swapId / eventId)
  payload: Record<string, any>;   // Everything the replay handler needs (paymentIntentId, transferId, amounts, autoRefund…)
  error: string;                  // Last error message
  attempts: number;               // Replay attempts so far (starts at 0)
  status: 'pending' | 'resolved' | 'exhausted';
  createdAt: Timestamp;
  lastTriedAt: Timestamp | null;
  resolvedAt?: Timestamp;         // Set when status -> 'resolved'
  exhaustedAt?: Timestamp;        // Set when status -> 'exhausted'
  actionRequired?: boolean;
  waitingReason?: 'waiting_bank' | 'waiting_bank_reconciliation' | 'waiting_refund'
    | 'waiting_refund_action' | 'waiting_payment_reconciliation'; // Waits do not consume attempts.
  lastBankCheckedAt?: Timestamp;  // Separate from provider-failure backoff/lastTriedAt.
}
```

> NOTE: earlier chantiers wrote a leaner shape (`transactionId`/`paymentIntentId`/
> `reason` at the top level, no `attempts`/`payload`). `retryFailedOperations`
> normalizes those legacy docs (transactionId→refId, reason→error) before
> dispatch, so both shapes are replayable.

Troc top-up refunds use `failed_operations/swap_topup_refund_{hash}` with protocol `swap_topup_refund_work_queue_v1`, `nativeWorkId`, type `stripe_refund_failed`, and payload kind `swap_topup_native_refund`. The native `swaps/{id}/topup_refund/prepared` record has protocol `swap_topup_refund_preparation_v1`, state `never_authorized`, source/work/content hashes, exact parties/payment and preparedAt; it is created atomically with the queue before Stripe lookup. Only this qualified work may receive its first authorization after an outage. That transaction fixes `current` (`swap_topup_refund_v1`) body/bodyHash, intentId, nativeWorkId, dispatchOwner, authorizedAt/postAuthorizedAt and the original idempotency key; prepared then becomes `authorized`. Every later recovery is provider-read-only, including an unknown original dispatch. `committed` (`swap_topup_refund_committed_v1`) proves both current provider success and exact local settlement. Pending/action/failed or unqualified legacy results remain obligations rather than success. Native marker presence blocks new held-fund release; no aggregate-wallet debit, fabricated debt or unqualified queue authorizes restitution.

### `admin_alerts/{alertId}` (F43/F85)

Operator-facing alerts for financial cases code CANNOT self-heal — distinct from
`failed_operations` (the auto-retry queue). Written via `writeAdminAlert`
(`utils/failedOperations.ts`, best-effort, never throws). The admin console reads
`status == 'open'`. Server-write only; admin read.

```typescript
interface AdminAlertDocument {
  kind:
    | 'payout_recredit_no_wallet'  // payout failed but the wallet to re-credit is gone (F43)
    | 'dead_letter_exhausted'      // a failed_operation exhausted MAX_ATTEMPTS (F85)
    | 'refund_failed'              // Stripe refund.failed — buyer not reimbursed (F104)
    | 'wallet_invariant_breach'    // reconcileBalances found a negative bucket (F85)
    | 'platform_revenue_reconciliation'; // Existing revenue/tax conflict or historical gap; no automatic accounting replacement.
  severity: 'critical' | 'warning';
  refId: string;                   // primary entity id (withdrawal/transaction/PI/wallet)
  message: string;                 // human-readable (FR) console message
  context: Record<string, any>;    // triage data
  status: 'open';                  // operators close manually
  createdAt: Timestamp;
}
```

### `job_locks/{jobName}` (F82)

Anti-overlap lock for scheduled jobs that perform PAID external side-effects (e.g.
`sweepPendingLabels` — ShipEngine labels). `acquireJobLock(jobName, ttlMs)` runs a
transaction that takes the lock only if free OR expired (TTL guards a crashed run);
`releaseJobLock` clears it in a `finally`. Server-only.

`releaseHeldFunds_transactions_cursor` persists the purchase scan position and cycle bound under an owned lease. Each completed row checkpoints only after any required review, alert and permanent receipt are durable; a failed row does not advance the cursor. Missing or malformed release dates remain reviewable.

`releaseHeldFunds_swaps_cursor` applies the same durable ID scan principle to completed or disputed exchanges. Financial release requires the exact native exchange movements and receptions requalified under transaction; unknown dates or attribution require review, not an aggregate wallet calculation.

`swapPostAcceptanceReview_cursor` stores `scanLease` (schemaVersion, ownerId, lockedAt/lockedUntil), `nextStatusIndex`, `scanCursors.{status}` (kind `swap_post_acceptance_review_by_id_v1`, cycleId, startedAt, fixed cutoff/untilId, lastId/completedAt) and `lastRowObservation` (status, sourceId/sourceVersion, observedAt, result). Each run inspects at most 25 rows per status/100 total within a cooperative 45-second budget. Status equality and ID ordering avoid a new composite index; age and source are requalified inside the row transaction. Checkpoint, native witness and alert commit together; failed persistence retains the row, and an expired owner cannot write or release its successor's lease. This job records no expiration, money, inventory or actual human review.

`withdrawal_requests.payoutTimingObservation` is a server-only documentary projection separate from completion/recovery receipts: exact payout status, qualified arrival estimate or unknown, native receive timestamp and content hash. Equal timestamps with conflicting contents remain ambiguous. Owner/admin allowlisted readers do not call the provider; the estimate authorizes no financial action.

`transactions.returnToSenderGuard` is server-only and independent from tracking, commercial, bank and moderation reviews. Its presence, including malformed data, blocks new sensitive progress; a report withdrawal, support response or delivery scan does not erase it. Genuine historical effects remain serviceable. A qualified financial decision must examine the exact reported cases separately.

`transactions.fraudReview` records a distinct server-only risk review. A signal, `actionable=false` or a closed provider review does not establish guilt, innocence or a global release permission. Phase-one intake qualifies unique native attribution and commits evidence, permanent receipts, alerts and essential notices before acknowledging an event; consumers and reconciliation require their own qualified integration.

`fraud_review_cases` also keeps platform-qualified signed/observed payment references and a distinct `candidateSellerId` projection from a unique native order. Candidate references never qualify attribution or ownership of the payment. NEW-permission consumers join exact native references even before reconciliation; wallet admission requalifies candidate/order sources. Native PI writers commit candidate projections in the same transaction as the PI reference.

`fraud_review_cases/{id}/recovery_attempts` and `/scan_reviews` preserve private recovery outcomes. `latestReceivedEventId`, `fraudRecovery` and `events.signedIdentityQualified/provenance` bind recovery to an actual dispatcher receipt. `job_locks/fraudReviewReconciliation_cursor` owns the bounded ID scan and durable checkpoint; pure readers expose qualified dates or unknown and require exact case/order revisions for detail pages.

```typescript
interface JobLockDocument {
  lockedAt: Timestamp;
  lockedUntil: Timestamp;  // now + ttlMs while held; Timestamp(0) when released
  releasedAt?: Timestamp;
}
```

### Webhook infrastructure (`stripeWebhook` / `shipEngineWebhook`)

`stripeWebhook` (`http/webhooks.ts`) accepts events from **two distinct Stripe
endpoint registrations that must both point at the same Cloud Function URL**
(`https://northamerica-northeast1-seconde-b47a6.cloudfunctions.net/stripeWebhook`):

| Stripe endpoint | Events | Signing secret |
| --- | --- | --- |
| PLATFORM | `payment_intent.*`, `charge.refunded`, `charge.dispute.*` (incl. `funds_withdrawn`/`funds_reinstated`), `refund.failed`/`refund.updated`, `transfer.reversed` | `STRIPE_WEBHOOK_SECRET` |
| CONNECT  | `payout.paid`, `payout.failed`, `payout.canceled`, `account.updated`, connected-account disputes | `STRIPE_CONNECT_WEBHOOK_SECRET` |

Each endpoint signs with its own secret. The handler tries `constructEvent` with
every configured secret and only rejects (401) when **none** verify (F100). Both
secrets live in Secret Manager and are declared in the function `secrets` array.

Newly-handled events (F42/F104/F106): `payout.canceled` (treated like
`payout.failed` → `revertFailedPayout`); `refund.failed` / `refund.updated`→failed
(raise a critical `admin_alerts` doc — the internal tx says 'refunded' but the
buyer was never reimbursed); `charge.dispute.funds_withdrawn`/`funds_reinstated`,
`transfer.reversed` (informational — log + ACK 200, never 400). A lost
`payment_intent.succeeded` is dead-lettered (`kind: lost_pi_succeeded_webhook`) and
auto-replayed by `retryFailedOperations` via `redrivePaymentIntentSucceeded` (F77).

Idempotence: each event is deduped by a `stripe_events/{event.id}` marker that is
written **only after the handler succeeds** — a handler that throws leaves no
marker so Stripe re-delivers (3-day retry window) and the event is replayed; the
per-handler status guards make a replay safe (F3). The collection is server-only.
Each marker carries `expiresAt = now + 90d` (F107) so a Firestore **TTL policy on
`stripe_events.expiresAt`** can purge old markers (90d ≫ Stripe's 3-day retry
window). The TTL policy itself is a console/gcloud action (founder).

`shipEngineWebhook` (`http/shipEngineWebhook.ts`) is the intended primary tracking
path (the every-12h `checkShippedTracking` poller is the safety net). It is
authenticated by the `SHIPENGINE_WEBHOOK_SECRET` shared secret (header
`X-ShipEngine-Webhook-Secret` or `?secret=` query, timing-safe; fail-closed 500 if
the secret is unset). The function must be DEPLOYED and its URL+secret REGISTERED in
ShipEngine for the webhook to fire (else it returns 404 — manual founder action).

### `disputes/{disputeId}`

Dispute tickets (server-only writes). Created by `reportTransactionProblem`
(buyer flags a delivered-but-problematic order), `reportMeetupNoShow`
(`type: 'meetup_no_show'`), or `expireOrphanedTransactions`
(`type: 'return_not_delivered'`, F26 — a return leg never scanned DELIVERED).
NO money moves at creation — the parent transaction is frozen (`disputed=true`).
A dispute is CLOSED by either `adminRefundTransaction` (refund the buyer →
`resolution: 'refunded'`) or `resolveDispute` (admin dismisses in favor of the
seller, no refund → `resolution: 'dismissed'`). Closing a dispute is what lets
the admin list empty AND unblocks both parties' account deletion (F27/F88).

```typescript
interface DisputeDocument {
  transactionId: string;           // Parent transaction
  buyerId: string | null;          // Reporting/affected buyer (== transaction.buyerId)
  sellerId: string | null;
  articleId: string | null;
  articleTitle: string | null;
  type?: 'meetup_no_show' | 'return_not_delivered' | string; // omitted for the buyer "delivered but problem" report
  reason:
    | 'not_received_despite_delivered'
    | 'not_as_described'
    | 'damaged'
    | 'return_leg_stale'
    | 'other'
    | string;
  details?: string;                // Optional free text (<= 1000 chars; omitted when empty)
  reportedBy?: string;             // Who filed (meetup no-show / generic reports)
  reportedAgainst?: string | null; // The accused party (meetup no-show)
  status: 'open' | 'resolved';     // 'open' at creation; closed by admin CFs
  resolution?: 'refunded' | 'dismissed'; // Set when status -> 'resolved'
  resolvedBy?: string;             // Admin uid that closed the dispute
  resolvedAt?: Timestamp;
  resolutionNote?: string;         // Optional admin note (<= 500 chars)
  statusBeforeDispute: string;     // Transaction status captured at report time
  createdAt: Timestamp;
}
```

### `avis/{reviewId}`

User reviews tied to completed transactions (sales or swaps).

**Review window**: Reviews can only be submitted within 60 days of transaction completion (`deliveredAt`, `meetupCompletedAt`, or swap `completedAt`).

**Doc ID format**:
- Sale reviews: `{reviewerId}_{transactionId}`
- Swap reviews: `{reviewerId}_swap_{swapId}`

```typescript
interface AvisDocument {
  id: string;
  reviewerId: string;
  reviewerName: string;
  reviewerImage?: string | null;
  vendeurId: string;             // Target user receiving the review (TODO: rename to targetUserId)
  transactionId: string;         // Transaction ID (sale) or Swap ID (swap)
  transactionType: 'achat' | 'vente' | 'swap';
  articleId?: string | null;
  articleTitle?: string | null;   // For swaps: title of the first exchanged article
  note: number;                  // 1-5 rating
  text: string;
  createdAt: Timestamp;
}
```

### `swaps/{swapId}`

Multi-article swap proposal between two users.

```typescript
interface SwapDocument {
  initiatorId: string;
  initiatorName: string;
  initiatorImage?: string;
  initiatorItems: {
    articleId: string;
    title: string;
    price?: number;
    image?: string;
  }[];
  initiatorTotalValue: number;

  receiverId: string;
  receiverName: string;
  receiverImage?: string;
  receiverItems: {
    articleId: string;
    title: string;
    price?: number;
    image?: string;
  }[];
  receiverTotalValue: number;

  // Full lifecycle (ordered). 'payment_pending' only occurs when cashTopUp is set:
  //   proposed -> accepted -> photos_pending -> shipping -> completed
  //   proposed -> payment_pending -> accepted -> ... (cash top-up swaps)
  //   proposed -> declined | cancelled
  //   payment_pending -> cancelled (initiator); no automatic expiry after acceptance
  //   accepted | photos_pending | shipping | completed(in-window) -> disputed (openSwapDispute, F48)
  // Accepted exchanges never auto-expire; aging alerts do not change status or funds.
  // Documentary dispute decisions do not authorize financial or stock movements.
  status: 'proposed' | 'payment_pending' | 'accepted' | 'declined' | 'cancelled'
        | 'photos_pending' | 'shipping' | 'completed' | 'disputed' | 'expired';
  message?: string;
  swapLaunchPolicyVersion?: string; // NEW proposals only: 18+, personal, declared QC
  exchangeMode?: 'hand_delivery' | 'shipping'; // Fixed before a NEW proposal
  exchangeAgreement?: {
    protocol: 'swap_exchange_agreement_v1';
    scope: 'new_proposal' | 'legacy_preparation';
    sourceHash: string; // Native items, participants, message, top-up and exact terms
    termsVersion: string;
    termsText: string;
    exchangeMode: 'hand_delivery' | 'shipping';
    arrangements: string;
    initiatorAcknowledgement: { actorUid: string; sourceHash: string; recordedAt: Timestamp } | null;
    receiverAcknowledgement: { actorUid: string; sourceHash: string; recordedAt: Timestamp } | null;
  };
  // NEW: proposer confirms before creation, receiver before acceptance.
  // Accepted legacy: both confirm the same native documentary preparation;
  // no retroactive age/residence admission or fabricated historical consent.

  // Optional cash adjustment, paid for real via Stripe with the SAME buyer
  // protection fee as a purchase (platform keeps the fee; payee receives the
  // base amount). The payer is one of the two participants.
  cashTopUp?: {
    amount: number;              // BASE amount in CENTS (> 0), fee excluded
    payerId: string;             // == initiatorId | receiverId
  } | null;

  // Immutable receipt of an actual initiator cancellation, in the same commit.
  // A fresh session can resume missing native refund work after a crash;
  // replay never cancels/releases inventory again or rewrites old cancellations.
  initiatorCancellation?: {
    protocol: 'swap_initiator_cancellation_v1';
    swapId: string;
    actorUid: string;
    statusBeforeCancellation: 'proposed' | 'payment_pending';
    sourceHash: string;           // Immutable agreement/payment identity, excluding refund progress.
    receiptHash: string;
    cancelledAt: Timestamp;
  };

  // Top-up payment fields (set by createSwapTopUpCheckout + stripeWebhook).
  topUpPaymentIntentId?: string; // Stripe PaymentIntent id
  topUpChargeId?: string | null; // Stripe charge id (latest_charge)
  topUpFee?: number;             // Platform service fee in CENTS, included in the direct charge (no application_fee_amount).
  topUpPaidAt?: Timestamp;       // set on payment_intent.succeeded (swap_topup): pendingBalance credited
  // Post-reception buyer-protection window (7 days), mirrors a delivered purchase:
  topUpFundsHeldAt?: Timestamp;  // set at confirmSwapReception: pendingBalance -> heldBalance
  topUpFundsReleaseAt?: Timestamp; // = topUpFundsHeldAt + 7d; releaseHeldFunds sweeps when due
  topUpReleasedAt?: Timestamp;   // set by releaseHeldFunds OR resolveSwapDispute(release_payee)
                                 // (held/pending -> balance, withdrawable). While UNSET (pre-reception
                                 // or in-window), the top-up is still refundable to the payer.
  topUpRefundId?: string;        // Stripe refund id (cancel/dispute/expiration)
  topUpRefundedAt?: Timestamp;   // Only after provider success AND exact local settlement.
  topUpRefundReconciledAt?: Timestamp; // Same native committed settlement, never POST acceptance alone.
  topUpRefundPreparationId?: string; // Durable never-authorized native work; presence blocks new release.
  topUpRefundIntentId?: string;  // First-authorized exact body; every recovery is GET-only.
  topUpSettlement?: object;      // swap_topup_settlement_v1 native no-credit proof; ordinary credit is qualified from its original ledger, never inferred from an empty ledger.

  // Dispute fields (F48). openSwapDispute FREEZES the swap (no auto-refund); the
  // money decision is reserved for the admin callable resolveSwapDispute.
  statusBeforeDispute?: string;  // status captured when the dispute was opened
  disputeReason?: string;        // free text (<=1000 chars)
  disputeOpenedBy?: string;      // uid of the participant who opened it
  disputeOpenedAt?: Timestamp;
  disputeResolvedBy?: string;    // admin uid (resolveSwapDispute)
  disputeResolvedAt?: Timestamp;
  disputeOutcome?: 'refund_payer' | 'release_payee'; // admin ruling
  disputeResolutionNote?: string; // admin note (<=500 chars)
  cancelReason?: string;         // e.g. cancelled_by_initiator | dispute_resolved_refund_payer
                                 //      | post_acceptance_expired_14d_from_<status>

  partyId?: string;              // Linked Swap Zone (id 'generalist')

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `swapParties/{partyId}`

Single permanent **generalist** Swap Zone. Lives at the deterministic document
id `swapParties/generalist`, bootstrapped idempotently by `ensureGeneralistZone`
(and self-healed by `getActiveSwapPartyInfo`). No themes, no time window, no
participants, no status. Open to all authenticated users.

```typescript
interface SwapPartyDocument {
  name: string;                  // 'Swap Zone'
  isGeneralist: true;
  itemsCount: number;            // live count of deposited items (CF-managed)
  swapsCount: number;            // completed swaps in the zone (CF-managed)
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

> Removed in the generalist refactor: `theme`, `emoji`, `description`,
> `status`, `startDate`, `endDate`, `participantsCount`, and the entire
> `swapPartyParticipants` collection (no join/leave model anymore).

### `swapPartyItems/{docId}`

```typescript
interface SwapPartyItemDocument {
  partyId: string;               // == 'generalist'
  articleId: string;
  sellerId: string;
  sellerName: string;            // Seller display name
  sellerImage?: string;          // Seller profile image URL
  title: string;                 // Article title
  price: number;                 // Article price
  imageUrl?: string;             // Article image URL
  isSwapped: boolean;            // Whether this item has been swapped (CF-managed)
  isPending?: boolean;           // Item is in an active swap proposal (CF-managed)
  addedAt: Timestamp;
}
```

### `notifications/{notificationId}`

```typescript
interface NotificationDocument {
  userId: string;                // Recipient user ID
  type: string;                  // e.g. 'message', 'offer', 'swap_proposed', etc.
  title: string;
  body: string;
  data?: Record<string, string>; // Custom payload
  isRead?: boolean;
  createdAt: Timestamp;
}
```

### `expoPushReceipts/{ticketId}`

Server-only delivery tickets for Expo iOS push. Clients have no access. A gateway
acceptance is not proof of device delivery. The 15-minute receipt job removes a
token only after a confirmed `DeviceNotRegistered`; unknown results retain the
token and retry for up to 24 hours, after which the pending ticket is removed.

```typescript
interface ExpoPushReceiptDocument {
  userId: string;
  token: string;
  createdAt: Timestamp;
}
```

### `drafts/{draftId}`

Unsaved article drafts for the sell flow.

```typescript
interface DraftDocument {
  userId: string;
  title?: string;
  description?: string;
  price?: number;
  images?: { url: string; order: number }[];
  category?: string;
  brand?: string;
  size?: { value: string; system: 'US' | 'EU' } | null;  // ArticleSize object
  condition?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `guest_preferences/{docId}`

Onboarding preferences saved before account creation.

```typescript
interface GuestPreferencesDocument {
  sex: 'femme' | 'homme' | 'les-deux' | 'enfant';
  sizesTop: string[];
  sizesBottom: string[];
  sizesShoes: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `moments/{momentId}`

Seasonal or event-based moments for curated product feeds.

```typescript
interface MomentDocument {
  id: string;
  name: string;
  emoji: string;
  priority: number;
  isActive: boolean;
  dateRange: {
    start: string;               // MM-DD format
    end: string;                 // MM-DD format
  };
  embedding?: number[];          // Vertex AI embedding for similarity matching
  createdAt: Timestamp;
}
```

### `embeddings/{articleId}`

Vertex AI multimodal embeddings for visual search and similar products.

```typescript
interface EmbeddingDocument {
  articleId: string;
  embedding: VectorValue;        // 1408-dimension vector (Firestore VectorValue)
  imageUrl: string;
  categoryIds: string[];
  brand?: string | null;
  priceRange: 'low' | 'medium' | 'high';
  isActive: boolean;
  isSold?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `search_index/{productId}`

Denormalized search documents for fast filtering and ranking.

```typescript
interface SearchIndexDocument {
  productId: string;
  title: string;
  titleLowercase: string;
  description: string;
  keywords: string[];

  // Filterable
  category: string;
  categoryIds: string[];         // Mirrored from articles (C1) — enables category filter in text search
  subcategory?: string;
  brand?: string;
  brands?: string[];
  color?: string;
  colors?: string[];
  material?: string;
  materials?: string[];
  size?: { value: string; system: 'US' | 'EU' } | null;  // ArticleSize object, mirrored verbatim
  condition: string;
  price: number;

  // Location
  location: {
    city: string;
    geohash: string;
    coordinates?: { lat: number; lon: number };
  };

  // Cached display
  sellerId: string;
  sellerName: string;
  sellerRating?: number;
  firstImage?: string;

  // Status
  isActive: boolean;
  isSold: boolean;
  isPromoted: boolean;

  // Ranking
  views: number;
  likes: number;
  popularityScore: number;
  createdAt: Timestamp;
  lastIndexed: Timestamp;
}
```

### `brands/{docId}`

Brand catalog seeded from `vinted-brands.txt` (canonical source, ~7309 unique
brands). Two consumers read this collection with **different field needs**, so a
seeded doc must satisfy both:

1. **UI brand picker** — `components/search/BrandSelectionSheet.tsx`. Queries
   `where('searchKey', '>=', q)` / `orderBy('label')`. Reads `label`, `value`,
   `searchKey`.
2. **IA brand matcher** — `functions/src/services/brands.ts` (`loadBrands`,
   used by `analyzeProductImage`). Reads `name`, `aliases`, `popularity`
   (falls back to `doc.id` when `name` is absent — which yields the hyphenated
   id and degrades matching, hence `name` must be seeded).

`docId` = `searchKey` with `/` → `_` and spaces → `-` (e.g. `louis vuitton` →
`louis-vuitton`). `name` keeps the proper **spaced** form (`louis vuitton`),
never the hyphenated id.

```typescript
interface BrandDocument {
  // UI picker contract
  label: string;       // display name, e.g. "louis vuitton" (spaced)
  value: string;       // lowercase search/dedup value (== searchKey)
  searchKey: string;   // lowercase, used for range queries

  // IA matcher contract
  name: string;        // proper spaced name (== label), NOT the hyphenated id
  aliases: string[];   // seeded empty []; alternate names for fuzzy matching
  popularity: number;  // seeded 0; ranking signal for matcher

  // metadata
  tier: 'luxury' | 'premium' | 'standard';
  count: number;       // seeded 0
  isCustom?: boolean;  // true only for user-added brands (client create path)
  updatedAt: Timestamp; // serverTimestamp on seed; createdAt on custom create
}
```

Seeded via `scripts/import-brands.js` (Admin SDK, bypasses rules). Idempotent
(`merge: true`, batches of 500). Run `npm run import:brands:dry` to validate
without credentials. Custom brands added at runtime by authenticated users go
through `firestore.rules` (create only, keys `['label','value','searchKey']`,
`isCustom == true`).

### `wallets/{userId}`

Virtual wallet for buyers and sellers. All amounts are in **cents** (not dollars) to avoid floating-point issues. Balance mutations are server-side only via Cloud Functions with `runTransaction`.

**Three-bucket seller funds model** (P1 dispute window):
- `pendingBalance` — sale paid, NOT yet delivered (escrow, in transit). Not withdrawable.
- `heldBalance` — delivered, inside the 7-day buyer-dispute window. Not withdrawable.
- `balance` — withdrawable (dispute window elapsed without claim, via `releaseHeldFunds`).
- `sellerDebt` — shortfall owed after a refund or lost dispute where the seller's funds were already withdrawn; blocks all future withdrawals until cleared. **Recovered automatically**: the next sale credit (`creditSellerForSale`) and the 7-day release (`releaseHeldFunds`) pay it down FIRST, with a `debt_repayment` ledger entry, before the remainder lands in `pendingBalance`/`balance`.

**Single-rail money model (separate charges & transfers).** Every buyer charge — pure card, mixed wallet+card, and swap top-up — lands on the PLATFORM account (NO `transfer_data.destination`, NO `application_fee_amount` at capture). The platform keeps the funds (which include the `shippingCost` used to pay the ShipEngine label and the `serviceFee`). The seller is credited ONLY in the wallet ledger and paid out by the SINGLE platform→connected transfer in `walletWithdraw`. Consequently a refund is a plain `stripe.refunds.create` on the platform PaymentIntent — there is NO transfer to reverse and NO application fee to claw back.

Only `sellerPendingCreditCents` (net after original debt repayment) may enter the sale escrow buckets. Delivery persists the actual, capped pending-to-held movement as `sellerHeldCreditCents`; release consumes at most that amount and persists `sellerReleasedCents`. For legacy documents, the exact transaction-linked `funds_held` ledger proves the actual held amount; absent movement proof keeps the funds reserved for reconciliation. Legacy net amounts are derived from the server-owned original debt-repayment ledger where necessary. `sellerCreditedCents` remains the gross exposure to undo on a full refund.

Fund flow per sale: `pendingBalance` (paid) → `heldBalance` (delivered, `applyDeliveredHeldFunds`) → `balance` (`releaseHeldFunds` after 7d). On `charge.dispute.created` any released portion is moved `balance → heldBalance` and the exact amount is persisted as `transactions.disputeFreezeCents`; `charge.dispute.closed` releases the frozen hold back to `balance` (won / warning_closed, `dispute_hold_released`) or debits the seller (lost, cascading `pendingBalance → heldBalance → balance`, recording `sellerDebt` if insufficient, and releasing any frozen surplus the debit did not consume).

Refund debit (any path: `charge.refunded` FULL only, `refundWalletPayment`, lost dispute): the seller is debited of EXACTLY `transactions.sellerCreditedCents` (gross sale exposure including debt repaid at credit), cascading `pendingBalance → heldBalance → balance` to drain wherever the funds currently sit. Any remainder the seller no longer holds (already withdrawn) is added to `sellerDebt` and recorded in a `refund_debit` ledger entry with `debtRecorded` — never masked with `min()`. On a mixed wallet+card refund, the buyer's wallet portion (`walletAmountUsed`) is re-credited to the buyer's wallet (internal movement) while the card portion is returned to the card by the upstream plain Stripe refund. A PARTIAL `charge.refunded` (`amount_refunded < amount`) does NOT unwind the sale — it is dead-lettered for human review.

```typescript
interface WalletDocument {
  balance: number;           // Withdrawable balance in cents
  pendingBalance: number;    // Funds in transit (paid, not delivered), in cents
  heldBalance?: number;      // Delivered, inside 7-day dispute window, in cents
  sellerDebt?: number;       // Shortfall owed after a lost dispute, in cents
  currency: 'cad';
  status: 'active';
  activatedAt: Timestamp;
  updatedAt: Timestamp;
}
```

#### Sub-collection: `wallets/{userId}/ledger/{entryId}`

Immutable transaction log for the wallet.

```typescript
interface WalletLedgerEntry {
  type:
    | 'sale_credit'        // seller credited into pendingBalance (escrow)
    | 'funds_held'         // delivered: pendingBalance -> heldBalance
    | 'funds_released'     // dispute window elapsed: heldBalance -> balance
    | 'dispute_hold'       // dispute opened: balance -> heldBalance (frozen)
    | 'dispute_hold_released' // dispute won/closed: heldBalance -> balance (hold returned)
    | 'debt_repayment'     // sale credit / release applied to sellerDebt first
    | 'purchase_debit'
    | 'withdrawal'
    | 'refund_credit'
    | 'refund_debit'       // seller debited on refund / lost dispute
    | 'withdrawal_failed';
  amount: number;            // Positive, in cents
  balanceAfter: number;      // Wallet balance after this entry
  description: string;       // Human-readable description (FR)
  status?: 'pending' | 'held';
  transactionId?: string;    // Reference to transactions collection
  withdrawalRequestId?: string; // Reference to withdrawal_requests doc
  debtRecorded?: number;     // Shortfall added to sellerDebt (lost dispute), in cents
  createdAt: Timestamp;
}
```

### `rate_limits/{userId_function}`

Rate limiting documents for Cloud Functions. Document ID format: `{userId}_{functionName}`.

```typescript
interface RateLimitDocument {
  userId: string;
  count: number;                   // Number of calls in current window
  windowStartedAt: Timestamp;      // Start of the current sliding window
}
```

Currently used by:
- `analyzeProductImage` -- key: `{userId}_analyzeProduct`, limit: 10 calls/hour

---

### `stats/{statType}`

Aggregated platform statistics.

```typescript
// Document: /stats/global
interface GlobalStatsDocument {
  totalProducts: number;
  totalUsers: number;
  totalSales: number;
  totalRevenue: number;
  categoryStats: {
    [category: string]: {
      productCount: number;
      totalSales: number;
      totalRevenue: number;
      averagePrice?: number;
    };
  };
  updatedAt: Timestamp;
}

// Document: /stats/user_{userId}
interface UserStatsDocument {
  userId: string;
  productsListed: number;
  productsActive: number;
  productsSold: number;
  productsViews: number;
  productsLikes: number;
  totalEarnings: number;
  averageSalePrice: number;
  updatedAt: Timestamp;
}
```

### Independent bank disputes — production preparation 2026-10-09

`transactions.bankDispute` and every nested field are server-only under the existing
transaction update allowlist (`updatedAt` only). No security-rule relaxation is
needed. `disputed`, `statusBeforeDispute`, `buyerReport` and return fields continue
to describe the commercial case. A bank opening preserves an already open commercial
case and captures its active state independently. Recognized bank wins retain a
commercial hold until `resolveDispute` dismisses that case. Historical reports on
an already completed/resolved transaction do not retain a new bank hold.

The bank freeze uses proved released sale funds (transaction markers or its
`funds_released` ledger, net of release-time debt repayment), never a payout estimate
or another sale's withdrawable credit. A full lost chargeback debits only this
sale's eligible pending/held movements plus its bank freeze, then withdrawable
balance and seller debt. It never consumes another sale's pending/held funds.
The gross exposure still includes debt paid down at original sale credit.
An already ledger-reconciled refund suppresses the second seller debit and buyer
wallet credit; this does not claim the asynchronous Stripe refund succeeded.

Only `won`, `lost`, `warning_closed` close the independent state. A lost event also
requires its amount to equal the known card portion of the purchase; partial or
unqualified losses retain the guard for operator reconciliation. Unknown outcomes,
foreign dossier closures, a new conflicting dossier, an unmatched PaymentIntent,
and a hold remaining during an already reconciled refund create deterministic
`admin_alerts` (`kind: bank_dispute_reconciliation_required`, `status: open`,
`context.reason`, `disputeId`, `paymentIntentId`, relevant amounts). These are human
review items; the automated failed-operation refund queue must not issue another
refund for them. A conflicting opening persists an open independent guard and cannot
be cleared by an unrelated closure or commercial admin dismissal.

`disputeId` is the active/legacy query projection: it is deleted after a recognized
closure only when no local reconciliation remains, and the immutable dossier identity remains in `bankDispute.id` for replay
protection. Legacy identifiers or positive legacy freezes without a recognized
`disputeClosedAt` + bank outcome remain blocked (a commercial `dismissed` outcome
is insufficient). No production backfill is executed in this package.

A buyer may still file `reportTransactionProblem` during an open bank case when the
original delivered purchase remains inside its commercial claim window. The report
is stored in `buyerReport`/`disputes` and atomically marks the independent bank
context as having an active commercial case; it issues no refund or fund release.
`requestRefund` and `requestReturn` guard their preconditions and transaction
reservations independently of the generic `disputed` flag. A bank opening during
an external return-label purchase blocks the commit and persists an operator alert
`return_label_commit_failed` with the purchased label identifiers for cancellation.

A full bank loss with an active commercial case creates an explicit operator alert
(`context.reason: commercial_after_loss`). `adminRefundTransaction`, invoked by an
admin on the already refunded and bank-closed purchase, resolves its open commercial
`disputes` documents with `resolution: refunded` without a new Stripe call or ledger
movement. Thus the commercial review stays explicit and has an available closure
path rather than permanently blocking account deletion.

The raw purchase-refund paths in `retryFailedOperations` also look up the purchase
by PaymentIntent and apply the independent bank guard. `waiting_bank` and
`waiting_bank_reconciliation` are metadata on a still-pending failed operation;
they do not consume the six infrastructure retry attempts or alter `lastTriedAt`.
A recognized WON permits the original repair to resume under its original key.
A lost chargeback resolves the queued card-refund repair without issuing another
refund only when `bankDispute.ledgerReconciledAt`, `refundedVia: chargeback` and
`status: refunded` prove the atomic local ledger reconciliation. Legacy loss without
that proof remains pending with a deterministic operator alert; it cannot trigger
another card refund. This package does not change the meaning of asynchronous
Stripe refund `pending`/`failed` states, which is addressed separately.

`job_locks/retryFailedOperations_cursor` is an internal, server-only queue cursor
(not a paid-operation lock): `{ lastPendingId: string, updatedAt: Timestamp }`.
The replay scheduler reads at most 100 pending operations per run, sorted by their
unique document ID with `startAfter(lastPendingId)`. It persists the last inspected
ID even when every operation waits on a bank or backoff. At the end it wraps on an
empty page, so long bank waits cannot indefinitely starve later repairs and new
legacy documents without creation timestamps remain reachable. Lots stay capped at
10 concurrent replays. With 100 waits followed by one due repair, that repair is
processed on the next scheduled run (no claim that the whole backlog was drained).


Independent review correction (2026-10-09, P01-R01/R02): an external bank
`state: closed` is not proof that a local reserve was settled.
`bankDispute.reconciliationRequired: true` keeps every financial guard active,
including refund, recourse, release, withdrawal and repair replay. For an already
refunded purchase with a recorded bank freeze, the full recorded `freezeCents`
and `disputeFreezeCents` remain unchanged and `disputeId` is retained. No wallet
release, debit or reconstructed amount is performed to guess which global bucket
the old charge-refund cascade consumed. The deterministic `refund_race_hold`
alert remains available for controlled reconciliation. Withdrawal also explicitly
queries the reconciliation flag to find older closed histories even if their
legacy projections were lost. Replays cannot clear this requirement.

Une clôture ne qualifie les nouvelles opérations qu'avec un ID `du_` natif,
une date Timestamp/Date positive non future et une issue connue. Marqueurs
legacy ou `reconciliationRequired` présents malformés restent bloquants ; seul
`false` explicite qualifie ce dernier. Lectures de dossier/rapport et nouvelles
instructions joignent la session/barrière au readset transactionnel, avec rôle
privé relu après les I/O. Les propres reçus et la récupération GET d'effets déjà
autorisés restent distincts de l'accès au corps privé et de nouvelles permissions.

### Production-readiness paquet 2 — remboursements achat durables (2026-10-09)

Le contrat ci-dessous remplace la limite async du paquet 1. Tous ces champs sont
**server-only**, rejetés par l’allowlist de mise à jour client existante.

- `transactions.refundBlocked: boolean` : projection active pour les gardes de
  retrait/libération/consommation/suppression du compte. Posée atomiquement avant
  Stripe ; false uniquement quand l’intention est soldée. Une clôture apparente
  de la commande ne permet pas d’ignorer cette obligation.
- `transactions.refund` : intention unique par vente, `intentId`, `attemptId`,
  `idempotencyKey`, `previousRefundIds[]`, `actor` (UID authentifié ou
  source/referenceId système), `source`, `reason`, `originalStatus`.
  Options figées : `paymentIntentId`, `currency: cad`, `capturedCardCents`,
  `cardAmountCents`, `walletAmountCents`, `sellerDebitCents`,
  `extraSellerDebitCents`, `relistArticle`. Tous les montants sont en cents.
- État local `state` : requested (réservation interne), pending, requires_action,
  unknown, succeeded, failed, canceled, reconciliation_required. État Stripe
  distinct `providerStatus`, `stripeRefundId`, `failureReason`,
  `nextActionType`, `lastEvidenceSource`.
- `bankWaiting: boolean`, `bankWaitingDisputeId: string|null` : attente temporaire
  d'un dossier bancaire open identifié, sans anomalie/legacy/conflit, sans succès
  externe ni fonds locaux déjà appliqués. Ne pose ni n'efface un marqueur bancaire
  de rapprochement. Après WON, la même intention reprend ses preuves/options via
  la file, même sans webhook suivant. Les gardes/holds restent actifs en attendant.
- `fundsAppliedAt` prouve l’application locale atomique, jamais une simple
  demande Stripe. `freezeCents` identifie uniquement le gel disponible de cette
  vente ; les débits pending/held utilisent ses marqueurs et son ledger.
  `cardConfirmedCents`, `cardSatisfiedVia`, `outstandingCardCents`,
  `localOutstandingWalletCents`, `localOutstandingSellerCents`,
  `duplicateCardSettlementCents` séparent somme carte confirmée, obligation carte
  et rapprochement local. Une perte bancaire partielle/non qualifiée ne vaut
  pas restitution intégrale. Une preuve full lost + montant capturé exact +
  ledgerReconciledAt peut couvrir la carte sans émettre un second refund.
- Réservations/reprises : `requestedAt/ requestedAtMs`, `externalAttemptedAtMs`,
  `leaseOwner/leaseUntilMs` (3 minutes), `updatedAt`. Une lease expirée ne prouve
  jamais l’absence d’effet Stripe. Recherche paginée avant reprise, aucun nouveau
  create aveugle après 23 heures d’incertitude.
- Surveillance : `watch`, `watchUntilMs`, `providerSucceededAtMs` ; attente sans
  échéance de succès, puis 31 jours depuis preuve succeeded effective. Vérification
  actuelle avant retrait de la surveillance. Échec tardif : fonds locaux conservés,
  dette carte/action rouverte, dossier commercial rouvert sans double mouvement.
- Réparation admin explicite : `authorizedRetryBy/authorizedRetryAt`,
  `priorFailureReason` ; nouvelle tentative uniquement sur proof failed/canceled
  actuel du même refund/PI/devise/montant. Les anciens IDs ne peuvent réouvrir
  la nouvelle tentative. `fundsAppliedAt` reste conservé.
- Legacy : `legacyApplied/legacyReconciliationRequired` dans l’intention et
  projections `refundLegacyReconciliationRequired/refundLegacyOperationId`.
  Les remboursements anciennement « refunded » sans preuves ne deviennent pas
  confirmés. Ledger local et Stripe doivent être prouvés ; options partielles
  inconnues restent au rapprochement manuel. Aucun nouveau débit/crédit deviné.
- Statut commande nouveau `refund_action_required` : obligation de remboursement
  ouverte, bloque article et suppression comme refund_in_progress. Le recours
  reste accessible dans sa fenêtre et le support conserve les identités PI/ledger.
- Ledger déterministe : refund_hold_<intentId>, refund_credit_<intentId>,
  refund_debit_<intentId>, avec refundIntentId ; sellerDebt si fonds insuffisants.
  Queue failed_operations/refund_<intentId> est créée dans la réservation atomique avant tout lookup/appel Stripe et conserve attempts et reprise durable.
  Les attentes refund/bank ne consomment pas les six essais infrastructure.
- `job_locks/purchaseRefundWatch_cursor.lastId` : rotation par ID, au plus 100
  refunds observés par passage de reconciliation (lots de 10).
- `transactions.capturedCardCents` conserve la capture du PI signé ; totalAmount
  reste en dollars. Surpaiement/annulation tardive utilisent la capture réelle.

K19 : les remboursements automatiques figent
`refund.automaticDecisionSource` (`purchase_automatic_refund_source_v1`,
document/sourceHash) dans la réservation de l'intention. Le journal privé
`purchase_automatic_refund_v1` distingue deux lignes immuables déterministes :
`reservation`, atomique avec intention/gel/file, puis `local_settlement`,
atomique avec le règlement local réel, le ledger et les avis. Une réservation
ou une issue prestataire inconnue n'est pas un remboursement confirmé. Les
critères historiques manquants restent explicitement inconnus ; aucun délai ou
motif n'est reconstruit après coup. Le recours `automated_decision_review` peut
référencer un Troc réel sans transaction d'achat : swapId et décision native
exacte id/révision/sourceHash, parent/participants/reçu de libération requalifiés
dans le même commit. Le reçu de support n'autorise aucun mouvement financier.

Clôture comptant distincte : `meetupNoShowResolution` contient outcome=buyer_upheld,
resolvedBy (UID admin), resolvedAt, note. closeMeetupNoShow exige dossier serveur
meetup_no_show concordant, aucun PI/wallet/credit vendeur ; annule l’accord et ferme
les litiges atomiquement sans argent. Les réservations d’articles d’autrui sont
préservées. L’action ne simule jamais un remboursement.

Limite conservée : la suppression historique du ledger lors de deleteUserAccount
reste un sujet du futur paquet privacy/comptabilité. Ce paquet bloque sa suppression
tant qu’une obligation financière indépendante demeure ; il ne refond pas la
politique de conservation.

### Paquet 2 — corrections de revue indépendante R01/R02/R03

Tous les nouveaux champs ci-dessous sont server-only. Aucune règle n'est élargie.
`failed_operations/capture_<sha256(PI effectivement reçu)>` conserve un dossier
déterministe, `type: payment_capture_reconciliation`, `status: pending`,
`actionRequired: true`, `attempts: 0`. L'identité de secours d'un payload malformé
est l'événement signé puis son empreinte ; elle ne sert jamais à rembourser.

`payload.signedEvidence` est la première preuve immuable ; `lastSignedEvidence`
conserve la dernière. Champs : `observedPaymentIntentId`, `candidateReference`,
`candidateTransactionId` (forme valide ou null), `originalPaymentIntentId`,
`currency`, `collectedAmountCents` (**amount_received** valide ou null),
`requestedAmountCents` (**amount**, prévu, séparé). `reasons[]/eventIds[]` sont
bornés et dédupliqués. Ni metadata ni montant prévu ne remplacent une preuve
d'encaissement et aucun champ/fonds de la commande originale n'est réattribué.

`currentProviderProof`, `providerLookupState: not_checked|verified|invalid|unavailable`,
`providerLookupError` sont rafraîchis uniquement par retrieve du PI reçu.
L'absence de montant collecté reste explicitement null. `lastProofCheckedBy`
(UID administrateur ou source scheduler)/`lastProofCheckedAt` attribuent la lecture.
La file conserve `waitingReason: waiting_payment_reconciliation`, sans consommer
les tentatives ni épuiser le dossier pour une attente opérateur/prestataire.
Les écritures/lectures indisponibles ne fabriquent pas de preuve ni de succès.

Découverte RN admin : lire la collection `failed_operations` existante, protégée
par `isAdmin()`, filtrer ce type/actionRequired, appeler
`inspectPaymentCaptureAnomaly({operationId})`. Réponse :
`{operationId,status:'pending',actionRequired:true,automaticRefundAllowed:false,
message,signedEvidence,currentProviderProof,providerLookupState}`. Aucun accès
public à `admin_alerts` n'est ajouté. Une inspection prouvée reste une obligation
de rapprochement ; aucune action livrée ne la marque réglée par simple booléen.
Les références/montants signés restent conservés tant que le traitement externe
contrôlé n'a pas un mécanisme de règlement qualifié.

### Admission 03A — fondations privées (2026-10-10)

Première `users/{uid}.dateOfBirth` : `recordSignupConsent` exclusivement, avec
CGU/confidentialité acceptées et âge d'inscription 16. Une naissance persistée
ne peut pas être remplacée par ce callable. `dateOfBirthVersion` est server-only
(1 à la première donnée, incrément lors d'une rectification administrative).
Les décisions de nouvel achat/vente utilisent 18 ans, calendrier civil Québec
(`America/Toronto`), sans dépendre du fuseau du runtime.

**Aucun document d'admission interne n'est lisible directement par son propriétaire.**
Firestore n'a pas d'ACL par champ. Les trois collections suivantes sont lisibles
par administrateur seulement et non inscriptibles par client, même administrateur.
Les callables propriétaires exposent exclusivement des DTO à allowlist.

- `eligibility_profiles/{uid}` : `version` entière serveur, `policyVersion`,
  `updatedAt`, `activityDeclaration` (`kind: personal|professional`, texte/version
  serveur, `actorUid`, `recordedAt`, `recordedAtMs`, `declarationVersion`). Déclaration
  indépendante des CGU/marketing, du forfait boutique et du type Stripe individual.
  `quebecResidenceDeclaration` conserve `version`, `country:CA`, `province:QC`,
  `accepted:boolean`, texte serveur, `ownerId`, `actorUid`,
  `source:owner_declaration`, `residenceVerified:false`, `recordedAt` et
  `recordedAtMs`. Ce choix privé explicite sert aux nouveaux Trocs ; une adresse
  d'achat ou Stripe ne le remplace pas. `accepted:false` retire la déclaration ;
  l'omission dans un ancien payload la préserve. Le nouvel input exige `expectedUid`.
  `activeReviews` contient des marqueurs `{scope,active}` ; `signals` contient
  `{scope,active,internalNote,actorUid,recordedAt}` et éventuellement trace de levée.
  Redéclaration propriétaire ne supprime ni signal ni demande/refus indépendant.
  `accountSecurityBarrier` est une barrière privée engagée avant révocation Auth.
  Sa présence, même malformée, bloque les nouvelles opérations commerciales,
  bancaires et de retrait ; lectures et effets historiques qualifiés restent
  disponibles. Aucun callable propriétaire de déclaration ou neutralisation ne
  la supprime. Les reçus `eligibility_audit/security_<hash(uid,requestId)>`
  distinguent blocage, révocation en attente/inconnue et révocation observée,
  sans certifier identité récupérée ou invalidation immédiate de tout jeton.
- `eligibility_requests/review_<sha256(uid,requestId)>` : `ownerId`, `kind:
  review|date_of_birth_correction`, `scope`, `status: submitted|needs_information|
  approved|rejected`, `version`, `policyVersion`, motif initial, précision owner,
  DOB proposée/source/copie typée privée, `priorReviewId`, dates création/mutation.
  Rectification : `receivedAtMs`, `receivedCivilDate`, `statutoryDueDate` civil +30,
  `statutoryResponseDays:30`, `deadlineCalendarPolicy`, `submittedAtMs` distinct.
  Précisions/replays/continuation liée ne réinitialisent pas réception/échéance.
  Réponse écrite conservée dans `ownerResponse` : texte, fondement/recours humains
  requis pour refus, date/civil serveur et `recordedAfterDueDate`. Ce sont des
  dates d'enregistrement, pas une preuve de communication externe. `internalNote`
  et `decidedBy` restent internes ; `ownerDecisionReason` est communicable.
- `eligibility_audit/<sha256(actorUid,requestId)>` : identité d'opération et hash
  de payload, action/acteur/propriétaire/politique/date, détails privés ; anciennes
  et nouvelles données lors d'une correction, décisions et signaux attribués.
  Clé identique + payload identique rejoue sans mouvement/version supplémentaire ;
  réutilisation contradictoire refusée. Aucun champ n'est écrit dans article,
  profil public, transaction, analytics ou notification.

Les scopes sont `buy`, `sell`, `new_paid_shipping`. Chaque DTO décision contient
`evaluationStage:foundations` : aucune permission de paiement/livraison n'est
produite par ce paquet. Expédition reste incomplète (`seller_qc_missing`) jusqu'à
03B. Une correction exige une donnée préexistante ; nombre/map/Timestamp malformés
sont copiés et comparés, jamais interprétés comme une naissance. Une vraie absence
initiale reste au signup légal. Décision admin ne déroge ni à l'âge, ni à l'activité
professionnelle, ni au Québec. Refus/examen continuent de bloquer leurs scopes ;
une clôture n'efface pas les autres demandes/signaux.

Contrat exact, limites légales/opérateur et recettes dans
`_audit-reports/production-readiness/PACKAGE_ELIGIBILITY_03A.md`.

#### Historique déclaratif vendeur et captures des nouveaux accords — K04

Les nouveaux événements `seller_activity_declaration_v1` dans `eligibility_audit` conservent commande exacte, texte/version acceptés, état résultant, acteur/propriétaire, date native et hashes, avec référence/hash de la déclaration précédente. `eligibility_profiles.activityDeclaration` conserve la référence originale courante ; une relecture rend le reçu original indépendamment de `currentEligibility` et des futures versions. Les anciens événements incomplets ne sont pas reconstruits depuis le profil courant.

Les commandes nouvelles portent une capture `seller_activity_admission_capture_v1` dans leur transaction native : réservation livraison, accord cash, proposition puis acceptation Troc séparées. Cette capture minimale lie accord/phase/source, activité déclarée et décision d’admission ; aucun DOB, statut bancaire ou note interne. Les lecteurs propriétaire/admin ne rendent que la partie du propriétaire du dossier natif. Quatre pages bornées distinctes exposent audit, ventes, Trocs initiés/reçus ; page filtrée vide avec curseur reste une suite possible. `legalEffectiveDate:null` et `legallyVerified:false` ne deviennent ni date d’effet juridique ni qualification fiscale annuelle. Prix, sources et empreintes historiques demeurent inchangés.

#### Correctif admission03A V2 — identité native privée

`eligibility_requests.nativeSourceDocumentVersion` (server-only) contient
seconds/nanoseconds du `updateTime` public du snapshot user, seulement pour une
correction de DOB contenant une DocumentReference. La copie DTO porte
`context:sdk_observed_reference` : le SDK installé peut normaliser une référence
croisée sur la base lectrice ; le contexte d'origine n'est pas prétendu récupéré.
Même révision et identité native sont exigées à la décision ; une simple édition
du profil peut imposer nouvel examen dans ce cas prudent. Garde non étendue à
DOB ISO courante ni finance. Timestamp : copie ISO conservée, identité/comparaison
privées en seconds/nanoseconds exacts. Contrat PACKAGE_ELIGIBILITY_03A_V2_CONTRACT.md.

### Admission03B1 — annonces et accords de rencontre

Toutes les autorisations nouvelles lisent users+eligibility_profiles actuels
transactionnellement. Achat18,vente18+déclaration personnelle ; rôle depuis article
et participants réels. Aucun DOB/adresse légale/fingerprint de profil privé ajouté
aux articles ou messages. Aucun Québec imposé à la rencontre, aucun changement
signup16/Troc/flags/forfaits/argent.

- `articles.publicationRequestHash` et `publicationRequestVersion:1` : reçu
  serveur de l'intention de publication (champs d'entrée commerciaux sélectionnés,
  pas profil/DOB). UID+clientRequestId produisent l'ID ; hash vérifié pour le rejeu
  exact, lequel retourne ID sans nouvelle publication. Sans ancien fingerprint,
  ouvrir/consulter l'article appartenant au demandeur ; ne pas fabriquer adoption.
  Préflight avant brand/médias et relecture d'admission au commit même sans ID client.
- `meetup_offer_requests.inputHash,articleId,buyerId,sellerId` : identité serveur
  d'entrée et contexte article/participants ; chatId,senderId,messageId préservés.
  Rejeu exact renvoie message existant, payload/contexte contradictoire refusé.
  Ancien reçu sans hash → consultation de son message vérifié owner/chat, pas
  succès d'une nouvelle proposition. Termes pending strictement identiques peuvent
  enregistrer un alias sans nouveau message/accord ; temps et lieu comparés.
- Acceptation nouvelle, y compris adoption d'un unique legacy pending non lié,
  vérifie buy/sell actuels. Legacy correspond chat/article/parties/amount/lieu,
  statut meetup_pending, sans offerMessageId et sans marqueur financier ambigu.
  Une présence d'ID n'exempte jamais la première acceptation bilatérale. Exact
  accepted+transaction liée cohérente → replay sans nouvelles preuves/mutations.
  Liens article non résolus, autre accord ou obligation bank/refund indépendante
  empêchent une nouvelle réservation/remise en vente. Aucun ancien ledger effacé.

Erreurs owner détaillées via raisons/messages/actions de rectification/examen ;
contrepartie : seulement counterparty_unavailable générique. Confirmation/clôture/
no-show/refus et désactivation seule restent distincts des nouvelles opérations,
sous les gardes d'ownership/réservation existantes. Médias préparés hors transaction
peuvent rester non référencés après course/replay ; logs de compte/stage, aucun
nettoyage aveugle. Pas de garantie transactionnelle Firestore+Storage.

Contrat/endpoints réels et limites restantes03B2/03B3/RN :
`_audit-reports/production-readiness/PACKAGE_ELIGIBILITY_03B1_CONTRACT.md`.

### Admission 03B2 — compte Custom, observation Québec et reprise privée

`eligibility_profiles/{uid}.sellerQuebecEvidence` est exclusivement produit par
le serveur depuis un compte Stripe effectivement reçu ou récupéré. Il reste
admin-readable/server-write-only comme le reste du document ; le propriétaire
reçoit une allowlist callable. Champs : `schemaVersion:1`, `ownerId`, `accountId`,
`source:stripe_account_observed`, `residenceVerified:false`, `country`, `province`,
`address` normalisée privée ou null, `addressCountryProvenance`,
`providerDateOfBirth` et `profileDateOfBirth` ISO ou null, `status:observed|
review_required`, `reasons[]`, `identityHash`, `observedAt`, `observedAtMs`,
`lastCheckedAtMs` ; invalidation : `invalidatedAtMs`. Aucune résidence réelle ou
vérification légale de vente particulière n'est certifiée. Le pays du compte ne
remplace pas un pays absent de l'adresse individuelle observée : ce dernier reste
null/`missing_or_invalid` et ne donne pas d'admission.

Une observation identique conserve `version` et sa première date ; un changement
d'identité ou une invalidation incrémente `version`. `activityDeclaration`,
`signals`, `activeReviews` et notes internes sont conservés. Un `account.updated`
signé invalide l'observation existante et écrit l'état technique sous transaction
après relecture de la liaison actuelle ; son payload ne réaccorde pas l'admission.
Une récupération courante via callable peut rafraîchir l'observation. Le scope
`new_paid_shipping` conserve `evaluationStage:foundations`, sans permission de
dernier paiement/devis/étiquette ; les opérations 03B3 doivent relire les sources.

`eligibility_profiles/{uid}.connectOperation` est une intention de création
persistée atomiquement avant Stripe : `id` UUID serveur, `state:creating|unknown|
rejected|created|linked`, `providerId` effectivement connu ou null, `startedAtMs`,
`authorizedVersion`, `requestHash`, `idempotencyKey`, `bankLast4`,
`completedAtMs` après liaison et `providerRejection` qualifiée ou null après
exception. Le numéro bancaire complet n'y est pas stocké. La réservation conserve
`users.stripeAccountCreationStartedAt` server-only ; la liaison connue le retire
et écrit `stripeAccountCreatedAt`/les projections techniques existantes, jamais
une nouvelle naissance. La première DOB reste `recordSignupConsent` et toute
correction suit 03A. Aucun compte de remplacement automatique après une réponse
inconnue, une ancienne réservation sans intention ou un identifiant ambigu.
Récupération positive : ID privé connu ou correspondance exacte des deux metadata
serveur (`firebaseUserId`, `secondConnectOperationId`), bornée à 3 pages de 100
comptes. Absence/erreur/plafond ne prouve jamais l'absence d'effet externe.
Une erreur de validation prestataire étroitement qualifiée devient `rejected`,
avec action support ; ce lot ne fournit pas de reset/recréation administratif.

La gestion bancaire propriétaire conserve ses intentions dans
`eligibility_audit/bank_{sha256(ownerId,requestId)}` et sa réservation dans
`eligibility_profiles/{uid}.bankOperation`. Les modes `replace`, `declare_current`,
`select_existing` et `delete_existing` lient le compte Connect et le `bankAccountId`
exact ; les déclarations antérieures ne sont réutilisées qu’avec une source native
complète pour cette même banque. La suppression passe de `creating` à `deleting`
avant l’effet Stripe ; `deleteAuthorizedAt`, puis `deletion_unknown` si nécessaire,
permettent une reprise par lecture seule. `deletionObserved` et `completedAt`
documentent le résultat sans modifier l’identité Connect, les retraits historiques
ou la banque courante. Le champ privé `bankWithdrawalRevision` du même profil est
incrémenté transactionnellement lors d’un nouveau débit et avant les autorisations
de transfert/virement ; les changements bancaires écrivent cette même source et
refusent toute dépendance de retrait encore ouverte. Il s’agit d’une barrière de
concurrence, pas d’un solde ou d’une preuve bancaire. L’inventaire de gestion est
relu auprès de Stripe et ne persiste aucun numéro de compte ou de transit complet.

Les alias `sellerQuebecEvidence` et `connectOperation` dans `users`, ainsi que
`stripeAccountCreationStartedAt`, sont interdits aux clients en création et
modification (même client administrateur). Ils ne sont pas des sources d'admission
publiques. Aucun nouveau champ DOB/adresse/preuve n'est ajouté aux articles,
transactions, analytics ou notifications. Aucun nouvel index composite : lectures
de documents owner privés, et query webhook existante `users.stripeAccountId ==`.

Adresses partagées : normalisation CA strictement typée et cohérence province /
préfixe postal, sans rue fabriquée depuis la ville d'un article. Pays absent admis
uniquement dans le contexte domestique historique ; pays explicite incohérent ou
non-string refusé. Le helper reste canadien pour les retours/obligations existantes
hors Québec ; les nouvelles créations Custom/estimations payées appliquent Québec
séparément. L'estimation `/v1/rates/estimate` n'enregistre ni transaction, ni devis
payable, ni étiquette : villes/provinces/poids réels manquants retournent
`estimate_information_required`, tarifs estimatifs ont `rateId:null` et
`usableForPurchase:false`. Le contrat exact et les limites opérateur/prestataire
figurent dans `PACKAGE_ELIGIBILITY_03B2_CONTRACT.md`.

#### Admission 03B2 V2 — barrière causale des observations

`eligibility_profiles/{uid}.connectObservationRevision` est un compteur entier
privé server-only, distinct de `version` et de la contre-version DOB/déclaration.
Absent historiquement : révision de départ 0, sans migration ni preuve/admission
par défaut. Présent : entier sûr non négatif, borné avant incrément ; valeur
malformée → examen, jamais remise automatique à zéro. Aucun champ équivalent
n'est produit dans `users`, article, transaction, DTO owner ou notification.
Protection existante de toute la collection : client, même admin, ne peut écrire ;
lecture directe admin seulement, DTO owner à allowlist inchangé. Pas de nouvelle
règle, collection, query composite ou index pour ce correctif.

Le serveur capture UID/révision avant create/retrieve/list hors transaction puis
compare la barrière à la relecture du commit. Chaque invalidation pertinente la
fait avancer, même preuve absente ou déjà `review_required`. Chaque observation
commitée l'incrémente aussi, même identité DOB/adresse inchangée, pour protéger les
projections techniques différentes. Réponse obsolète : `aborted`,
`reason:connect_observation_stale`, `action:getStripeAccountStatus`, aucune écriture
de preuve/projection issue de cette réponse. Premier commit valide gagne entre
observations concurrentes ; actualisation nécessaire pour le perdant, sans ordre
temporel prestataire inventé. L'ID réellement créé reste persisté avant ce guard.
DOB, activité, signaux et examens sont relus et gardent leur propre qualification,
sans comparaison globale de version métier comme motif de réponse obsolète.
Contrat/FAIL initial/conservation : `PACKAGE_ELIGIBILITY_03B2_V2_CONTRACT.md` et
`PACKAGE_ELIGIBILITY_03B2_V2.md`.

## Admission 03B3a — devis et réservation expédiée (serveur seulement)

`shipping_packages/{articleId}` est privé : client admin en lecture, aucun client en écriture ; les propriétaires utilisent `getArticleShippingParcel` et `setArticleShippingParcel`. Le document contient `schemaVersion:1`, `articleId`, `ownerId`, `version` entier sûr >=1, `parcel.weight:{value:number>0,unit:'kilogram'}`, `parcel.dimensions:{length,width,height:number>0,unit:'centimeter'}`, `source:'seller_declared'`, `measurementVerified:false`, `declaredBy`, `declaredAt`, `requestId`, `previousVersion`. Les mesures sont déclarées, sans certification ni conversion de S/M/L. Seule l’absence réelle du document permet la genèse depuis `expectedVersion:0`. Source existante malformée, version absente/null/épuisée : examen, jamais reset ou normalisation ; aucun mécanisme de réparation admin automatique livré ici. Le getter reste accessible à son propriétaire sans admission nouvelle ni flags. La mutation relit article/owner, admission vendeur actuelle, réservations et contre-version avant write ; elle n’altère ni annonce, ni commandes anciennes, ni fonds. Un reçu exact du dernier réglage peut être relu sans nouvelle mutation, après qualification de sa source.

Extension automatique : une nouvelle préparation explicite peut fournir `profileSize:'small'|'medium'|'large'` à la place de `parcel` (les deux ensemble sont refusés). Le serveur calcule le profil `profileVersion:1`, conserve `source:'automatic_profile'`, `measurementVerified:false`, `selectedBy` et `selectedAt` ; les mesures restent des estimations applicatives, sans précision ou contrat transporteur garanti. Les poids/dimensions v1 sont respectivement 0,5 kg/30×22×6 cm, 1 kg/40×30×12 cm et 2 kg/50×40×20 cm. Le GET ne crée ni ne modifie de document : il ajoute une `recommendation` selon `articles.packageSize`, à défaut la catégorie ou un grand format conservateur. Les états DTO sont `missing`, `declared` (historique) et `estimated` (automatique). Le devis privé capture `source.parcelSource:{source,profileSize,profileVersion}` uniquement pour les profils automatiques ; la commande fige `shippingSnapshot.measurementSource`, `profileSize`, `profileVersion` et les valeurs exactes du colis. Les empreintes historiques déclarées restent inchangées ; les nouvelles empreintes de contrat lient cette provenance. La projection de reprise financière conserve son algorithme exact : elle lie déjà les valeurs physiques, la source, la version du colis et `purchasePolicy.sourceHash`. Les réservations, étiquettes et retours relisent la capture sans recalculer depuis une annonce ou un catalogue de profils modifiés.

Estimation V2 (29 octobre 2026) : le GET recommande désormais une famille depuis le chemin canonique complet de la catégorie finale, via `shared/automaticShippingEstimate.ts`, sans laisser un ancien `packageSize` IA/brouillon choisir la géométrie. La préparation V2 envoie `profileVersion:2`, `profileFamily` et `profileSize` compatibles, sans mesures ; le serveur valide la famille actuelle puis calcule les valeurs applicatives. Le document, `source.parcelSource` du devis et `shippingSnapshot` de la commande conservent `profileFamily` avec version 2. Une famille V2 devenue inadaptée à la catégorie est refusée pour un nouveau devis, sans mutation silencieuse ; les reprises exactes, anciennes commandes, étiquettes et retours restent liés à leur propre capture V1/V2. Le corps du setter est strict (identifiants, contre-version, `expectedUid` éventuel et une seule variante colis) ; aucune propriété client ne peut déclarer une mesure vérifiée. Famille inconnue et valeurs de départ restent des estimations explicites, sans calibration attestée, garantie de masse/volume ou tarif transporteur final.

`shipping_quotes/{uuid serveur}` est privé/admin-readable et server-write-only. Il contient `schemaVersion:1`, `ownerId` acheteur, `articleId`, `sellerId`, `state:'ready'|'claimed'`, `source` canonique privé (origin/destination/parcel/version/item/prices/hash et barrière d’observation), `rates:{shipmentId,providerCreatedAt,rates}`, `createdAt`. `source.hash` compare uniquement côté serveur les données et versions ayant produit le devis, y compris les empreintes d’admission privées. Seule son empreinte opaque peut être liée à l’achat par `purchasePolicy.sourceHash` ; les sources privées brutes ne sont pas copiées dans les DTO, notifications ou analytics. Les tarifs complets comprennent quatre composantes en cents CAD (`shipping`,`insurance`,`confirmation`,`other`), identité fournisseur réelle, validation sans erreur/avertissement ; une composante absente est inconnue. Le claim atomique ajoute `transactionId`, `acceptedRateId`, `acceptedTotal` en dollars, `acceptedAt`. Aucun TTL prestataire supposé, aucun ordre/réservation/secret/débit au devis.

Offres postales : un message serveur porte `offer.protocol=shipping_offer_v1`, `deliveryType=shipping`, `offerId`, article/acheteur/vendeur exacts, montant en dollars CAD, `listingSourceHash`, état, dates natives et `inputHash` de la requête. `shipping_offer_threads/{SHA256([articleId,buyerId])}` sérialise le message courant entre conversations ; aucune écriture client n’est autorisée. La proposition expire après 48 h ; l’acceptation fixe une nouvelle fenêtre de 48 h sans réserver l’article. Seul le destinataire peut accepter/refuser ; une contre-offre remplace le message précédent.

Le devis négocié capture `source.shippingOffer` (`shipping_price_agreement_v1`, message/chat/article/parties, `amountCents`, empreinte annonce, instants d’acceptation/expiration, `hash`). Cette empreinte étend `source.hash` et donc la politique d’achat déjà protégée ; les empreintes historiques sans accord restent identiques. La réservation écrit ensemble `transactions.shippingOffer`, `offerMessageId`, `chatId`, le verrou du stock et `messages.offer.transactionId/consumedAt`. L’autorisation financière relit ce même message consommé, les copies devis/commande et le prix exact ; une offre meetup ou un montant client libre ne peut jamais autoriser une réduction postale. L’expiration pré-réservation n’annule pas une commande déjà engagée.

Push Dev : `dev_push_destinations/{uid}/devices/{installationId}`, `dev_push_installations/{installationId}` et `dev_push_tokens/{tokenHash}` sont privés et alimentés par callable. Leur association courante lie propriétaire, génération et binding aléatoire ; révocation et résultat prestataire tardif ne suppriment jamais la destination d’un autre compte. Les noms natifs/EAS sont des déclarations client contrôlées, pas une attestation OS. L’environnement Dev ignore `users.expoPushTokens/fcmTokens`. Tickets dans `dev_expo_push_receipts`, résultats sobres séparés dans `dev_expo_push_receipt_results`, sans certifier affichage ou lecture.

Une nouvelle `transactions/{id}` expédiée depuis ce contrat conserve les champs monétaires historiques en dollars : amount/serviceFee/taxTotal/buyerFeeReduction/shippingCost/totalAmount/sellerPayout, `currency:'CAD'`, `status:'pending_payment'`, `deliveryType:'shipping'`, adresses destinataire canoniques, `shipEngineRateId`, `shippingQuoteId`, `articleSnapshot` public sélectionné, `shippingSnapshot`. Ce dernier conserve origin/destination, colis/version/provenance déclarée, composantes et identité du tarif complet CAD, shipmentId fournisseur, quotedAt/validatedAt/providerCreatedAt et acteur acceptant le prix. Il est lisible uniquement par les participants/admin selon les règles transactions existantes. Aucune DOB, adresse de preuve Stripe ou empreinte d’admission dans ces projections. L’origine postale et ses contacts sont les seules données de vendeur nécessaires au contrat expédié autorisé ; ils n’apparaissent pas dans le DTO du devis. `articles.activeTransactionId` et `isSold` sont verrouillés au même commit que l’ordre et le claim du devis.

Requêtes nouvelles : lectures par ID pour article/user/profil/colis/devis/commande/liaison ; égalité seule `transactions.articleId==articleId` et `shops.ownerId==sellerId` sans orderBy, couvertes par index simples automatiques sous configuration Standard habituelle. Aucun composite ni fieldOverride ajouté ; configuration simple production non vérifiée. Le scan d’historique d’un article n’est pas paginé dans ce lot ; son coût peut croître avec le nombre de relistings et exige une projection bornée ultérieure si nécessaire.

Le GET `/v1/shipments/{shipmentId}/rates` relit les tarifs stockés de l’expédition initiale. Il prouve une réponse cohérente avec le prix accepté, pas une retarification live, une expiration connue ou une garantie d’achat de label. Les DTO annoncent `expirationKnown:false`, `providerFreshnessVerified:false`, `labelPurchaseGuaranteed:false`. Les contrôles de solde, carte/mixte, secrets déjà émis et consommation de ce snapshot par le fulfillment restent 03B3b/c ou une revue dédiée ; les corps financiers historiques sont préservés.

### Qualification requête 03B3a V2

Le nouvel adaptateur payable lit GET/v1/carriers puis poste rate_options.carrier_ids non vide, depuis les IDs réellement retournés et dédupliqués. Statut de connexion facultatif absent ou approved ; pending_approval/inconnu exclus. Liste absente/malformée/vide/erreur : pas de POST, pas de quote prêt ni réservation. Rates hors sélection ne deviennent pas admissibles. Ceci choisit la forme explicite demandée par le guide rates ; l'OpenAPI officiel déprécié rend rate_options facultatif, divergence documentée sans refus réel prestataire allégué. Les corps getRates historiques restent exacts. Connections qualifiées au devis, pas funding/disponibilité/label garantis. Aucune nouvelle query/index/règle. Miroir flags client littéralement OFF et défaut serveur OFF conservés, environnement production non inspecté.

### Qualification de réponse 03B3a V3 (privée)

Les nouvelles réservations requièrent `shipping_quotes.rates.qualification.version:3`. Ce champ serveur privé contient `contexts` (racine et groupe réellement retournés : identités, origine/destination normalisées, colis, poids total et indicateur retour, avec état absent/null/provided), et `details` (rateId, état absent/null/empty/provided, ventilation type/cents CAD signés explicitement reçus). Les champs de contexte présents sont confrontés aux sources de la requête ; vide/malformé/contradictoire ne devient pas preuve d'absence. Aucune adresse physique, mesure ou résidence certifiée. `carrier_weight`, poids éventuellement volumétrique du transporteur, n'est pas une mesure déclarée ni un remplacement de celle-ci. Le prix reste exclusivement la somme des quatre composantes CAD ; la ventilation optionnelle doit concorder, sans double comptage ou inversion d'une remise selon son libellé.

Au claim, `acceptedQualification` conserve séparément la preuve normalisée du GET. Une absence dans le GET ne supprime pas la preuve du POST conservée dans `rates.qualification`. Les deux champs restent dans la collection privée/admin-readable, sans copie supplémentaire dans le DTO buyer, article, ordre, analytics ou notification. La réponse du devis projette une allowlist des tarifs ; les descriptions/memos fournisseur ne sont pas conservés. Nouveau ready sans qualification V3 cohérente : `aborted/shipping_quote_stale`, nouveau devis explicite, aucun reset/adoption/réparation automatique. Receipt claimed exact et consultation existingOrderOnly restent indépendants de cette qualification pour les engagements antérieurs. Aucun changement de règle/index/query, de statut financier ou de document ancien par cette reprise. Voir `PACKAGE_ELIGIBILITY_03B3A_V3_CONTRACT.md` et le rapport V3 ; gels V1/V2/FAIL conservés.

### Admission 03B3b — preuve d'un débit portefeuille (serveur seulement)

`transactions.walletPayment` est posé atomiquement avec le débit du wallet,
le ledger `purchase_debit` et `paid`, uniquement par `payWithWallet` :
`{schemaVersion:1,state:'committed',actorUid,amountCents,ledgerId,currency:'CAD',
quoteId,rateId,committedAt:Timestamp}`. Ces IDs lient la commande, le prix accepté
et le mouvement réel ; le marqueur seul ne prouve jamais le débit. La lecture
contrôle le ledger du buyer réel et les termes, puis rend un reçu en lecture
seule. Aucun DOB, hash d'admission, adresse prestataire, signal ou note privée
n'est copié ici. Les participants peuvent consulter ce dossier sous les règles
existantes ; toute écriture cliente du proof/ledger reste refusée.

`labelCreationPending:true` existe déjà ; il est désormais posé dans le même
commit de débit, avant analytics/label, pour que le scheduler existant puisse
retrouver un `paid` après interruption. Cela ne prouve pas l'exécution du retry,
la validité future du tarif ou l'achat d'un label. Aucun snapshot ancien/fonds
ou règle/index n'est réécrit. Les anciens reçus avec ledger natif qualifié n'ont
pas besoin de ce nouveau proof ; les sources ambiguës restent à rapprocher.

Le nouveau lecteur utilise `wallets/{buyer}/ledger where transactionId==id
limit(101)` (égalité simple), l'historique de l'article et les shops avec les
égalités déjà employées par le devis, ainsi que les cinq queries du retrait
(sellerId + disputed/disputeId/disputeFreezeCents/bankDispute.reconciliationRequired/
refundBlocked, limit201). Pas de nouvelle collection/index. Les bornes saturées
refusent un nouveau débit sans prétendre qu'un mouvement est absent ; les
preuves natives/transactions doivent être conservées pour l'examen. Aucun
traitement de purge, migration ou rapprochement automatique n'est ajouté.

### Admission 03B3c — autorisation Stripe manuelle privée (10 octobre 2026)

`stripe_checkout_intents/{transactionId}` est une collection **server-write / admin-readable**.
Le propriétaire utilise `createStripeCheckout`, `confirmStripeCheckout` et
`retireLegacyStripeCheckout` ; le DTO est une allowlist, sans DOB, preuve Québec,
adresse prestataire, hash de source ni note interne. Aucun client, même admin,
ne peut écrire/effacer cette preuve. Aucun clientSecret n'y est stocké.

Le protocole `server_manual_v1` conserve : schemaVersion=1, intentId/ownerId/
transactionId/sellerId, version positive sûre, quoteId/rateId, totalCents/
walletCents/cardCents/currency=CAD, sourceHash et sourceRevision privés,
createdAt/updatedAt, state (creating/prepared/confirming/unknown/action_required
ou statut Stripe reconnu), vrai paymentIntentId lorsqu'il est connu,
confirmAttemptId/authorizedAt/authorizedSourceHash/authorizedObservationRevision,
paymentMethodId (identité, pas données de carte), walletLedgerId/
walletCommittedAt pour le seul débit mixte, preuves receivedCents/capturableCents,
unknownOperation/reason/recoveredAt/rejectedAt le cas échéant. La version est une
contre-version locale, ni horloge ni statut du prestataire. La préparation ne
débite pas le wallet ; seule l'autorisation confirm atomique écrit purchase_debit.
Une lease/24h/absence dans un scan ne prouve jamais l'absence d'effet externe.

Le protocole `legacy_retirement_v1` conserve décision buyer, vrai PI,
retireOperationId/expectedRetirementVersion/authorizedAt, walletCents/cardCents/
currency et, seulement après canceled observé et commit lié,
cardCapabilityNeutralized/receivedCents=0/capturableCents=0/completedAt.
Carte seule : annulation de l'ordre et release du seul article lié. Mixte :
wallet/ledger/markers/réservation restent intacts, obligation de restitution
ouverte ; cette preuve n'est ni paiement ni remboursement. Anomalies et
inconnus demeurent visibles dans cette collection privée, sans file retry
infrastructure épuisée ni booléen admin transformé en règlement.

Portée opérateur J03/J04 : `relationshipRetirement` conserve le tuple exact
`actorId/requestId/command/payloadHash/operationId`, la source locale qualifiée,
les dates natives et l'état `authorized|unknown|received`. `received` exige le
PI exact observé annulé, sans montant reçu/capturable ; cette preuve ne modifie
ni commande, réservation, stock, wallet ou remboursement. Les propres reçus
exacts précèdent une nouvelle admission. `relationshipRetirementFences` est une
map bornée à 32 clés `sha(actorId,requestId)` : commande/hash/acteur/date,
`state:not_executed`, `authorizedAt:null`, sans résultat financier. La clôture
documentaire exige l'administrateur actuel et sa décision historique native
sur cet achat ; elle ne nécessite pas de conserver une restriction levée.
Autorisation et clôture relisent atomiquement la même preuve : une clôture
empêche l'exécution tardive du même tuple, jamais une intention distincte.
Une intention déjà autorisée ou inconnue ne devient pas non exécutée.
Ces deux champs sont exclus de leur propre hash causal et restent server-only.
Les réponses effectivement reçues après un POST sont conservées avant la
requalification interactive : observation native du même journal autorisé, ou
slot borné `lateResponseEvidence` avec fence et cause si la source a changé.
Aucun clientSecret ni métadonnée libre n'est copié. Une liaison devenue
étrangère n'est pas écrasée ; la preuve n'autorise ni règlement de cette commande
ni second POST. La restitution d'un secret/DTO privé exige toujours la session
courante, et les reprises incertaines restent en GET seul.
Lectures via `readSupportRequests` ; mutation opt-in `retireLegacyStripeCheckout`
avec `mode:execute|neutralize` explicite, sans `transactionId` racine. L'absence
d'accord natif ancien ou de provenance prestataire reste inconnue, sans migration
de consentement ni qualification fiscale ou juridique inventée.

`transactions.stripeCheckoutProtocol='server_manual_v1'` est serveur seulement.
Les traces existantes serviceFeePercent/walletCheckoutAttemptId/
walletCheckoutOutcome sont écrites avant toute création externe ; le portefeuille
accepté détecte déjà cette préparation. stripePaymentIntentId/
stripeCheckoutCreatedAt sont liés au vrai résultat reçu. Lors du premier confirm
mixte, walletAmountUsed/paidVia=wallet_and_card/walletDebitReservedAt décrivent
le débit réellement enregistré. Aucun nouveau statut de commande, snapshot
historique réécrit, capture policy, taxes, migration ou transfert n'est ajouté.
Le webhook Stripe reste l'autorité paid/fulfillment ; une réponse confirm ne
rend jamais l'ordre livrable.

Lectures : document d'intention par ID ; ledger buyer par transactionId limit101 ;
lecteur réservé partagé avec le wallet (article, quote, user/profil, colis,
historique article et shops) ; cinq requêtes seller financières limit201 seulement
lors d'un **nouveau** débit mixte. Aucun composite additionnel nécessaire au shape
livré. Admin : direct ID ou simple égalité state avec ordre ID implicite ; aucun
ordre chronologique supplémentaire livré. Presence/index configuration production
non inspectée. La récupération Stripe est une liste bornée à cinq pages/500 PI,
avec identité metadata et preuve complète ; manque/ambiguïté/saturation ne crée
jamais un PI de remplacement.


## Checkpoint technique des échéances de support

`job_locks/support_deadline_monitor_cursor` est réservé au moniteur non financier de la Cloud Function existante `retentionPurge` : continuation par ID, borne haute et numéro de passe, bail et CAS, agrégats de progression. Pages de 200, au plus 2 000 sources par passage. Il n’accorde aucun accès client, ne modifie pas les tickets, leurs horloges ou leur conservation et ne certifie ni couverture globale, réponse juridique ni disponibilité humaine. Aucun nouvel index ou règle ; les SDK clients restent sans permission sur ce chemin.


## Exceptional restitution and legal review additions — 25 October 2026

Exceptional restitution marks the exact native transaction, withdrawal or wallet and may add a closure marker on `eligibility_profiles`. `wallets/{uid}/ledger` adds immutable `exceptional_restitution_reserve` and `exceptional_restitution_void`; `platform_ledger` records the separate liability and hashed manual-bank-reference uniqueness. Historical original refunds, withdrawals, debt and tax facts are not overwritten. The I17 source catalogue includes both new private child groups, including orphan children; source qualification is distinct from external-bank cash verification. Source hashes and the writer catalogue must be reviewed with each financial change.

`exceptional_compensation_credit` is a distinct Seconde-funded wallet credit: current seller debt is offset first and any remainder enters available balance. Its native commit date, case, command, platform liability and wallet ledger are joined by I17; it does not reassign historical debt repayments. The existing deadline monitor also uses `job_locks/bank_deadline_monitor_cursor`; a short native bank deadline is relayed before the observing handler acknowledges it.

New legal proof objects under `private-support-evidence/` have create-only native generations, no download token and a verified temporary hold for V2. Their evidence records and all legal V2 namespaces belong to the retention inventory; no automatic hold release or destruction is introduced. A current technical admin role does not establish external legal power, corporate delegation, delivery or recipient acknowledgment.


## Coexistence phase 1 — 25 novembre 2026

Les nouveaux messages de proposition portent phase1Contract=phase1_v2 et, dans le profil initial local, phase1Source={protocol:phase1_message_origin_v1,installationId,epoch}. Ce marqueur ne qualifie aucun rapprochement financier. meetup_offer_requests/{messageId} conserve le reçu producteur natif (participants, article, inputHash, createdAt). Le job dédié relit les deux documents en transaction, exige une proposition pending jamais acceptée et son échéance native maximale de 48 h. Les jobs historiques ignorent la présence du marqueur avant toute mutation.

Une ancienne suppression admise écrit eligibility_profiles/{uid}.legacyDeletionFence avant le premier effacement, après ses scans bornés. Sa présence, même invalide, ferme les sessions privées et SDK ; la clôture ne supprime pas ce verrou. Ce protocole de coexistence n'autorise aucune nouvelle destruction globale ni rapprochement de fonds.

## Effacement phase 1 — population de la nouvelle version

`account_erasure_commands/{sha256(protocol,uid,requestId)}` est privé serveur. Il conserve une intention confirmée, source Auth native (birth/bindings), acteur primaire ou preuve Apple Web dédiée, contrôle indépendant et politique, version/curseur et effets. La clé d’observation reste uniquement client : le serveur stocke son SHA256 contextualisé. Aucun code Apple, jeton OAuth/Firebase ni clé API n’y est enregistré. `internal/inspection` porte les pages et leur invalidation causale ; `effects` les générations GCS préparées/absences constatées ; `processors`, `retained`, `media_reviews`, `operator_commands`, `observation_rotations`, `apple_attempts` et `late_storage_receipts` sont des sous-collections privées. Une intention en revue n’est jamais une suppression terminée.

`eligibility_profiles/{uid}.accountErasureRequest` ferme les nouvelles acquisitions après réception autorisée. L’admission d’effacement écrit atomiquement `accountErasureFence` et neutralise le profil public ; la présence du champ, même invalide/null, ferme SDK, sessions privées, contreparties et nouvelles projections. La pause demeure un état distinct qui permet la résolution des obligations. Après absence Auth constatée, le profil privé est minimisé aux verrous/références de la clôture ; DOB/résidence/déclarations ordinaires sont retirées.

`account_erasure_observation_rotations/{sha256(protocol,recoveryId,newKey)}` est un alias privé de suivi minimal, créé dans le même commit que rotation propriétaire. Il permet de retrouver le même ordre sans Auth après réponse perdue, ne donne aucune permission d’effacement et ne divulgue ni montant ni contrat. Les positions cron sont sous `account_erasure_worker_positions`.

Les nouvelles photos chat utilisent `chat_images/{chatId}/{senderUid}/{fileName}` et leurs références message `image.generation` / `image.thumbnailGeneration` sont des chaînes décimales. Storage interdit de créer dans le segment d’un autre membre et interdit les anciens chemins d’upload. Le worker énumère uniquement le segment de l’uploader et supprime chaque génération exacte ; il ne purge jamais un préfixe chat partagé. Le finalizer conserve une continuation après disparition Auth pour les uploads déjà admis.

`article_privacy_evidence/{articleId}` peut passer au schéma 2 `article_privacy_disposed_v1` après disposition sans contrat : aucun original/texte/photo, seulement références du retrait et hashes de preuve. Les contrats locaux réellement conclus conservent leur témoin natif exact et des copies privées sous une finalité et revue bornées ; aucune ligne financière n’est adoptée ou modifiée. Le reçu GCS de qualification lie inventaire, digests source/règles, contrôle/génération, population post-cutoff et fermeture de collecte ; l’admission et la qualification finale du finalizer sont séparées. Les comptes antérieurs au cutoff ne bénéficient pas de cette attestation.


### Autorisation Apple Web d’un ordre existant — phase 1

`account_erasure_apple_web/{challengeId}` est privé serveur. Il contient uniquement l’ordre canonique existant, les hashes du sujet Apple et de la capacité Web, la source Auth native hachée, l’instant de préparation/expiration (5 minutes), les identifiants publics de configuration du projet, l’authentification primaire d’admission (UID, fournisseur et date, aucun JWT) et un état de consommation. Les empreintes d’autorisation/révocation permettent la reprise sans conserver code, ID token, access/refresh token ou capacité brute. `account_erasure_apple_web_owners/{uid}` pointe sur le dernier challenge admis pour cette même intention ; un nouveau challenge ne crée ni ordre ni clé d’observation. Les trois RPC vérifient le capabilty/propriétaire/source/état exacts ; aucun accès SDK direct n’est autorisé. Le callback HTTPS ne persiste rien.

### Preuves postales manuelles V1 — préparation locale du 25 novembre 2026

`swaps/{id}.{initiatorPhotos,receiverPhotos}` garde `userId`, `photos` (références tokenless), `uploadedAt` serveur et `isValidated:false`. Le serveur ajoute `objects:[{path,generation,crc32c,contentType,size}]`, issus des métadonnées Storage et liés aux URLs dans le témoin local exact. Les objets sont immuables dans `swaps/{id}/photos/{uid}/{file}` ; leurs tokens sont révoqués par CAS et les en-têtes privés relus avant enregistrement. Aucune déclaration d’envoi ne prouve un scan transporteur.

L’inventaire d’effacement local inclut ces preuves et les orphelins du namespace propre au membre, avec parent natif qualifié. `account_erasure_commands/{id}/retained/{hash}` peut porter `protocol:account_erasure_retained_media_v1`, `path`, `generation`, `parentPath`, `parentSourceHash`, `sourceHash`, `purpose`, `reviewAt`, `policyVersion`, `recordedAt` ; la revue reprend la politique existante du contrat local, sans nouvelle durée. Un reçu `late_storage_receipts` distingue `retained_contract_generation` et `generation_absence_verified` : seul le second atteste une suppression constatée. Ce nouvel inventaire invalide les anciens reçus de qualification ; aucun déploiement ou pin cloud n’est attesté par cette documentation locale.
