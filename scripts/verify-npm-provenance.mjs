#!/usr/bin/env node
/**
 * ADR-545: check one npm version's SLSA provenance before it is promoted.
 *
 * stdin: the registry response of /-/npm/v1/attestations/<pkg>@<version>
 * env:   INTEGRITY    the verified archive's sha512 SRI integrity (required)
 *        EXPECT_REPO  the source repository (default https://github.com/ruvnet/ruflo)
 *
 * Exits 0 only when a SLSA v1 provenance attestation exists whose subject
 * digest is exactly that archive and whose build ran in that repository.
 * This checks the statement npm stored; the sigstore signature over it is
 * checked by `npm audit signatures` on install.
 */
const SLSA_V1 = 'https://slsa.dev/provenance/v1';

export function checkProvenance(body, integrity, expectRepo = 'https://github.com/ruvnet/ruflo') {
  if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(integrity ?? '')) return { ok: false, reason: 'INTEGRITY is not a sha512 SRI value' };
  const wantDigest = Buffer.from(integrity.slice(7), 'base64').toString('hex');
  let parsed;
  try {
    parsed = typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return { ok: false, reason: 'attestations response is not JSON' };
  }
  const list = Array.isArray(parsed?.attestations) ? parsed.attestations : [];
  const provenance = list.filter((a) => a?.predicateType === SLSA_V1);
  if (provenance.length === 0) return { ok: false, reason: 'no SLSA v1 provenance attestation' };
  const reasons = [];
  for (const att of provenance) {
    let statement;
    try {
      statement = JSON.parse(Buffer.from(att.bundle?.dsseEnvelope?.payload ?? '', 'base64').toString('utf8'));
    } catch {
      reasons.push('unreadable DSSE payload');
      continue;
    }
    const digests = (statement?.subject ?? []).map((s) => s?.digest?.sha512);
    if (!digests.includes(wantDigest)) {
      reasons.push('subject digest does not match the verified archive');
      continue;
    }
    const repo = statement?.predicate?.buildDefinition?.externalParameters?.workflow?.repository;
    if (repo !== expectRepo) {
      reasons.push(`built in ${repo ?? 'an unknown repository'}, expected ${expectRepo}`);
      continue;
    }
    return { ok: true, reason: `SLSA v1 provenance from ${repo}` };
  }
  return { ok: false, reason: reasons.join('; ') };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    const r = checkProvenance(input, process.env.INTEGRITY, process.env.EXPECT_REPO || undefined);
    (r.ok ? console.log : console.error)(`provenance: ${r.ok ? 'ok' : 'FAIL'} - ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  });
}
