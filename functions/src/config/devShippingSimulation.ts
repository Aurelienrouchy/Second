/** Explicit isolated shipping exercise. Never a ShipEngine/carrier witness.
 * Storage is private; the only member command is devAdvanceShipping, which
 * binds a saved simulated label to its current purchase and authenticated parties.
 */
import { createHash, randomUUID } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { isDevCommerceShippingTestRuntime } from './runtimeEnvironment';

export const DEV_SHIPPING_PROTOCOL = 'seconde_dev_shipping_simulation_v1';
export const DEV_SHIPPING_SERVICE = { carrierId: 'se-dev-simulation', carrierCode: 'seconde_dev', serviceCode: 'seconde_dev_standard' } as const;
export const devShippingId = (v: unknown): v is string => typeof v === 'string' && /^se-devsim-[a-f0-9]{32}$/.test(v);
export function devShippingOrder(order: any): boolean {
  return isDevCommerceShippingTestRuntime() && order?.devShippingSimulation?.protocol === DEV_SHIPPING_PROTOCOL &&
    order.devShippingSimulation.realShipment === false && order.devShippingSimulation.trackingSource === 'member_test_action' &&
    order.carrierCode === DEV_SHIPPING_SERVICE.carrierCode && devShippingId(order.shipEngineLabelId);
}
export function requireDevShippingRuntime(): void {
  if (!isDevCommerceShippingTestRuntime()) throw new HttpsError('failed-precondition', 'La simulation de livraison est réservée à Seconde Dev isolé.');
}
const id = () => 'se-devsim-' + randomUUID().replace(/-/g, '');
let resources: typeof import('./firebase') | undefined;
const ref = (value: string) => resources!.db.collection('dev_shipping_simulations').doc(value);
const cad = (amount: number) => ({ amount, currency: 'cad' });
const metadata = { protocol: DEV_SHIPPING_PROTOCOL, realShipment: false, provider: 'seconde_dev_simulation' };
function assertQuebec(address: any) {
  const postal = String(address?.postal_code ?? '').replace(/\s/g, '').toUpperCase();
  if (address?.country_code !== 'CA' || address?.state_province !== 'QC' || !/^[GHJ]\d[A-Z]\d[A-Z]\d$/.test(postal))
    throw new Error('dev_shipping_requires_quebec_addresses');
}
function simulatedPrice(shipment: any): number {
  const parcel = shipment?.packages?.[0], weight = parcel?.weight;
  if (!parcel || shipment.packages.length !== 1 || weight?.unit !== 'kilogram' || typeof weight.value !== 'number' ||
      !Number.isFinite(weight.value) || weight.value <= 0 || weight.value > 100) throw new Error('dev_shipping_parcel_invalid');
  return Math.round((7.5 + Math.ceil(weight.value * 2) * 0.5) * 100) / 100;
}
function rate(shipment: any, rateId: string) {
  const price = simulatedPrice(shipment);
  return { rate_id: rateId, shipment_id: shipment.shipment_id, rate_type: 'shipment', validation_status: 'valid',
    warning_messages: [], error_messages: [], carrier_id: DEV_SHIPPING_SERVICE.carrierId,
    carrier_code: DEV_SHIPPING_SERVICE.carrierCode, carrier_friendly_name: 'Livraison de test — Seconde Dev',
    service_code: DEV_SHIPPING_SERVICE.serviceCode, service_type: 'Simulation Québec — aucun envoi réel',
    shipping_amount: cad(price), insurance_amount: cad(0), confirmation_amount: cad(0), other_amount: cad(0),
    estimated_delivery_days: 3, delivery_days: 3,
    rate_details: [{ rate_detail_type: 'shipping', amount: cad(price) }], simulation: metadata };
}
/** A minimal PDF, deliberately without a postal barcode, carrier logo or usable
 * shipping address. The artifact must not be mistaken for a dispatch label. */
