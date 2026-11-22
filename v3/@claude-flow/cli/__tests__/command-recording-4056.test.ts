/**
 * #4056 — the PostToolUse Bash hook stored every command in full as
 * `commands/cmd-<ts>`: 27k rows / 285 MB on one project, full command text
 * (which can carry tokens), and no off switch.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  commandRecordingDisabled,
  redactCommandForStorage,
  MAX_RECORDED_COMMAND_CHARS,
} from '../src/services/command-recording.js';

describe('commandRecordingDisabled', () => {
  let cwd: string;
  beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-rec-4056-')); });
  afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

  it('is on by default', () => {
    expect(commandRecordingDisabled({}, cwd)).toBe(false);
  });

  it.each(['0', 'false', 'off', 'no', 'FALSE'])('CLAUDE_FLOW_HOOKS_RECORD_COMMANDS=%s turns it off', v => {
    expect(commandRecordingDisabled({ CLAUDE_FLOW_HOOKS_RECORD_COMMANDS: v }, cwd)).toBe(true);
  });

  it.each(['1', 'true', 'on'])('CLAUDE_FLOW_HOOKS_RECORD_COMMANDS=%s leaves it on', v => {
    expect(commandRecordingDisabled({ CLAUDE_FLOW_HOOKS_RECORD_COMMANDS: v }, cwd)).toBe(false);
  });

  it('honours CLAUDE_FLOW_HOOKS_ENABLED=false (written into generated settings but never read before)', () => {
    expect(commandRecordingDisabled({ CLAUDE_FLOW_HOOKS_ENABLED: 'false' }, cwd)).toBe(true);
    expect(commandRecordingDisabled({ CLAUDE_FLOW_HOOKS_ENABLED: 'true' }, cwd)).toBe(false);
  });

  it('honours hooks.recordCommands=false in claude-flow.config.json', () => {
    fs.writeFileSync(path.join(cwd, 'claude-flow.config.json'), JSON.stringify({ hooks: { recordCommands: false } }));
    expect(commandRecordingDisabled({}, cwd)).toBe(true);
  });

  it('honours hooks.recordCommands=false in .claude-flow/config.json', () => {
    fs.mkdirSync(path.join(cwd, '.claude-flow'));
    fs.writeFileSync(path.join(cwd, '.claude-flow', 'config.json'), JSON.stringify({ hooks: { recordCommands: false } }));
    expect(commandRecordingDisabled({}, cwd)).toBe(true);
  });

  it('a malformed config file does not turn recording off or throw', () => {
    fs.writeFileSync(path.join(cwd, 'claude-flow.config.json'), '{ not json');
    expect(commandRecordingDisabled({}, cwd)).toBe(false);
  });
});

describe('redactCommandForStorage', () => {
  const GH = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  const OAI = 'sk-' + 'proj-abcdefghijklmnopqrstuvwxyz0123456789';
  // Google API key shape: "AIza" + 35 chars. Built by concatenation so secret scanners skip the fixture.
  const GOOG = 'AI' + 'za' + 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q';
  // Cognitum key shape: "cog_" + 64 lowercase hex (randomBytes(32).toString('hex')).
  const COG = 'cog_' + '0123456789abcdef'.repeat(4);
  const FAKE = 'fake' + 'Secret0123456789';
  const XAK = 'x-api' + '-key';
  const SIGNUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?';
  const CB_TOKEN = 'tok_' + 'abcdef0123456789';
  const GOOG_HEADER = 'X-Goog-' + 'Api-Key';

  it('leaves an ordinary command alone', () => {
    expect(redactCommandForStorage('npm test -- --run src/foo.test.ts')).toBe('npm test -- --run src/foo.test.ts');
  });

  it.each([
    ['curl -H "Authorization: Bearer abc123def456ghi789" https://x.test', 'abc123def456ghi789'],
    ['curl -H "authorization: Basic dXNlcjpwYXNz" https://x.test', 'dXNlcjpwYXNz'],
    ['tool --password=hunter2hunter2 run', 'hunter2hunter2'],
    ['tool --token abcdef0123456789 run', 'abcdef0123456789'],
    ['tool --api-key "sekrit-value-123" run', 'sekrit-value-123'],
    ['NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz0123 npm publish', 'npm_abcdefghijklmnopqrstuvwxyz0123'],
    ['AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY aws s3 ls', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    [`git clone https://${GH}@github.com/o/r.git`, GH],
    [`curl -s https://api.openai.com -d x -H "x-key: ${OAI}"`, OAI],
    ['psql postgres://admin:s3cretpass@db.internal/app', 's3cretpass'],
    // Provider keys that travel outside an Authorization header.
    ['wget -qO- "' + SIGNUP_URL + 'key=' + GOOG + '"', GOOG],
    ['http GET https://generativelanguage.googleapis.com/v1/models "' + GOOG_HEADER + ': ' + GOOG + '"', GOOG],
    [`echo ${GOOG} | wc -c`, GOOG],
    [`http GET https://api.example.test/v1/usage "x-api-key: ${COG}"`, COG],
    [`wget --header='X-API-Key: plainvalue0123456789' https://x.test`, 'plainvalue0123456789'],
    [`echo ${COG} > /dev/null`, COG],
    ['curl "https://x.test/v1/items?limit=5&api_key=abcdef0123456789xyz&page=2"', 'abcdef0123456789xyz'],
    ['curl "https://x.test/cb?access' + '_token=' + CB_TOKEN + '"', CB_TOKEN],
    [`echo prefix_${COG}`, COG],
    // Quoted values in headers and bodies.
    [`node -e 'fetch(u,{headers:{"${XAK}":"${FAKE}"}})'`, FAKE],
    [`node -e "fetch(u,{headers:{'${GOOG_HEADER}':'${FAKE}'}})"`, FAKE],
    [`node -e 'fetch(u,{headers:{"Authorization":"Bearer ${FAKE}"}})'`, FAKE],
    [`wget --post-data '{"api` + `_key":"${FAKE}"}' https://x.test`, FAKE],
    [`node -e 'post({"api` + `Key": "${FAKE}"})'`, FAKE],
    [`python3 -c "requests.get(u, params={'key': '${FAKE}'})"`, FAKE],
    // Form bodies.
    [`http -f POST https://x.test -d key=${FAKE} u`, FAKE],
    [`wget https://x.test -d "api` + `_key=${FAKE}"`, FAKE],
    [`http POST https://x.test --data-urlencode "key=${FAKE}"`, FAKE],
    [`http POST https://x.test apikey=${FAKE}`, FAKE],
    // More header names, with and without a scheme.
    [`http GET https://x.test "apikey: ${FAKE}"`, FAKE],
    [`http GET https://x.test "Api-Key: ${FAKE}"`, FAKE],
    [`http GET https://x.test "Ocp-Apim-Subscription-Key: ${FAKE}"`, FAKE],
    [`http GET https://x.test "Private-Token: ${FAKE}"`, FAKE],
    [`http GET https://x.test "X-Auth-Key: ${FAKE}"`, FAKE],
    [`http GET https://x.test "x-access-token: token ${FAKE}"`, FAKE],
    [`http GET https://x.test "${XAK}: Bearer ${FAKE}"`, FAKE],
  ])('redacts the secret in: %s', (cmd, secret) => {
    const out = redactCommandForStorage(cmd);
    expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
  });

  it('keeps the command name and flags so history is still useful', () => {
    const out = redactCommandForStorage('curl -H "Authorization: Bearer abc123def456ghi789" https://x.test/api');
    expect(out).toContain('curl');
    expect(out).toContain('https://x.test/api');
  });

  it('truncates a very long command and says so', () => {
    const out = redactCommandForStorage('echo ' + 'a'.repeat(MAX_RECORDED_COMMAND_CHARS * 3));
    expect(out.length).toBeLessThanOrEqual(MAX_RECORDED_COMMAND_CHARS + 32);
    expect(out).toMatch(/truncated/);
  });

  it.each([
    'curl "https://x.test/v1/items?sort_key=abc"',
    'curl "https://x.test/v1/items?token=nextpage123"',
    'grep -rn x-api-key src',
    'grep -r cog_RegistryEntriesTotalCountMetric src',
    'curl https://x.test/v1/items?limit=5&page=2',
  ])('leaves a non-secret command unchanged: %s', cmd => {
    expect(redactCommandForStorage(cmd)).toBe(cmd);
  });

  it('redacts only the credential parameter and keeps the rest of the URL', () => {
    const fake = 'abcdef' + '0123456789xyz';
    expect(redactCommandForStorage(`curl "https://x.test/v1/items?limit=5&api_key=${fake}&page=2"`))
      .toBe('curl "https://x.test/v1/items?limit=5&api_key=[redacted]&page=2"');
  });

  it('redacts a bare ?key= parameter (Google/Firebase keys travel that way), accepting the over-redaction', () => {
    expect(redactCommandForStorage('curl "https://x.test/v1/items?key=abc&page=2"'))
      .toBe('curl "https://x.test/v1/items?key=[redacted]&page=2"');
  });

  it('keeps the colon of a spaced header and does not let the flag rule eat it', () => {
    expect(redactCommandForStorage(`wget --header "${XAK} :abc" https://x.test`))
      .toBe(`wget --header "${XAK} :[redacted]" https://x.test`);
  });

  it('still redacts a real --api-key flag', () => {
    expect(redactCommandForStorage('tool --api-key abc123 run')).toBe('tool --api-key [redacted] run');
  });

  it('is linear on hostile input (no catastrophic backtracking)', () => {
    for (const hostile of [
      'x'.repeat(200_000),
      '--password '.repeat(20_000),
      'A=b '.repeat(50_000),
      'Authorization: '.repeat(20_000),
      '://'.repeat(60_000),
      'x-api-key: '.repeat(20_000),
      '?key='.repeat(40_000),
      '&api_key=a'.repeat(30_000),
      'AIza'.repeat(50_000),
      'cog_'.repeat(50_000),
      'a'.repeat(100) + 'cog_' + 'a'.repeat(200_000),
      '{"api_key":"'.repeat(20_000),
      '{"api_key":"' + 'x'.repeat(200_000),
      "'key': '".repeat(20_000),
      '-d key='.repeat(30_000),
      '--data-urlencode '.repeat(10_000) + 'x',
      '-d ' + ' '.repeat(200_000) + 'x',
      ' api_key='.repeat(30_000),
      'Private-Token: '.repeat(20_000),
      'x-access-token: token '.repeat(10_000),
      'Ocp-Apim-Subscription-Key:'.repeat(10_000),
    ]) {
      const t0 = Date.now();
      redactCommandForStorage(hostile);
      expect(Date.now() - t0).toBeLessThan(500);
    }
  });
});
