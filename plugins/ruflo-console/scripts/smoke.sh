#!/usr/bin/env bash
# Structural + security smoke for ruflo-console. Static checks first (CI has no Claude Code), then the pure vitest
# specs. The hooks module's behaviour is held by `claude plugin test plugins/ruflo-console` where function hooks are on.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
HOOKS="$ROOT/hooks"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares ruflo-console 0.33.9"
grep -q '"name": "ruflo-console"' "$ROOT/.claude-plugin/plugin.json" \
  && grep -q '"version": "0.33.9"' "$ROOT/.claude-plugin/plugin.json" && ok || bad "name/version"

step "2. hooks.json names exactly one module and no classic hook commands"
grep -q '"modules": \["./register.ts"\]' "$HOOKS/hooks.json" && ! grep -q '"command"' "$HOOKS/hooks.json" \
  && ok || bad "hooks.json must be modules-only"

step "3. no Node, Buffer or dynamic import in the module"
hits=$(grep -rnE "from ['\"]node:|\bBuffer\b|\bimport\(|require\(" "$HOOKS" || true)
[[ -z "$hits" ]] && ok || bad "$hits"

step "4. no import reaches outside the plugin folder"
deep=$(grep -rnE "from ['\"](\.\./){3,}" "$HOOKS" || true)
[[ -z "$deep" ]] && ok || bad "$deep"

step "5. the module's one network call is the update check's GET (\$.http in register.ts fetchText, used by update-flow.ts alone), and \$ is touched in register.ts only"
# Code lines only: comments may name the calls they explain.
http=$(grep -rnE '\$\.http\.' "$HOOKS" | grep -vE '^[^:]+:[0-9]+:\s*(\*|//|/\*)' || true)
# Exactly one is allowed (ADR-429): it goes through the engine, so an administrator's policy can refuse it, and nothing but update-flow.ts calls fetchText.
extra=$(printf '%s\n' "$http" | grep . | grep -vE '/register\.ts:[0-9]+: *const response = await \$\.http\.fetch\(url\)$' || true)
count=$(printf '%s\n' "$http" | grep -c . || true)
users=$(grep -rlE '\bfetchText\b' "$HOOKS" | grep -vE '/(host|register|update-flow)\.ts$' || true)
outside=$(grep -rnE '\$\.(fs|process|ui|clock|store|env|ruflo|tool|session|settings|command)\.' "$HOOKS" | grep -vE '^[^:]+:[0-9]+:\s*(\*|//|/\*)' | grep -v '/register.ts:' || true)
[[ -z "$extra" && "$count" == "1" && -z "$users" && -z "$outside" ]] && ok || bad "http: $http fetchText used by: $users outside: $outside"

step "6. never runs plugins list or verify (network); roster, registry, claims and sync are the network probes, all behind the federationNetwork option"
cmds=$(grep -nE "args: \['(plugins|verify)'" "$HOOKS/data/cli.ts" || true)
net=$(grep -rc "isNetwork: true" "$HOOKS/data" | awk -F: '{ n += $2 } END { print n }')
[[ -z "$cmds" && "$net" == "4" ]] && grep -q "federationNetwork" "$HOOKS/controller.ts" && ok || bad "cmds: $cmds network probes: $net"

step "7. private key files are never read paths"
# The federation folder is listed for its file names (node ids); a key file's path never reaches fs.read.
keys=$(grep -nE "(key-[^'\"]*\.json|channels\.json|nostr\.key)" "$HOOKS/data/files.ts" | grep -vE "^\s*[0-9]+:\s*(\*|//)|NOSTR_KEY = |test\(entry\.name\)" || true)
grep -q "fs.stat(under(home, NOSTR_KEY))" "$HOOKS/data/files.ts" && [[ -z "$keys" ]] && ok || bad "$keys"

