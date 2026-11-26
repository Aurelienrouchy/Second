import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Firestore, FieldValue, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { dateOfBirthCopy, dateOfBirthIdentity, eligibilityVersion, evaluateEligibility } from './eligibility';
const require = createRequire(import.meta.url);
const { encode } = require(path.resolve(path.dirname(require.resolve('firebase-functions')), '../common/providers/https.js'));
const db = new Firestore({ projectId: 'demo-second' });
const otherProject = new Firestore({ projectId: 'demo-second-other' });
const otherDatabase = new Firestore({ projectId: 'demo-second', databaseId: 'other-local' });
const version = (dob: any) => eligibilityVersion({ user: { dateOfBirth: dob }, profile: null });
describe('native DOB copies and exact private identity', () => {
  it('references retain full project/database/path and equivalent local clients agree without SDK graph traversal', () => {
    const references = [db.doc('users/one'), db.doc('users/two'), otherProject.doc('users/one'), otherDatabase.doc('users/one')];
    expect(new Set(references.map(version)).size).toBe(4);
    expect(dateOfBirthCopy(references[0])).toEqual({ type: 'document_reference', value: 'projects/demo-second/databases/(default)/documents/users/one', context: 'sdk_observed_reference' });
    expect(dateOfBirthIdentity(references[0])).toEqual(dateOfBirthIdentity(new Firestore({ projectId: 'demo-second' }).doc('users/one')));
    expect(encode(dateOfBirthCopy(references[0]))).toEqual(dateOfBirthCopy(references[0]));
  });
  it('GeoPoint, byte buffers/Uint8Array and vectors are copied through native public accessors', () => {
    const values = [new GeoPoint(45, -73), Buffer.from([0, 255]), new Uint8Array([0, 255]), FieldValue.vector([1.25, 2])];
    expect(values.map(dateOfBirthCopy)).toEqual([{ type: 'geo_point', value: { latitude: 45, longitude: -73 } },
      { type: 'bytes', value: 'AP8=' }, { type: 'bytes', value: 'AP8=' }, { type: 'vector', value: [1.25, 2] }]);
    for (const value of values) expect(encode(dateOfBirthCopy(value))).toEqual(dateOfBirthCopy(value));
    expect(version(Buffer.from([0, 255]))).not.toBe(version(Buffer.from([0, 254])));
    expect(version(new GeoPoint(45, -73))).not.toBe(version(new GeoPoint(46, -73)));
    expect(version(FieldValue.vector([1, 2]))).not.toBe(version(FieldValue.vector([1, 3])));
  });
  it('Timestamp display remains ISO while same-millisecond native identities remain distinct', () => {
    const a = new Timestamp(1000, 1000), b = new Timestamp(1000, 2000);
    expect(dateOfBirthCopy(a)).toEqual(dateOfBirthCopy(b));
    expect(dateOfBirthCopy(a)).toEqual({ type: 'timestamp', value: '1970-01-01T00:16:40.000Z' });
    expect(dateOfBirthIdentity(a)).not.toEqual(dateOfBirthIdentity(b)); expect(version(a)).not.toBe(version(b));
  });
  it('ordinary sorted maps/arrays preserve nested references and distinguish null from empty text', () => {
    const a = { z: [db.doc('users/one'), { reference: otherDatabase.doc('users/two') }], a: '' };
    expect(dateOfBirthCopy(a)).toEqual(dateOfBirthCopy({ a: '', z: a.z }));
    expect(encode(dateOfBirthCopy(a))).toEqual(dateOfBirthCopy(a));
    expect(version(a)).not.toBe(version({ ...a, a: null }));
    expect(version(a)).not.toBe(version({ ...a, z: [db.doc('users/two'), a.z[1]] }));
  });
  it('deep ordinary data is compacted losslessly for storage without aliasing a changed leaf', () => {
    const nested = (leaf: any) => Array.from({ length: 14 }).reduce(value => ({ inner: value }), leaf);
    const a = dateOfBirthCopy(nested(db.doc('users/one')));
    expect(a.type).toBe('serialized_object'); expect(String(a.value)).toContain('documents/users/one');
    expect(JSON.parse(String(a.value)).type).toBe('object');
    expect(version(nested(db.doc('users/one')))).not.toBe(version(nested(db.doc('users/two'))));
    expect(encode(a)).toEqual(a);
  });
  it('JS-only cycles/over-depth/custom classes fail explicitly and repeated noncyclic maps remain data', () => {
    const cycle: any = {}; cycle.self = cycle;
    expect(() => dateOfBirthCopy(cycle)).toThrow('cycle');
    const deep = Array.from({ length: 34 }).reduce(value => ({ inner: value }), {});
    expect(() => dateOfBirthCopy(deep)).toThrow('nesting');
    class NotFirestoreValue { sdkPrivateGraph = cycle; }
    expect(() => dateOfBirthCopy(new NotFirestoreValue())).toThrow('not a supported');
    const shared = { value: true };
    expect(dateOfBirthCopy({ a: shared, b: shared }).type).toBe('object');
  });
  it('all native malformed types remain age_invalid and neither define a first birth nor become trading permission', () => {
    for (const dob of [db.doc('users/one'), new GeoPoint(45, -73), Buffer.from([1]), FieldValue.vector([1]), new Timestamp(1000, 1000)]) {
      const decision = evaluateEligibility({ user: { dateOfBirth: dob }, profile: null }, 'buy');
      expect(decision.allowed).toBe(false); expect(decision.reasons).toContain('age_invalid');
    }
    expect(dateOfBirthCopy(null)).toEqual({ type: 'missing', value: null });
    expect(dateOfBirthIdentity('2000-01-01')).toEqual(dateOfBirthCopy('2000-01-01'));
  });
});
