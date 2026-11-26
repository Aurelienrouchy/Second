/**
 * Frais de protection Seconde — Acheteur uniquement
 *
 * Modèle : 0% vendeur, frais 100% côté acheteur (comme Vinted)
 * Le vendeur reçoit 100% du prix de son article.
 *
 * Frais acheteur = 5% du prix article + 1,50$ fixe
 * Minimum : 2,00$
 *
 * Ce que ça couvre :
 * - Protection acheteur (litige, remboursement)
 * - Paiement sécurisé (Stripe processing)
 * - Support client
 * - Infrastructure (hébergement, API shipping)
 *
 * Benchmark :
 * - Vinted : 5% + 0,70€ → on est aligné
 * - Poshmark : 20% vendeur → on est beaucoup plus attractif pour les vendeurs
 */
import { HttpsError } from 'firebase-functions/v2/https';
import {qualifyNewServiceFeeTax,type ServiceFeeTaxContext,type ServiceFeeTaxAdmission} from '../config/operatorServiceTax';

// =============================================================================
// CONFIGURATION SERVEUR — décimales exactes, validées avant tout calcul.
// =============================================================================

/** Pourcentage des frais de protection (ex: 5 = 5%) */
const BUYER_FEE_PERCENT = process.env.BUYER_FEE_PERCENT ?? '5';

/** Frais fixe ajouté en plus du pourcentage (en CAD) */
const BUYER_FEE_FIXED = process.env.BUYER_FEE_FIXED ?? '1.50';

/** Frais de protection minimum (en CAD) — protège contre les micro-articles */
const BUYER_FEE_MIN = process.env.BUYER_FEE_MIN ?? '2.00';

// =============================================================================
// TAXES TPS/TVQ — INFRASTRUCTURE DERRIÈRE FLAG (OFF par défaut)
// =============================================================================
//
// ⚠️ ACTION MÉTIER REQUISE AVANT D'ACTIVER (TAX_ENABLED=true) ⚠️
// Activer la taxe est une décision FISCALE du fondateur, PAS technique :
//   - immatriculation TPS (numéro fédéral) + TVQ (numéro Revenu Québec)
//     obligatoire avant de percevoir et remettre la taxe ;
//   - seuil de petit fournisseur (30 000 $ / 4 trimestres) ;
//   - statuer AVEC UN FISCALISTE sur la taxe du shipping refacturé — HORS SCOPE
//     ici : ce calcul ajoute une taxe au service fee seulement. L'absence
//     d'ajout sur le prix transporteur n'en établit pas le traitement fiscal ;
//     une nouvelle expédition TAX_ON exige sa justification documentaire.
//
// TAX_ENABLED=true ne suffit pas : le service, le lieu, les inscriptions et
// le traitement du transport nécessitent la configuration documentaire serveur.
// Tant que TAX_ENABLED=false (défaut), la taxe vaut 0 et `buyerTotal`
// n'inclut aucune taxe. Quand true, la taxe s'ajoute au
// `buyerTotal` et est conservée par la plateforme (incluse dans la charge
// plateforme — pas de transfer_data, modèle vague 1).

/** Active la perception de la taxe. OFF par défaut (décision fiscale fondateur). */
const TAX_ENABLED = (process.env.TAX_ENABLED ?? 'false').toLowerCase();

/** Taux TPS (fédéral) — 5% par défaut. */
const GST_RATE = process.env.GST_RATE ?? '0.05';

/** Taux TVQ (Québec) — 9,975% par défaut. */
const QST_RATE = process.env.QST_RATE ?? '0.09975';

interface Fraction { numerator: number; denominator: number; }
const invalidConfig = () => new HttpsError('failed-precondition', 'La configuration des frais doit être examinée.',
  { reason: 'fee_configuration_invalid', paymentPermissionGranted: false });

/** Up to six decimal places, no parseFloat prefix acceptance or silent clamp. */
function fraction(raw: string, maximum: number, invalid: () => Error): Fraction {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(raw)) throw invalid();
  const [whole, decimal = ''] = raw.split('.');
  const denominator = 10 ** decimal.length, numerator = Number(whole + decimal);
  if (!Number.isSafeInteger(numerator) || numerator < 0 || numerator / denominator > maximum) throw invalid();
  return { numerator, denominator };
}

