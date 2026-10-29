/**
 * ADR-509 §2.1 — the ruflo-mods `plugin.register` gate refuses a ruflo plugin
 * whose marketplace clone `ruflo mods doctor` found `modified` or
 * `bad-signature`, only under modTrust: refuse-risky.
 */
import { describe, it, expect } from 'vitest';

import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { marketplaceRefusal } from '../../../../../plugins/ruflo-mods/hooks/trust';
import { loadMod, memoryWorld, type World } from './harness';

const HOME = '/home/u';
const STATUS = `${HOME}/.claude-flow/mods/plugin-verify.json`;
const status = (configDir: string, plugins: Record<string, string>) =>
  JSON.stringify({ version: 1, byConfigDir: { [configDir]: { writtenAt: 'x', clone: '/c', plugins } } });

function worldWith(plugins: Record<string, string> | null, configDir = `${HOME}/.claude`): World {
  const world = memoryWorld();
  world.env.set('HOME', HOME);
  if (plugins) (world.files as Map<string, { text: string; mtimeMs: number }>).set(STATUS, { text: status(configDir, plugins), mtimeMs: 1 });
  return world;
}

// A quiet module: nothing the risk classifier flags, so only the signature check can refuse it.
const quiet = (provenance: string) => ({ name: provenance.split('@')[0], tier: 'user', root: '/x', provenance, uses: { events: ['turn.complete'], calls: ['ui.status'] } });
const admit = () => ({ allow: true });

describe('ADR-509 signature gate in the mod trust hook', () => {
  it('refuse-risky: a modified or bad-signature ruflo clone is refused, even when allow-listed', async () => {
    for (const result of ['modified', 'bad-signature']) {
      const world = worldWith({ 'ruflo-swarm': result });
      const mod = loadMod(register, world, { modTrust: 'refuse-risky', modTrustAllow: 'ruflo-swarm@ruflo' });
      const out = await mod.dispatch('plugin.register', quiet('ruflo-swarm@ruflo'), admit);
      expect(out.refuse).toMatch(new RegExp(`ruflo-swarm@ruflo marketplace clone is ${result}`));
      expect(world.logs.join('\n')).toContain('ADR-509');
    }
  });

  it('refuse-risky: verified, unsigned, absent or unreadable status admits (unknown is not enforced)', async () => {
    for (const plugins of [{ 'ruflo-swarm': 'verified' }, { 'ruflo-swarm': 'unsigned' }, {}, null]) {
      const mod = loadMod(register, worldWith(plugins), { modTrust: 'refuse-risky' });
      expect(await mod.dispatch('plugin.register', quiet('ruflo-swarm@ruflo'), admit)).toEqual({ allow: true });
    }
    const broken = worldWith(null);
    (broken.files as Map<string, { text: string; mtimeMs: number }>).set(STATUS, { text: '{not json', mtimeMs: 1 });
    expect(await loadMod(register, broken, { modTrust: 'refuse-risky' }).dispatch('plugin.register', quiet('ruflo-swarm@ruflo'), admit)).toEqual({ allow: true });
    const failing = worldWith({ 'ruflo-swarm': 'modified' });
    failing.failRead = (p: string) => (p === STATUS ? new Error('EACCES') : undefined);
    expect(await loadMod(register, failing, { modTrust: 'refuse-risky' }).dispatch('plugin.register', quiet('ruflo-swarm@ruflo'), admit)).toEqual({ allow: true });
  });

  it('observe (default) reports nothing new and never refuses on a signature result', async () => {
    const mod = loadMod(register, worldWith({ 'ruflo-swarm': 'modified' }));
    expect(await mod.dispatch('plugin.register', quiet('ruflo-swarm@ruflo'), admit)).toEqual({ allow: true });
  });

  it('only <name>@ruflo user-tier modules, and only the config dir the status was written for', async () => {
    const mod = loadMod(register, worldWith({ 'ruflo-swarm': 'modified' }), { modTrust: 'refuse-risky' });
    expect(await mod.dispatch('plugin.register', quiet('ruflo-swarm@other-market'), admit)).toEqual({ allow: true });
    expect(await mod.dispatch('plugin.register', { ...quiet('ruflo-swarm@ruflo'), tier: 'prepend' }, admit)).toEqual({ allow: true });
    // CLAUDE_CONFIG_DIR picks a different entry: the ~/.claude result does not apply.
    const other = worldWith({ 'ruflo-swarm': 'modified' });
    other.env.set('CLAUDE_CONFIG_DIR', '/elsewhere');
    expect(await loadMod(register, other, { modTrust: 'refuse-risky' }).dispatch('plugin.register', quiet('ruflo-swarm@ruflo'), admit)).toEqual({ allow: true });
    const matching = worldWith({ 'ruflo-swarm': 'modified' }, '/elsewhere');
    matching.env.set('CLAUDE_CONFIG_DIR', '/elsewhere');
    expect((await loadMod(register, matching, { modTrust: 'refuse-risky' }).dispatch('plugin.register', quiet('ruflo-swarm@ruflo'), admit)).refuse).toBeDefined();
  });

  it('marketplaceRefusal is pure and total', () => {
    const text = status('/c', { a: 'modified' });
    expect(marketplaceRefusal(quiet('a@ruflo') as never, text, '/c')).toMatch(/modified/);
    expect(marketplaceRefusal(quiet('a@ruflo') as never, undefined, '/c')).toBeUndefined();
    expect(marketplaceRefusal(quiet('@ruflo') as never, text, '/c')).toBeUndefined();
    expect(marketplaceRefusal(quiet('a@ruflo') as never, '[]', '/c')).toBeUndefined();
  });
});
