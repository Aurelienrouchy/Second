import type { ProductRoutingStatement, ProductRoutingStatementDraft, ProductRoutingPlace } from '@/types/productRoutingReview';
import type { ProductParcelLeg } from '@/types/productParcelReview';
import { productReviewDeclaredDate } from '@/utils/productMaterialStatement';
export const PRODUCT_ROUTING_QUALIFICATION = { routingFactsVerified: false, carrierCorrectionVerified: false, contractAddressChanged: false, interceptionPromised: false, physicalRecoveryVerified: false, routingReviewDoesNotApproveMoney: true } as const;
export const ROUTING_CHOICES = { kind: ['transit_observation_only', 'correction_reported', 'destination_disputed', 'unknown'], phase: ['intermediate_transit', 'delivery_attempt', 'final_delivery', 'unknown'], correctionReported: ['declared_yes', 'declared_no', 'unknown'], source: ['participant_observation', 'carrier_message', 'document_reference', 'unknown'], evidenceAvailability: ['available', 'unavailable', 'unknown'] } as const;
export const ROUTING_LABELS: Record<string, string> = { transit_observation_only: 'Simple observation de transit', correction_reported: 'Correction rapportée', destination_disputed: 'Destination contestée', unknown: 'Inconnu', intermediate_transit: 'Transit intermédiaire', delivery_attempt: 'Tentative de remise', final_delivery: 'Remise finale annoncée', declared_yes: 'Correction déclarée', declared_no: 'Aucune correction déclarée', participant_observation: 'Observation personnelle déclarée', carrier_message: 'Message du transporteur déclaré', document_reference: 'Document ou référence déclaré', available: 'Pièces disponibles selon moi', unavailable: 'Pièces indisponibles selon moi' };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const fields = ['kind', 'phase', 'correctionReported', 'issuer', 'source', 'occurredAt', 'reference', 'previousPlace', 'observedPlace', 'evidenceAvailability', 'evidenceLimitations'];
function valid(value: unknown, draft: boolean) {
    const text = (v: unknown, max: number) => v === null || typeof v === 'string' && v.length <= max && (draft || !!v && v.trim() === v);
    const date = (v: unknown) => draft ? object(v) && exact(v, ['precision', 'value']) && (v.precision === null || ['unknown', 'civil_day', 'instant'].includes(String(v.precision))) && typeof v.value === 'string' && v.value.length <= 24 : v === null || typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
    const place = (v: unknown) => v === null || object(v) && exact(v, ['country', 'province', 'city', 'postalCode', 'detail']) && text(v.country, 100) && text(v.province, 100) && text(v.city, 300) && text(v.postalCode, 100) && text(v.detail, 1000);
    if (!object(value) || !exact(value, [...fields, ...(draft ? [] : ['protocol', 'leg', 'labelId'])]) || !Object.entries(ROUTING_CHOICES).every(([key, choices]) => draft && value[key] === null || (choices as readonly string[]).includes(String(value[key]))) || !text(value.issuer, 500) || !text(value.reference, 500) || !text(value.evidenceLimitations, 2000) || !date(value.occurredAt) || !place(value.previousPlace) || !place(value.observedPlace))
        return false;
    if (draft)
        return true;
    return value.protocol === 'product_routing_statement_v1' && ['forward', 'return'].includes(String(value.leg)) && (value.labelId === null || typeof value.labelId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value.labelId)) && (value.kind !== 'transit_observation_only' || value.correctionReported === 'declared_no') && (value.kind !== 'correction_reported' || value.correctionReported === 'declared_yes');
}
export const isProductRoutingStatement = (v: unknown): v is ProductRoutingStatement => valid(v, false);
export const isProductRoutingStatementDraft = (v: unknown): v is ProductRoutingStatementDraft => valid(v, true);
export const emptyProductRoutingStatementDraft = (): ProductRoutingStatementDraft => ({ kind: null, phase: null, correctionReported: null, issuer: '', source: null, occurredAt: { precision: null, value: '' }, reference: '', previousPlace: null, observedPlace: null, evidenceAvailability: null, evidenceLimitations: '' });
export function buildProductRoutingStatement(draft: ProductRoutingStatementDraft, leg: ProductParcelLeg, labelId: string | null, nowMs = Date.now()) {
    if (!isProductRoutingStatementDraft(draft))
        throw new Error('Le brouillon de routage doit être relu.');
    const text = (v: string | null) => v?.trim() || null, place = (v: ProductRoutingPlace | null) => v === null ? null : Object.fromEntries(Object.entries(v).map(([k, value]) => [k, text(value)]));
    const date = productReviewDeclaredDate(draft.occurredAt, 'Date du routage ou de la correction rapportée', nowMs);
    const routingStatement = { ...draft, protocol: 'product_routing_statement_v1', leg, labelId, issuer: text(draft.issuer), reference: text(draft.reference), occurredAt: date.instant, previousPlace: place(draft.previousPlace), observedPlace: place(draft.observedPlace), evidenceLimitations: text(draft.evidenceLimitations) };
    if (!isProductRoutingStatement(routingStatement))
        throw new Error('Choisissez la nature, la phase, la correction rapportée, sa source et les pièces, y compris les inconnues. Une simple observation de transit déclare explicitement qu’aucune correction n’est rapportée.');
    return { routingStatement, dateNote: date.note };
}

/** Synchronous local choices invalidate an awaiting routing contribution before React commits. */
export function createProductRoutingInteraction() {
  let revision = 0;
  return {invalidate: () => {revision++;}, capture: () => {const expected = revision; return () => {if (revision !== expected) throw new Error('Votre constat de routage a changé. Relisez-le avant de confirmer.');};}};
}