/** Nonnegative rational cents: nearest cent, exact half-cent rounds upward. */
function roundedRatio(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || numerator < 0 || !Number.isSafeInteger(denominator) || denominator <= 0) throw invalidConfig();
  const quotient = Math.floor(numerator / denominator), remainder = numerator % denominator;
  const cents = quotient + (remainder >= Math.ceil(denominator / 2) ? 1 : 0);
  if (!Number.isSafeInteger(cents)) throw invalidConfig();
  return cents;
}

function configuredCents(raw: string): number {
  const value = fraction(raw, Number.MAX_SAFE_INTEGER / 100, invalidConfig);
  const scaled = value.numerator * 100;
  if (!Number.isSafeInteger(scaled) || scaled % value.denominator !== 0) throw invalidConfig();
  return scaled / value.denominator;
}

function config() {
  if (TAX_ENABLED !== 'true' && TAX_ENABLED !== 'false') throw invalidConfig();
  return { percent: fraction(BUYER_FEE_PERCENT, 100, invalidConfig), fixedCents: configuredCents(BUYER_FEE_FIXED),
    minCents: configuredCents(BUYER_FEE_MIN), gst: fraction(GST_RATE, 1, invalidConfig),
    qst: fraction(QST_RATE, 1, invalidConfig), taxEnabled: TAX_ENABLED === 'true' };
}

/** Same tolerance as canonical purchase money; never round a fractional-cent input. */
function moneyCents(value: number): number {
  const cents = Math.round(value * 100);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(cents) ||
      Math.abs(value * 100 - cents) >= 1e-7) throw new HttpsError('invalid-argument', 'Un montant en cents exacts est nécessaire.',
    { reason: 'fee_money_invalid', paymentPermissionGranted: false });
  return cents;
}

function sumCents(...amounts: number[]): number {
  const total = amounts.reduce((sum, cents) => sum + cents, 0);
  if (!Number.isSafeInteger(total) || total < 0) throw invalidConfig();
  return total;
}

export interface TaxConfig {
  enabled: boolean;
  gstRate: number;
  qstRate: number;
}

/**
 * Config taxe serveur (jamais fournie par le client). Réglable via env vars :
 *   TAX_ENABLED (défaut 'false'), GST_RATE (0.05), QST_RATE (0.09975).
 */
export function getTaxConfig(): TaxConfig {
  const settings = config();
  return { enabled: settings.taxEnabled, gstRate: settings.gst.numerator / settings.gst.denominator,
    qstRate: settings.qst.numerator / settings.qst.denominator };
}

export interface TaxBreakdown {
  /** TPS calculée sur le service fee (0 quand OFF). */
  gst: number;
  /** TVQ calculée sur le service fee (0 quand OFF). */
  qst: number;
  /** Total taxe = gst + qst (0 quand OFF). */
  taxTotal: number;
  /** Taxe ajoutée ici sur le service fee ; aucun statut fiscal du transport. */
  taxOnServiceFee: number;
}

/** Technical calculation capture, not evidence of registration or tax liability.
 * Money is in CAD dollars; the taxable fee is the effective fee AFTER reduction. */
export interface ServiceFeeTaxSnapshot {
  schemaVersion: 1; protocol: 'service_fee_tax_v1'; currency: 'CAD';
  taxableServiceFee: number; gst: number; qst: number; taxTotal: number;
  technicalConfiguration: { enabled: boolean; gstRate: number; qstRate: number };
  registrationStatusVerified: false;
}

export function buildServiceFeeTaxSnapshot(serviceFee: number, context?:ServiceFeeTaxContext): ServiceFeeTaxSnapshot {
  const tax = computeTaxOnServiceFee(serviceFee,context);
  return { schemaVersion: 1, protocol: 'service_fee_tax_v1', currency: 'CAD', taxableServiceFee: moneyCents(serviceFee) / 100,
    gst: tax.gst, qst: tax.qst, taxTotal: tax.taxTotal, technicalConfiguration: getTaxConfig(), registrationStatusVerified: false };
}

