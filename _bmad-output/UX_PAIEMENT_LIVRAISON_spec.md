# UX Spec — Paiement & Livraison (états, copy FR)

> Produit par `product-designer`. Cible : `rn-expo-dev` câble le contrat backend (Stripe Connect Custom + ShipEngine, déjà durci côté serveur).
> Voir aussi : `PAIEMENT_LIVRAISON_STATUS.md` (contrat backend), `types/index.ts:255` (TransactionStatus), `components/ui/Tag.tsx` (Badge), `app/wallet.tsx`, `app/checkout/shipping.tsx`, `app/my-orders.tsx`, `app/my-sales.tsx`, `app/settings/delete-account.tsx`.

## Principes de copy (rappel impératif)
- **Vouvoiement** partout (transactionnel). Ton sobre, rassurant, éditorial. Aucun emoji.
- **Tous les libellés via tokens** `constants/theme` (couleurs/spacing/typo). Zéro valeur magique.
- **Meetup = cash en main propre** : la copy ne promet JAMAIS de crédit wallet après une rencontre.
- **Montants** : format CA-FR existant `45,00 $` (cf. `formatCents` / `formatPrice`). Dates : `toLocaleDateString(APP_LOCALE, { day:'numeric', month:'long' })` → ex. « 5 juin ».
- **Pas d'animation spring** (withTiming + ease-out uniquement).

---

## 1. Statuts de transaction — labels FR (acheteur vs vendeur) + variant Badge

Le composant existant `components/ui/Tag.tsx` expose `Badge` avec `variant`: `default | primary | success | warning | danger | outline`. C'est le composant à utiliser pour la pastille de statut (remplace progressivement le dot + texte coloré inline de `my-orders`/`my-sales`).

**Mapping variant → ton** :
- `success` → positif (livré, finalisé, échange terminé, remboursé crédité)
- `primary` → en cours, neutre-actif (payé, expédié, étiquette prête)
- `warning` → attente d'action / vigilance (paiement en attente, rencontre à confirmer, litige)
- `danger` → échec / blocage (échec de livraison, colis perdu, annulé)
- `default` → état terminal froid (remboursé côté historique)

> Note perception : l'acheteur et le vendeur voient le MÊME statut technique mais une formulation différente (l'acheteur attend un colis, le vendeur attend un paiement / doit expédier).

| status | Label ACHETEUR | Label VENDEUR | Badge variant | tone |
|--------|----------------|----------------|---------------|------|
| `pending_payment` | Paiement en attente | Paiement en attente | warning | warning |
| `meetup_pending` | Rencontre à confirmer | Rencontre à confirmer | warning | warning |
| `meetup_confirmed` | Rencontre confirmée | Rencontre confirmée | primary | neutre |
| `meetup_completed` | Échange terminé | Échange terminé | success | positif |
| `paid` | Payée — en préparation | À expédier | primary | neutre |
| `label_created` | Étiquette prête — bientôt en route | Étiquette créée — déposez le colis | primary | neutre |
| `shipped` | En cours d'acheminement | Colis expédié | primary | neutre |
| `delivered` | Livrée | Livrée | success | positif |
| `completed` | Vente finalisée | Vente finalisée | success | positif |
| `delivery_failed` | Problème de livraison | Problème de livraison | danger | alerte |
| `lost` | Colis égaré | Colis égaré | danger | alerte |
| `disputed` | Litige en cours | Litige en cours | warning | alerte |
| `refund_in_progress` | Remboursement en cours | Remboursement en cours | warning | neutre |
| `refunded` | Remboursée | Remboursée | default | neutre |
| `cancelled` | Annulée | Annulée | danger | alerte |

**Sous-titre / description courte par statut** (à afficher sous le badge dans la fiche commande/vente `payment/[id]` ou détail) :

ACHETEUR :
- `paid` : « Le vendeur prépare votre colis. »
- `label_created` : « L'étiquette est prête, le vendeur va déposer votre colis. »
- `shipped` : « Votre colis est en route. Suivez son acheminement ci-dessous. »
- `delivered` : « Colis livré. Vos fonds sont protégés jusqu'au {fundsReleaseAt}. »
- `completed` : « Vente finalisée. Merci pour votre achat. »
- `delivery_failed` : « La livraison n'a pas abouti. Nous avons gelé votre paiement, vous êtes protégé·e. »
- `lost` : « Le colis semble égaré. Nous avons gelé votre paiement, vous êtes protégé·e. »
- `disputed` : « Un litige est ouvert sur cette commande. Notre équipe l'examine. »
- `refund_in_progress` : « Votre remboursement est en cours de traitement. »
- `refunded` : « Vous avez été remboursé·e. »

