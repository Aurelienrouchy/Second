/** Pure contracts for the isolated Dev postal-erasure recipe. No Firebase I/O. */
import assert from 'node:assert/strict';
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const time = value => value?.toMillis?.();
export function postalErasurePaths(swapId, ownerId, runId, photoUuid, lateUuid) {
  assert(id(swapId) && id(ownerId) && /^[a-f0-9]{32}$/.test(runId));
  const operatorUuid = `${runId.slice(0,8)}-${runId.slice(8,12)}-${runId.slice(12,16)}-${runId.slice(16,20)}-${runId.slice(20)}`;
  assert(uuid(photoUuid) && uuid(lateUuid) && uuid(operatorUuid) && photoUuid !== lateUuid && ![photoUuid,lateUuid].includes(operatorUuid));
  const prefix = `swaps/${swapId}/photos/${ownerId}/`;
  return {photo: `${prefix}0_${photoUuid}.jpg`, late: `${prefix}3_${lateUuid}.jpg`, operator: `${prefix}2_${operatorUuid}.jpg`};
}
export function terminalPostalProof(source, {swapId, ownerId, peerId, installationId, bucket, bytes}) {
  assert(id(swapId) && id(ownerId) && id(peerId) && ownerId !== peerId);
  assert.equal(source.status, 'completed'); assert.equal(source.exchangeMode, 'shipping');
  assert.equal(source.initiatorId, ownerId); assert.equal(source.receiverId, peerId); assert.equal(source.cashTopUp, null);
  assert(!Object.hasOwn(source, 'financialRecoveryWitness'));
  assert.equal(source.localAgreementWitness?.protocol, 'local_agreement_source_v1');
  assert.equal(source.localAgreementWitness.installationId, installationId);
  assert.equal(source.localAgreementWitness.financialSettlement, 'not_asserted');
  assert.equal(source.localAgreementWitness.ref, `swaps/${swapId}`);
  assert(/^[a-f0-9]{64}$/.test(source.localAgreementWitness.nativeSourceHash));
  const accepted = time(source.acceptedAt), completed = time(source.completedAt);
  assert(Number.isFinite(accepted) && accepted > 0 && Number.isFinite(completed) && completed >= accepted && completed <= Date.now());
  for (const side of ['initiator','receiver']) {
    const sent = time(source[`${side}ShippedAt`]), received = time(source[`${side}ReceivedAt`]);
    assert(Number.isFinite(sent) && sent >= accepted && Number.isFinite(received) && received >= sent && received <= completed);
  }
  const proof = (side, uid) => {
    const value = source[`${side}Photos`];
    assert.equal(value?.userId, uid); assert.equal(value.isValidated, false);
    assert(Array.isArray(value.objects) && value.objects.length > 0 && value.objects.length <= 4 && value.objects.length === value.photos?.length);
    assert(Number.isFinite(time(value.uploadedAt)) && time(value.uploadedAt) >= accepted && time(value.uploadedAt) <= time(source[`${side}ShippedAt`]));
    const seen = new Set();
    return value.objects.map((object, index) => {
      assert.equal(Object.keys(object).sort().join(','), 'contentType,crc32c,generation,path,size');
      assert(object.path.startsWith(`swaps/${swapId}/photos/${uid}/`) && !object.path.slice(`swaps/${swapId}/photos/${uid}/`.length).includes('/'));
      assert(!seen.has(object.path)); seen.add(object.path);
      assert(/^[1-9][0-9]{0,24}$/.test(object.generation)); assert.equal(object.contentType, 'image/jpeg');
      assert.equal(object.size, bytes); assert(/^[A-Za-z0-9+/]{6}==$/.test(object.crc32c));
      const url = new URL(value.photos[index]);
      assert.equal(url.origin, 'https://firebasestorage.googleapis.com');
      assert.equal(url.pathname, `/v0/b/${bucket}/o/${encodeURIComponent(object.path)}`);
      assert.equal(url.search, '?alt=media');
      return {...object};
    });
  };
  return {ownerObjects: proof('initiator', ownerId), peerObjects: proof('receiver', peerId), completedAt: completed};
}