/** Additive prospective decision, including documented noncollection when
 * technically OFF. Original V1 captures/hashes are never enriched. A zero
 * service fee is not an exemption; shipping still requires its distinct
 * documentary transport treatment before omitting an additional tax there. */
export function buildServiceFeeTaxCapture(serviceFee:number,context?:ServiceFeeTaxContext):{
  taxSnapshot:ServiceFeeTaxSnapshot;taxAdmission?:ServiceFeeTaxAdmission;
} {
  const taxAdmission=serviceFeeTaxAdmission(serviceFee,context);
  return {taxSnapshot:buildServiceFeeTaxSnapshot(serviceFee,context),...(taxAdmission?{taxAdmission}:{})};
}
export function serviceFeeTaxAdmission(serviceFee:number,context?:ServiceFeeTaxContext):ServiceFeeTaxAdmission|undefined {
  const settings=config(),cents=moneyCents(serviceFee);
  if(cents===0&&context?.transport!=='native_carrier_total')return undefined;
  return qualifyNewServiceFeeTax(settings.gst.numerator/settings.gst.denominator,settings.qst.numerator/settings.qst.denominator,context,settings.taxEnabled);
}

/** Read a historical capture using ONLY its recorded rates/flag. Current env
 * configuration must never backfill or relabel the accepted tax components. */
export function qualifiedServiceFeeTaxSnapshot(raw: any, serviceFee: number, taxTotal: number): ServiceFeeTaxSnapshot | null {
  const exact = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v) &&
    Object.keys(v).sort().join(',') === keys.sort().join(',');
  if (!exact(raw, ['schemaVersion', 'protocol', 'currency', 'taxableServiceFee', 'gst', 'qst', 'taxTotal', 'technicalConfiguration', 'registrationStatusVerified']) ||
      raw.schemaVersion !== 1 || raw.protocol !== 'service_fee_tax_v1' || raw.currency !== 'CAD' || raw.registrationStatusVerified !== false ||
      !exact(raw.technicalConfiguration, ['enabled', 'gstRate', 'qstRate']) || typeof raw.technicalConfiguration.enabled !== 'boolean') return null;
  try {
    const feeCents = moneyCents(serviceFee), totalCents = moneyCents(taxTotal), c = raw.technicalConfiguration;
    if (![c.gstRate, c.qstRate].every(v => typeof v === 'number' && Number.isFinite(v))) return null;
    const gstRate = fraction(String(c.gstRate), 1, invalidConfig), qstRate = fraction(String(c.qstRate), 1, invalidConfig);
    const gstCents = c.enabled ? roundedRatio(feeCents * gstRate.numerator, gstRate.denominator) : 0;
    const qstCents = c.enabled ? roundedRatio(feeCents * qstRate.numerator, qstRate.denominator) : 0;
    if (moneyCents(raw.taxableServiceFee) !== feeCents || moneyCents(raw.gst) !== gstCents || moneyCents(raw.qst) !== qstCents ||
        moneyCents(raw.taxTotal) !== totalCents || sumCents(gstCents, qstCents) !== totalCents) return null;
    return { schemaVersion: 1, protocol: 'service_fee_tax_v1', currency: 'CAD', taxableServiceFee: feeCents / 100,
      gst: gstCents / 100, qst: qstCents / 100, taxTotal: totalCents / 100,
      technicalConfiguration: { enabled: c.enabled, gstRate: gstRate.numerator / gstRate.denominator, qstRate: qstRate.numerator / qstRate.denominator },
      registrationStatusVerified: false };
  } catch { return null; }
}

/**
 * Calcule la taxe SUR LE SERVICE FEE uniquement. Après qualification de la
 * non-collecte, retourne tout à 0 quand TAX_ENABLED est false. N'ajoute pas de taxe
 * au transport ; ce fait technique ne qualifie pas son traitement fiscal.
 */