VENDEUR :
- `paid` : « Paiement reçu. Préparez votre colis, l'étiquette va être générée. »
- `label_created` : « Votre étiquette d'expédition est prête. Déposez le colis chez le transporteur. »
- `shipped` : « Colis en transit vers l'acheteur·euse. »
- `delivered` : « Colis livré. Vos fonds seront disponibles le {fundsReleaseAt}. »
- `completed` : « Vente finalisée. Le montant est disponible dans votre porte-monnaie. »
- `delivery_failed` : « La livraison a échoué. Un litige est ouvert, les fonds sont gelés le temps de la résolution. »
- `lost` : « Le colis a été déclaré égaré. Les fonds sont gelés le temps de la résolution. »
- `disputed` : « Un litige est ouvert. Notre équipe vous contactera si besoin. »
- `refund_in_progress` : « Un remboursement est en cours sur cette vente. »
- `refunded` : « Cette vente a été remboursée à l'acheteur·euse. »

---

## 2. Wallet (`app/wallet.tsx`) — 3 buckets + blocages

Champs backend : `wallet.balance` (cents, retirable), `wallet.pendingBalance` (cents, vente en cours), `wallet.heldBalance` (cents, en fenêtre de protection 7j), `wallet.sellerDebt` (cents, bloque les retraits).

### Carte solde — 3 buckets
Réutiliser la `balanceCard` charcoal existante. Le bucket **Disponible** reste l'amount principal en grand (Cormorant). Les deux autres apparaissent en lignes secondaires sous le montant (style `balancePending` existant), uniquement si > 0.

- **Disponible** (`balance`)
  - Libellé : `Solde disponible`
  - Sous-texte (sous le montant, optionnel) : `Retirable à tout moment`