export function devShippingPdf(labelId: string): Buffer {
  if (!devShippingId(labelId)) throw new Error('dev_shipping_label_id_invalid');
  const contents = `BT /F1 22 Tf 24 385 Td (SECONDE DEV - TEST) Tj 0 -40 Td /F1 16 Tf (NON EXPEDIABLE) Tj 0 -35 Td /F1 11 Tf (AUCUN TRANSPORTEUR - AUCUNE ASSURANCE) Tj 0 -30 Td (${labelId}) Tj 0 -25 Td (Simulation du parcours de commande uniquement.) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(contents)} >>\nstream\n${contents}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
async function labelDocument(labelId: string) {
  const bucket = resources!.storage.bucket(), filePath = `dev-commerce-labels/${labelId}.pdf`, token = randomUUID();
  await bucket.file(filePath).save(devShippingPdf(labelId), { resumable: false, contentType: 'application/pdf',
    metadata: { cacheControl: 'private,max-age=0', metadata: { firebaseStorageDownloadTokens: token, simulation: DEV_SHIPPING_PROTOCOL } } });
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}
async function read(value: string) {
  if (!devShippingId(value)) throw new Error('dev_shipping_identity_invalid');
  const record = (await ref(value).get()).data();
  if (!record || record.protocol !== DEV_SHIPPING_PROTOCOL || record.realShipment !== false) throw new Error('dev_shipping_record_missing');
  return record;
}
async function createQuote(rawShipment: any) {
  assertQuebec(rawShipment?.ship_from); assertQuebec(rawShipment?.ship_to);
  simulatedPrice(rawShipment);
  const shipmentId = id(), rateId = id(), createdAt = new Date().toISOString();
  const shipment = { ...rawShipment, shipment_id: shipmentId, is_return: rawShipment.is_return === true, created_at: createdAt,
    carrier_id: DEV_SHIPPING_SERVICE.carrierId, service_code: DEV_SHIPPING_SERVICE.serviceCode, simulation: metadata };
  const quote = { shipment_id: shipmentId, status: 'completed', errors: [], rates: [rate(shipment, rateId)], created_at: createdAt,
    ship_from: shipment.ship_from, ship_to: shipment.ship_to, packages: shipment.packages, is_return: shipment.is_return };
  const inputHash = createHash('sha256').update(JSON.stringify(rawShipment)).digest('hex');
  const record = { ...metadata, kind: 'shipment', shipment, quote, rateId, labelId: null, createdAtMs: Date.now(), inputHash };
  const externalRef = typeof rawShipment.external_shipment_id === 'string'
    ? resources!.db.collection('dev_shipping_external_ids').doc(createHash('sha256').update(rawShipment.external_shipment_id).digest('hex')) : null;
  return resources!.db.runTransaction(async tx => {
    const external = externalRef ? (await tx.get(externalRef)).data() : null;
    if (external) {
      const existing = (await tx.get(ref(external.shipmentId))).data();
      if (external.protocol !== DEV_SHIPPING_PROTOCOL || !existing || existing.inputHash !== inputHash)
        throw new Error('dev_shipping_external_id_source_changed');
      return existing;
    }
    tx.create(ref(shipmentId), record); tx.create(ref(rateId), { ...metadata, kind: 'rate', shipmentId });
    if (externalRef) tx.create(externalRef, { ...metadata, externalId: rawShipment.external_shipment_id, shipmentId });
    return record;
  });
}
async function createLabel(record: any, options: any = {}) {
  if (record.labelId) return (await read(record.labelId)).label;
  const labelId = id(), href = await labelDocument(labelId), shipment = record.shipment, createdAt = new Date().toISOString();
  const label = { label_id: labelId, shipment_id: shipment.shipment_id, rate_id: record.rateId,
    carrier_id: DEV_SHIPPING_SERVICE.carrierId, carrier_code: DEV_SHIPPING_SERVICE.carrierCode, service_code: DEV_SHIPPING_SERVICE.serviceCode,
    status: 'completed', voided: false, is_return_label: shipment.is_return === true,
    ...(options.outbound_label_id ? { outbound_label_id: options.outbound_label_id } : {}), label_format: 'pdf',
    tracking_number: 'DEV' + labelId.slice('se-devsim-'.length).toUpperCase(), label_download: { href, pdf: href },
    created_at: createdAt, shipment_cost: cad(simulatedPrice(shipment)), insurance_cost: cad(0), simulation: metadata };
  return resources!.db.runTransaction(async tx => {
    const current = (await tx.get(ref(shipment.shipment_id))).data();
    if (!current || current.protocol !== DEV_SHIPPING_PROTOCOL) throw new Error('dev_shipping_shipment_missing');
    if (current.labelId) return (await tx.get(ref(current.labelId))).data()!.label;
    tx.create(ref(labelId), { ...metadata, kind: 'label', label, status: 'NY', events: [], createdAtMs: Date.parse(createdAt) });
    tx.update(ref(shipment.shipment_id), { labelId });
    return label;
  });
}
export async function devShippingRequest(method: string, endpoint: string, body?: any): Promise<unknown> {
  requireDevShippingRuntime();
  resources ??= await import('./firebase');
  const url = new URL(endpoint, 'https://dev-shipping.invalid'), path = url.pathname, part = path.split('/').filter(Boolean);
  if (method === 'GET' && path === '/v1/carriers') return { carriers: [{ carrier_id: DEV_SHIPPING_SERVICE.carrierId, carrier_code: DEV_SHIPPING_SERVICE.carrierCode, connection_status: 'approved' }] };
  if (method === 'POST' && path === '/v1/rates/estimate') {
    assertQuebec({ country_code: body.from_country_code, state_province: body.from_state_province, postal_code: body.from_postal_code });
    assertQuebec({ country_code: body.to_country_code, state_province: body.to_state_province, postal_code: body.to_postal_code });
    return [{ ...rate({ shipment_id: id(), packages: [{ weight: body.weight, dimensions: body.dimensions }] }, id()) }];
  }
  if (method === 'POST' && path === '/v1/rates') return { rate_response: (await createQuote(body.shipment)).quote };
  if (method === 'GET' && part[1] === 'shipments' && part[2] === 'external_shipment_id') {
    const map = (await resources!.db.collection('dev_shipping_external_ids').doc(createHash('sha256').update(decodeURIComponent(part[3] ?? '')).digest('hex')).get()).data();
    if (!map || map.protocol !== DEV_SHIPPING_PROTOCOL) throw new Error('dev_shipping_external_id_missing');
    return (await read(map.shipmentId)).shipment;
  }
  if (method === 'GET' && part[1] === 'shipments') { const record = await read(part[2]); return part[3] === 'rates' ? record.quote : record.shipment; }
  if (method === 'POST' && part[1] === 'labels' && part[2] === 'rates') { const rateRecord = await read(part[3]); return createLabel(await read(rateRecord.shipmentId)); }
  if (method === 'POST' && path === '/v1/labels') return createLabel(await createQuote(body.shipment), body);
  if (method === 'GET' && path === '/v1/labels') { const record = await read(url.searchParams.get('shipment_id') ?? '');
    if (url.searchParams.has('rate_id') && url.searchParams.get('rate_id') !== record.rateId) throw new Error('dev_shipping_rate_mismatch');
    return { labels: record.labelId ? [(await read(record.labelId)).label] : [], total: record.labelId ? 1 : 0, pages: 1 }; }
  if (part[1] === 'labels') {
    const record = await read(part[2]);
    if (method === 'GET' && part[3] === 'track') return { tracking_number: record.label.tracking_number, carrier_code: DEV_SHIPPING_SERVICE.carrierCode,
      status_code: record.status, status_description: 'Simulation Seconde Dev — aucun colis réel', events: record.events,
      ...(record.status === 'DE' ? { actual_delivery_date: record.events.at(-1)?.occurred_at } : {}), simulation: metadata };
    if (method === 'GET' && part.length === 3) return record.label;
    if (method === 'PUT' && part[3] === 'void') return resources!.db.runTransaction(async tx => {
      const current = (await tx.get(ref(part[2]))).data();
      if (!current || current.protocol !== DEV_SHIPPING_PROTOCOL) throw new Error('dev_shipping_label_missing');
      if (current.status !== 'NY') return { approved: false, message: 'Simulation : colis déjà avancé.', reason_code: 'already_dispatched' };
      tx.update(ref(part[2]), { 'label.voided': true, 'label.refund_status': 'approved' });
      return { approved: true, message: 'Étiquette de test annulée ; aucun paiement transporteur réel.' };
    });
  }
  throw new Error('dev_shipping_operation_not_supported');
}
export async function advanceDevShipping(tx: FirebaseFirestore.Transaction, labelId: string, action: 'in_transit' | 'delivered', actorId: string) {
  requireDevShippingRuntime();
  resources ??= await import('./firebase');
  if (!devShippingId(labelId)) throw new HttpsError('failed-precondition', 'Étiquette de test requise.');
  const labelRef = ref(labelId), record = (await tx.get(labelRef)).data();
  if (!record || record.protocol !== DEV_SHIPPING_PROTOCOL || record.kind !== 'label' || record.label?.voided !== false) throw new HttpsError('failed-precondition', 'Étiquette de test indisponible.');
  const next = action === 'in_transit' ? 'IT' : 'DE';
  if (record.status === next || record.status === 'DE' && next === 'IT') return false;
  if (record.status !== (action === 'in_transit' ? 'NY' : 'IT')) throw new HttpsError('failed-precondition', 'Simulez d’abord la prise en charge du colis.');
  const occurredAt = new Date().toISOString();
  tx.update(labelRef, { status: next, events: [...record.events, { occurred_at: occurredAt, status_code: next,
    description: action === 'in_transit' ? 'Prise en charge simulée — Seconde Dev' : 'Livraison simulée — Seconde Dev',
    state_province: 'QC', simulation: metadata }], lastActorId: actorId });
  return true;
}
