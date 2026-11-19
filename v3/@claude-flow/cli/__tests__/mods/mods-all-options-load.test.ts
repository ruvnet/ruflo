/**
 * ruflo-mods must load with EVERY optional module on. A module that is only registered when its option is on can break the whole mod
 * (#4485: rureOffer registered a second `session.start` without a matcher, so Claude Code refused the hooks module and `/ruflo mods`
 * answered "not loaded"), and the default-options tests never see it. The options are read from the manifest, so a new one is covered
 * the day it is added.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { assertLoadable, loadMod, memoryWorld } from './harness';

const manifest = JSON.parse(readFileSync(new URL('../../../../../plugins/ruflo-mods/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
const booleans = Object.entries(manifest.userConfig as Record<string, { type?: string }>).filter(([, spec]) => spec.type === 'boolean').map(([key]) => key);

describe('ruflo-mods loads with every option on (#4485)', () => {
  it('the manifest declares boolean options, including rureOffer', () => {
    expect(booleans.length).toBeGreaterThan(5);
    expect(booleans).toContain('rureOffer');
  });

  it('registers no event twice without a matcher when all options are on', () => {
    const mod = loadMod(register, memoryWorld(), Object.fromEntries(booleans.map((key) => [key, true])));
    expect(() => assertLoadable(mod.regs)).not.toThrow();
  });

  it('each option on its own also loads', () => {
    for (const key of booleans) expect(() => loadMod(register, memoryWorld(), { [key]: true }), key).not.toThrow();
  });

  it('the rule itself: two bare registrations of one event are refused, a matcher or a different event is fine', () => {
    expect(() => assertLoadable([{ event: 'session.start' }, { event: 'session.start' }])).toThrow('registered twice without a matcher');
    expect(() => assertLoadable([{ event: 'session.start' }, { event: 'session.start', matcher: { surface: /x/ } }])).not.toThrow();
    expect(() => assertLoadable([{ event: 'session.start' }, { event: 'turn.complete' }])).not.toThrow();
  });
});