- **En attente** (`pendingBalance`, n'apparaît que si > 0)
  - Ligne : `{montant} en attente`
  - Tooltip / aide : `Vente en cours. Le montant arrivera dans votre solde une fois la commande finalisée.`
- **Bientôt disponible** (`heldBalance`, n'apparaît que si > 0)
  - Ligne : `{montant} bientôt disponible`
  - Sous-ligne (si une date de libération est connue, la plus proche) : `Disponible le {date}`
  - Aide : `Vos ventes livrées sont libérées 7 jours après la livraison, le temps de la fenêtre de protection acheteur.`

### Bloc explicatif « fenêtre de protection 7 jours »
À afficher sous la carte solde quand `heldBalance > 0` (encart info, style `securityBox` de `payment/[id]`, fond `successLight`, icône `shield-checkmark`).
- Titre : `Protection Seconde`
- Texte : `Après une livraison, le montant de la vente est conservé 7 jours avant d'arriver dans votre solde. Cette fenêtre permet à l'acheteur·euse de signaler un éventuel problème. Passé ce délai, les fonds deviennent retirables.`

### Retrait bloqué — litige actif
Déclencheur : tentative de retrait alors qu'un litige est actif → la callable `walletWithdraw` renvoie `failed-precondition`. **Ne PAS afficher l'erreur brute.** Intercepter et afficher (Alert ou encart inline) :
- Titre : `Retrait momentanément indisponible`
- Message : `Un litige est en cours sur l'une de vos transactions. Les retraits sont suspendus le temps de sa résolution. Nous reviendrons vers vous dès que possible.`
- CTA : `Compris`

### Retrait bloqué — dette vendeur (`sellerDebt > 0`)
Déclencheur : `sellerDebt > 0` (ex. remboursement avancé à régulariser) → retrait refusé.
- Encart permanent en haut du wallet (style `warningBox`, fond `warningLight`, icône `alert-circle`, couleur `warning`) :
  - Titre : `Régularisation nécessaire`
  - Texte : `Un montant de {montant} reste à régulariser sur votre compte. Les retraits sont suspendus tant que ce solde n'est pas réglé. Vos prochaines ventes seront affectées à cette régularisation en priorité.`
- Si l'utilisateur lance quand même un retrait → Alert :
  - Titre : `Retrait indisponible`
  - Message : `Vous avez un montant à régulariser ({montant}). Les retraits reprendront automatiquement une fois ce solde réglé.`
  - CTA : `Compris`

### Suivi des retraits (`withdrawal_requests`)
Statuts possibles : `processing | completed | failed`. À afficher dans l'historique (ledger) ou un encart « Retrait en cours » :
- `processing` : `Retrait en cours — {montant}` · sous-texte `Transfert vers votre compte bancaire, sous 2 à 3 jours ouvrés.`
- `completed` : `Retrait effectué — {montant}` · sous-texte `Transféré vers votre compte bancaire.`
- `failed` : `Retrait échoué — {montant}` · sous-texte `{failureReason ? failureReason : "Le transfert n'a pas pu aboutir. Le montant a été recrédité sur votre solde."}` · ton danger.

### Message de succès retrait (remplace l'existant, sans accents manquants)
- Titre : `Retrait envoyé`
- Message : `Votre demande de retrait a été enregistrée. Le transfert vers votre compte bancaire sera traité sous 2 à 3 jours ouvrés.`

---

## 3. Checkout livraison (`app/checkout/shipping.tsx`)

### 3a. Tarif expiré → rafraîchir l'estimation
Déclencheur : `createStripeCheckout` renvoie `failed-precondition` (message serveur type « tarif expiré »). Le `shipEngineRateId` n'est plus valide.
- Alert :
  - Titre : `Tarif de livraison expiré`
  - Message : `Le tarif d'expédition sélectionné n'est plus valide. Actualisez l'estimation pour obtenir un tarif à jour avant de payer.`
  - CTA primaire : `Actualiser l'estimation` (relance `fetchShippingEstimates`)
  - CTA secondaire : `Annuler`

### 3b. Livraison momentanément indisponible → main propre
Déclencheur : le `rateId` est `fallback_*` (ShipEngine indisponible). **Bloquer le paiement.** Ne pas laisser payer un tarif factice.
- Encart d'avertissement au-dessus du bouton Payer (style `warningBox`, icône `alert-circle`, ton warning), bouton Payer désactivé :
  - Titre : `Livraison momentanément indisponible`
  - Texte : `Nous ne parvenons pas à calculer les frais d'expédition pour le moment. Réessayez dans quelques minutes, ou convenez d'une remise en main propre avec le vendeur·euse.`
  - CTA primaire : `Réessayer` (relance `fetchShippingEstimates`)
  - CTA secondaire : `Proposer une remise en main propre` (redirige vers le flux meetup / chat)

### 3c. Note protection acheteur (sous le récap prix / bloc sécurité)
Réutiliser le bloc `securityBox` existant (fond `successLight`, icône `shield-checkmark`). Ajouter/ajuster :
- Titre : `Protection acheteur`
- Texte : `Votre paiement est sécurisé. Les fonds ne sont versés au vendeur·euse que 7 jours après la livraison. En cas de problème, vous pouvez nous le signaler durant ce délai.`

### 3d. Copy meetup (remise en main propre) — AUCUNE promesse de crédit
À utiliser sur l'écran/option meetup (`app/checkout/meetup.tsx` et toute mention de paiement meetup).
- Titre de l'option : `Remise en main propre`
- Description : `Réglez directement le vendeur·euse lors de la rencontre, en main propre. Aucun paiement n'est traité par l'application pour ce mode.`
- Note (encart info, ton neutre, icône `information-circle`) : `La remise en main propre se règle hors application. Le montant n'est pas crédité sur votre porte-monnaie Seconde.`
- CTA acheteur : `Proposer une rencontre`
- Confirmation après échange (vendeur ou acheteur, selon flux existant `meetup_completed`) : `Échange confirmé`

---

## 4. Flux de recours acheteur (`delivery_failed` / `lost` + demande de retour)

Surface : fiche commande détaillée (chat de transaction / `payment/[id]` étendu / écran de suivi `ShipmentTracking`). Les CTA n'apparaissent que côté ACHETEUR.

### 4a. Sur `delivery_failed` ou `lost` — point d'entrée recours
Encart d'alerte (style `warningBox`/`dangerLight`, icône `alert-circle`) :
- `delivery_failed` :
  - Titre : `La livraison n'a pas abouti`
  - Texte : `Le transporteur n'a pas pu livrer votre colis. Vos fonds sont gelés et restent protégés. Dites-nous comment vous souhaitez procéder.`
- `lost` :
  - Titre : `Votre colis semble égaré`
  - Texte : `Le suivi de votre colis est interrompu. Vos fonds sont gelés et restent protégés. Signalez-nous le problème pour être remboursé·e.`
- CTA primaire : `Signaler un problème`
- CTA secondaire : `Demander un remboursement`

### 4b. Flux « Signaler un problème » (bottom sheet / écran)
- Titre : `Signaler un problème`
- Intro : `Sélectionnez ce qui s'est passé. Notre équipe examine chaque signalement sous 48 h.`
- Options (liste sélectionnable) :
  - `Colis non reçu`
  - `Article non conforme à l'annonce`
  - `Article endommagé`
  - `Autre`
- Champ : `Décrivez le problème` (placeholder : `Donnez-nous quelques détails…`)
- CTA primaire : `Envoyer le signalement`
- Confirmation (success) : Titre `Signalement envoyé` · Texte `Nous avons bien reçu votre signalement. Notre équipe revient vers vous sous 48 h. Vos fonds restent protégés.`

### 4c. Flux « Demander un remboursement »
- Titre : `Demander un remboursement`
- Texte : `Vous pouvez demander le remboursement de cette commande. Une fois validé, le montant sera recrédité sur votre moyen de paiement d'origine.`
- Encart info : `Le remboursement est traité après vérification par notre équipe. Vous serez notifié·e de chaque étape.`
- CTA primaire : `Confirmer la demande`
- CTA secondaire : `Annuler`
- Confirmation : Titre `Demande envoyée` · Texte `Votre demande de remboursement a été transmise. Nous vous tiendrons informé·e de son avancement.`

### 4d. Flux « Demande de retour » (article reçu mais à renvoyer — frais à charge acheteur)
Déclencheur : article reçu (`delivered`/fenêtre 7j) mais non conforme/changement d'avis → l'acheteur renvoie l'article. **Frais de retour à la charge de l'acheteur** (décision bakée).
- Titre : `Demander un retour`
- Texte : `Vous souhaitez renvoyer cet article ? Expliquez-nous le motif. Une étiquette de retour vous sera fournie après validation.`
- Champ motif (réutilise les options de 4b, + `Changement d'avis`).
- Encart frais (ton neutre/warning, icône `information-circle`) :
  - Titre : `Frais de retour à votre charge`
  - Texte : `Les frais d'expédition du retour sont à votre charge et seront déduits du remboursement. Le montant de l'article vous sera remboursé une fois le retour réceptionné par le vendeur·euse.`
- CTA primaire : `Demander le retour`
- CTA secondaire : `Annuler`
- Confirmation : Titre `Demande de retour envoyée` · Texte `Votre demande est en cours de validation. Vous recevrez l'étiquette de retour et les instructions ici même.`
- Étape suivante (après émission étiquette retour) — encart : Titre `Étiquette de retour disponible` · Texte `Imprimez votre étiquette et déposez le colis chez le transporteur. Vous serez remboursé·e une fois le retour réceptionné.` · CTA `Voir l'étiquette de retour`.

---

## 5. Blocage suppression de compte (litige / vente non finalisée)

Écran : `app/settings/delete-account.tsx`. Le code vérifie déjà transactions actives + solde wallet. Ajouter un cas explicite « litige en cours » et durcir la copy (sans promettre que c'est uniquement « commandes »).

### 5a. Litige actif (nouveau cas prioritaire)
Déclencheur : une transaction de l'utilisateur (acheteur ou vendeur) est en `disputed` / `delivery_failed` / `lost` / `refund_in_progress`.
- Alert :
  - Titre : `Litige en cours`
  - Message : `Un litige est en cours sur l'une de vos transactions. Vous pourrez supprimer votre compte une fois ce litige résolu et les fonds régularisés.`
  - CTA : `Compris`

### 5b. Vente / commande non finalisée (renforce l'existant)
- Titre : `Transactions en cours`
- Message : `Vous avez des transactions non finalisées (achat ou vente en cours). Veuillez les terminer avant de supprimer votre compte.`
- CTA : `Compris`

### 5c. Solde / fonds à récupérer (renforce l'existant)
- Solde disponible > 0 → Titre `Solde à retirer` · Message `Vous disposez de {montant} sur votre porte-monnaie. Effectuez un retrait avant de supprimer votre compte.` · CTA `Voir mon porte-monnaie`.
- `pendingBalance` ou `heldBalance` > 0 → Titre `Fonds en attente` · Message `Vous avez {montant} en attente de versement. Attendez que vos ventes soient finalisées avant de supprimer votre compte.` · CTA `Compris`.
- `sellerDebt > 0` → Titre `Régularisation nécessaire` · Message `Un montant reste à régulariser sur votre compte. Vous pourrez le supprimer une fois ce solde réglé.` · CTA `Compris`.

---

## Composants DS à réutiliser (ne pas réinventer)
- `components/ui/Tag.tsx` → `Badge` (variants `success/primary/warning/danger/default`) pour les pastilles de statut.
- `securityBox` / `warningBox` patterns existants (`payment/[id]`, `delete-account`) pour les encarts protection/alerte — extraire éventuellement un `InfoCallout` dans `components/ui/` si réutilisé > 3 fois (proposer une variante avant de coder).
- `components/ui/Button` (variants `primary/secondary/danger/muted`) pour les CTA recours.
- `ScreenHeader`, `Skeleton`, `Text` (déjà importés).

## Tokens couleur (rappel — aucune valeur hardcodée)
`colors.success / successLight` (positif/protection), `colors.warning / warningLight` (attente/vigilance), `colors.danger / dangerLight` (échec/blocage), `colors.primary` (en cours), `colors.muted` (terminal froid). Le `#FF9500` / `#34C759` hardcodés dans `ShipmentTracking.tsx` sont à migrer vers `colors.warning` / `colors.success` (dette technique signalée, hors périmètre direct mais à corriger au passage).