step "8. mutations only through fixed argv (claims_* via JSON.stringify), behind a confirm"
grep -q "JSON.stringify(params)" "$HOOKS/actions.ts" \
  && [[ "$(grep -ohE "exec\('claims_[a-z-]+'" "$HOOKS/actions.ts" "$HOOKS/ops.ts" | sort -u | tr '\n' ' ')" == "exec('claims_claim' exec('claims_handoff' exec('claims_release' exec('claims_status' exec('claims_steal' " ]] \
  && grep -q "state.pending = " "$HOOKS/runner.ts" && ! grep -qE "'(sh|bash)', '-c'" -r "$HOOKS" && ok || bad "action surface changed"

step "9. plugin.register and tool.call are observed, never answered (but the console's own tools, ADR-444)"
reg=$(awk '/on\(.plugin.register./,/^  }\)/' "$HOOKS/register.ts" | grep -cE "refuse:|deny:")
tool=$(awk '/on\(.tool.call./,/^  }\)/' "$HOOKS/register.ts" | grep -cE "deny|result:")
# The one exception: model-tools.ts answers tool.call for the console's own mcp__ruflo-console__ names, nowhere else; tool.check is only ever observed.
others=$(grep -rln "on('tool.call'" "$HOOKS" | grep -vE "/(register|model-tools)\.ts$" || true)
own=$(grep -c "tool: \`\${TOOL_PREFIX}" "$HOOKS/model-tools.ts")
anycall=$(grep -c "on('tool.call'" "$HOOKS/model-tools.ts")
check=$(grep -rln "on('tool.check'" "$HOOKS" | grep -v '/register\.ts$' || true)$(awk '/on\(.tool.check./,/^  }\)/' "$HOOKS/register.ts" | grep -cE "return \{" | grep -v '^0$' || true)
[[ "$reg" == "0" && "$tool" == "0" && -z "$others" && "$own" == "$anycall" && "$anycall" -ge 1 && -z "$check" ]] && ok || bad "plugin.register answers: $reg tool.call answers: $tool; other files: $others; unmatched tool.call in model-tools: $anycall/$own; tool.check: $check"

step "10. no secrets or credentials in the module"
sec=$(grep -rniE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}" "$HOOKS" || true)
[[ -z "$sec" ]] && ok || bad "$sec"

step "11. every source file is under 500 lines"
long=$(find "$HOOKS" "$ROOT/tests" "$ROOT/scripts" -name '*.ts' -not -path '*/fixtures/ruflo-run.ts' -exec awk 'END { if (NR > 500) print FILENAME }' {} \;)
[[ -z "$long" ]] && ok || bad "$long"

step "12. kit tests are in the CI baseline (root vitest cannot resolve claude-code/testing)"
miss=""
for f in "$ROOT"/tests/*.test.ts; do
  grep -qx "plugins/ruflo-console/tests/$(basename "$f")" "$REPO/scripts/ci-test-baseline.txt" || miss="$miss $(basename "$f")"
done
[[ -z "$miss" ]] && ok || bad "not in baseline:$miss"

step "13. marketplace lists ruflo-console"
grep -q '"name": "ruflo-console"' "$REPO/.claude-plugin/marketplace.json" && ok || bad "missing marketplace entry"

step "14. every pure spec passes under vitest"
# On failure keep the failing specs' own lines on stderr: the fleet JSON report captures stderrTail, and this step failed in CI on branches that
# did not touch the console with nothing to read (a load-induced timeout, an order dependency, a missing module?).
if vitest_out=$(cd "$REPO" && npx vitest run plugins/ruflo-console/tests/ --exclude '**/*.test.ts' 2>&1); then ok; else
  bad "vitest specs failed"
  printf '%s\n' "$vitest_out" | grep -E "FAIL|×|AssertionError|Error:|Timeout|timed out|Cannot find|Test Files|Tests " | head -25 >&2
fi

step "15. the live no-spend e2e smoke exists, is executable and skips cleanly without RUFLO_E2E_LIVE"
if [[ -x "$ROOT/scripts/e2e-smoke.sh" ]] && bash "$ROOT/scripts/e2e-smoke.sh" 2>&1 | grep -q '^SKIP'; then ok; else bad "e2e-smoke.sh"; fi

step "16. every view has a matrix entry and an ask entry"
if [[ "$(grep -c "{ id: '[a-z]*', key: '[0-9a-z]*'" "$ROOT/hooks/state.ts")" -eq "$(grep -cE "^  [a-z]+: \{ default:" "$ROOT/hooks/ask-claude.ts" | awk '{print $1 - 1}')" ]]; then ok; else bad "VIEW_ASK does not cover VIEWS"; fi

printf "\n%d passed, %d failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
