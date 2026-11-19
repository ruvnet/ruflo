#!/usr/bin/env node
/**
 * ADR-545: the release workflow promotes a version to `latest` only when this
 * check passes. Fixtures model the registry's /-/npm/v1/attestations shape.
 *
 * Run via:  node --test scripts/__tests__/verify-npm-provenance.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkProvenance } from '../verify-npm-provenance.mjs';

const archive = Buffer.from('fake tarball bytes');
const sha512 = createHash('sha512').update(archive);
const integrity = `sha512-${sha512.copy().digest('base64')}`;
const hex = sha512.digest('hex');

const envelope = (statement) => ({ dsseEnvelope: { payloadType: 'application/vnd.in-toto+json', payload: Buffer.from(JSON.stringify(statement)).toString('base64') } });
const statement = ({ digest = hex, repo = 'https://github.com/ruvnet/ruflo' } = {}) => ({
  _type: 'https://in-toto.io/Statement/v1',
  subject: [{ name: 'pkg:npm/ruflo@3.79.0', digest: { sha512: digest } }],
  predicateType: 'https://slsa.dev/provenance/v1',
  predicate: { buildDefinition: { externalParameters: { workflow: { repository: repo, path: '.github/workflows/stable-npm-release.yml' } } } },
});
const body = (...atts) => JSON.stringify({ attestations: atts });
const publishAtt = { predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1', bundle: envelope({}) };

test('passes for a SLSA v1 attestation of exactly this archive from ruvnet/ruflo', () => {
  const r = checkProvenance(body(publishAtt, { predicateType: 'https://slsa.dev/provenance/v1', bundle: envelope(statement()) }), integrity);
  assert.equal(r.ok, true, r.reason);
});

test('fails when only the publish attestation exists (a laptop publish)', () => {
  assert.equal(checkProvenance(body(publishAtt), integrity).ok, false);
});

test('fails on an empty or non-JSON response', () => {
  assert.equal(checkProvenance('{}', integrity).ok, false);
  assert.equal(checkProvenance('not json', integrity).ok, false);
});

test('fails when the attested digest is a different archive', () => {
  const r = checkProvenance(body({ predicateType: 'https://slsa.dev/provenance/v1', bundle: envelope(statement({ digest: 'ab'.repeat(64) })) }), integrity);
  assert.equal(r.ok, false);
  assert.match(r.reason, /digest/);
});

test('fails when the build ran in another repository (a fork)', () => {
  const r = checkProvenance(body({ predicateType: 'https://slsa.dev/provenance/v1', bundle: envelope(statement({ repo: 'https://github.com/someone/ruflo' })) }), integrity);
  assert.equal(r.ok, false);
  assert.match(r.reason, /someone\/ruflo/);
});

test('rejects a missing or malformed INTEGRITY value', () => {
  assert.equal(checkProvenance(body({ predicateType: 'https://slsa.dev/provenance/v1', bundle: envelope(statement()) }), undefined).ok, false);
  assert.equal(checkProvenance(body({ predicateType: 'https://slsa.dev/provenance/v1', bundle: envelope(statement()) }), 'sha1-abc').ok, false);
});
