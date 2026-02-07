import { describe, it, expect } from 'vitest';
import { generateSettings } from '../src/init/settings-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

function getEditHookCommand(settings: Record<string, unknown>, event: 'PreToolUse' | 'PostToolUse'): string {
  const hooks = settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  const eventHooks = hooks[event];
  return eventHooks[0].hooks[0].command;
}

function getHookTimeout(
  settings: Record<string, unknown>,
  event: 'PreToolUse' | 'SessionStart',
  hookIndex = 0
): number {
  const hooks = settings.hooks as Record<string, Array<{ hooks: Array<{ timeout: number }> }>>;
  return hooks[event][0].hooks[hookIndex].timeout;
}

describe('settings-generator hooks commands', () => {
  it('uses direct pre-edit command without file-path shell guard', () => {
    const settings = generateSettings({ ...DEFAULT_INIT_OPTIONS }) as Record<string, unknown>;
    const command = getEditHookCommand(settings, 'PreToolUse');

    expect(command).toContain('hooks pre-edit --file "$TOOL_INPUT_file_path"');
    expect(command).not.toContain('[ -n "$TOOL_INPUT_file_path" ] &&');
  });

  it('uses direct post-edit command without file-path shell guard', () => {
    const settings = generateSettings({ ...DEFAULT_INIT_OPTIONS }) as Record<string, unknown>;
    const command = getEditHookCommand(settings, 'PostToolUse');

    expect(command).toContain('hooks post-edit --file "$TOOL_INPUT_file_path"');
    expect(command).not.toContain('[ -n "$TOOL_INPUT_file_path" ] &&');
  });

  it('uses 10000ms as default hook timeout for generated PreToolUse hooks', () => {
    const settings = generateSettings({ ...DEFAULT_INIT_OPTIONS }) as Record<string, unknown>;
    expect(getHookTimeout(settings, 'PreToolUse')).toBe(10000);
  });

  it('uses configured default timeout for SessionStart daemon hook', () => {
    const settings = generateSettings({ ...DEFAULT_INIT_OPTIONS }) as Record<string, unknown>;
    expect(getHookTimeout(settings, 'SessionStart', 0)).toBe(10000);
  });
});
