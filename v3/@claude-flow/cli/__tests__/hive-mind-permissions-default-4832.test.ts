/**
 * #4832: hive-mind spawn --claude passed --dangerously-skip-permissions by
 * default because the option declared default:true. Permission skipping must
 * require the explicit flag; --no-auto-permissions remains the opt-out.
 */
import { describe, expect, it } from 'vitest';
import { hiveMindCommand } from '../src/commands/hive-mind.js';

function spawnOption(name: string) {
  const spawn = hiveMindCommand.subcommands?.find(sub => sub.name === 'spawn');
  expect(spawn).toBeDefined();
  return spawn!.options?.find(option => option.name === name);
}

describe('hive-mind spawn permission default (#4832)', () => {
  it('does not skip Claude Code permission prompts unless explicitly requested', () => {
    expect(spawnOption('dangerously-skip-permissions')?.default).toBe(false);
  });

  it('keeps the explicit flag available', () => {
    const option = spawnOption('dangerously-skip-permissions');
    expect(option?.type).toBe('boolean');
    expect(option?.description).toMatch(/requires this explicit flag/i);
  });
});