function computeTaxOnServiceFee(serviceFee: number,context?:ServiceFeeTaxContext): TaxBreakdown {
  const settings = config(), cents = moneyCents(serviceFee);
  // OFF is a technical switch, not evidence of exemption or non-registration.
  // Original snapshots are read by qualifiedServiceFeeTaxSnapshot, never here.
  serviceFeeTaxAdmission(serviceFee,context);
  if (!settings.taxEnabled || cents === 0) {
    return { gst: 0, qst: 0, taxTotal: 0, taxOnServiceFee: 0 };
  }
  const gstCents = roundedRatio(cents * settings.gst.numerator, settings.gst.denominator);
  const qstCents = roundedRatio(cents * settings.qst.numerator, settings.qst.denominator);
  const taxTotal = sumCents(gstCents, qstCents) / 100;
  return { gst: gstCents / 100, qst: qstCents / 100, taxTotal, taxOnServiceFee: taxTotal };
}

// =============================================================================
// TYPES
// =============================================================================

export interface FeeBreakdown {
  /** Prix de l'article */
  articlePrice: number;
  /** Frais de livraison */
  shippingCost: number;
  /** Frais de protection acheteur effectifs (après réduction boutique) */
  serviceFee: number;
  /** Frais de protection au tarif plein, avant réduction boutique */
  serviceFeeBeforeReduction: number;
  /** Fraction de réduction appliquée (0 = plein tarif, 1 = gratuit) */
  feeReduction: number;
  /** Pourcentage appliqué */
  serviceFeePercent: number;
  /** Partie fixe des frais */
  serviceFeeFixed: number;
  /** TPS sur le service fee (0 quand TAX_ENABLED=false). */
  taxGst: number;
  /** TVQ sur le service fee (0 quand TAX_ENABLED=false). */
  taxQst: number;
  /** Taxe perçue sur le service fee uniquement (= taxTotal ; 0 quand OFF). */
  taxOnServiceFee: number;
  /** Total taxe ajoutée au buyerTotal (0 quand OFF). */
  taxTotal: number;
  /** Prospective opaque proof, absent on the original TAX_OFF path. */
  taxAdmission?:ServiceFeeTaxAdmission;
  /** Total que l'acheteur paie (inclut la taxe quand TAX_ENABLED=true) */
  buyerTotal: number;
  /** Montant que le vendeur reçoit (= prix article, 100%) */
  sellerPayout: number;
}

// =============================================================================
// CALCULATION
// =============================================================================

/**
 * Valide une réduction serveur dans [0, 1] sans transformer une valeur
 * invalide en plein tarif ou en gratuité. L'absence signifie plein tarif.
 *
 * @param feeReduction fraction de réduction (0 = plein tarif, 1 = gratuit)
 */
function normalizeFeeReduction(feeReduction?: number): number {
  if (feeReduction === undefined) return 0;
  if (typeof feeReduction !== 'number' || !Number.isFinite(feeReduction) || feeReduction < 0 || feeReduction > 1) throw invalidConfig();
  fraction(String(feeReduction), 1, invalidConfig);
  return feeReduction;
}

/**
 * Frais de protection au tarif plein (min appliqué), avant réduction boutique.
 * Arrondi au cent le plus proche, demi-cent vers le haut. La partie fixe est
 * déjà en cents entiers ; l'ajouter après cet arrondi est donc équivalent.
 */
function fullServiceFee(articlePrice: number): number {
  const settings = config(), cents = moneyCents(articlePrice);
  const percentageCents = roundedRatio(cents * settings.percent.numerator, settings.percent.denominator * 100);
  return Math.max(sumCents(percentageCents, settings.fixedCents), settings.minCents) / 100;
}

function reducedServiceFee(fullFee: number, reduction: number): number {
  const rate = fraction(String(reduction), 1, invalidConfig);
  return roundedRatio(moneyCents(fullFee) * (rate.denominator - rate.numerator), rate.denominator) / 100;
}

/**
 * Calcule les frais de protection et le total pour une transaction
 *
 * Formule : max(BUYER_FEE_MIN, articlePrice × BUYER_FEE_PERCENT/100 + BUYER_FEE_FIXED)
 *
 * Exemples (5% + 1,50$, min 2,00$) :
 *   5$  → max(2,00$, 0,25$ + 1,50$) = 2,00$  → acheteur paie  7,00$ + livraison
 *  15$  → max(2,00$, 0,75$ + 1,50$) = 2,25$  → acheteur paie 17,25$ + livraison
 *  30$  → max(2,00$, 1,50$ + 1,50$) = 3,00$  → acheteur paie 33,00$ + livraison
 *  50$  → max(2,00$, 2,50$ + 1,50$) = 4,00$  → acheteur paie 54,00$ + livraison
 * 100$  → max(2,00$, 5,00$ + 1,50$) = 6,50$  → acheteur paie 106,50$ + livraison
 *
 * Boutiques (Paid shop model) : `feeReduction` est une fraction dans [0, 1]
 * appliquée APRÈS le minimum, qui réduit UNIQUEMENT les frais acheteur — le
 * vendeur reçoit toujours 100% du prix (0% commission vendeur). La réduction
 * est dérivée serveur du tier boutique ; jamais fournie par le client.
 *
 * @param feeReduction fraction de réduction boutique (défaut 0 = plein tarif)
 */
export function calculateFees(
  articlePrice: number,
  shippingCost: number,
  feeReduction?: number,
  taxContext?:ServiceFeeTaxContext
): FeeBreakdown {
  const articleCents = moneyCents(articlePrice), shippingCents = moneyCents(shippingCost), settings = config();
  // Frais au tarif plein (min déjà appliqué)
  const serviceFeeBeforeReduction = fullServiceFee(articlePrice);

  // Réduction validée serveur, appliquée après l'arrondi et le minimum.
  const reduction = normalizeFeeReduction(feeReduction);
  const serviceFee = reducedServiceFee(serviceFeeBeforeReduction, reduction);

  // Chaque taxe est arrondie séparément sur les frais réduits, puis additionnée.
  const tax = computeTaxOnServiceFee(serviceFee,taxContext),taxAdmission=serviceFeeTaxAdmission(serviceFee,taxContext);

  // Total acheteur = article + livraison + frais de protection (réduits) + taxe
  const buyerTotal = sumCents(articleCents, shippingCents, moneyCents(serviceFee), moneyCents(tax.taxTotal)) / 100;

  // Vendeur reçoit 100% du prix article — 0% commission vendeur
  const sellerPayout = articlePrice;

  return {
    articlePrice,
    shippingCost,
    serviceFee,
    serviceFeeBeforeReduction,
    feeReduction: reduction,
    serviceFeePercent: settings.percent.numerator / settings.percent.denominator,
    serviceFeeFixed: settings.fixedCents / 100,
    taxGst: tax.gst,
    taxQst: tax.qst,
    taxOnServiceFee: tax.taxOnServiceFee,
    taxTotal: tax.taxTotal,
    ...(taxAdmission?{taxAdmission}:{}),
    buyerTotal,
    sellerPayout,
  };
}

/**
 * Calcule uniquement les frais de protection (pour affichage côté client).
 *
 * @param feeReduction fraction de réduction boutique (défaut 0 = plein tarif)
 */
export function calculateServiceFee(
  articlePrice: number,
  feeReduction?: number
): number {
  const reduction = normalizeFeeReduction(feeReduction);
  return reducedServiceFee(fullServiceFee(articlePrice), reduction);
}

/**
 * Calcule la taxe (TPS/TVQ) sur un service fee déjà calculé. Retourne tout à 0
 * quand TAX_ENABLED=false. Un paiement déjà encaissé conserve sa taxe
 * enregistrée ; cette fonction prépare uniquement de nouveaux montants.
 */
export function calculateTaxOnServiceFee(serviceFee: number,context?:ServiceFeeTaxContext): TaxBreakdown {
  return computeTaxOnServiceFee(serviceFee,context);
}

/**
 * Retourne la config des frais (pour affichage côté client)
 */
export function getServiceFeeConfig(): {
  percent: number;
  fixed: number;
  min: number;
} {
  const settings = config();
  return {
    percent: settings.percent.numerator / settings.percent.denominator,
    fixed: settings.fixedCents / 100,
    min: settings.minCents / 100,
  };
}
