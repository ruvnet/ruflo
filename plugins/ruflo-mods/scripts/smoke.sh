#!/usr/bin/env bash
# Structural + security smoke for ruflo-mods v0.1.1 (ADR-404).
# Static only: CI has no Claude Code, so the hooks module's behaviour is held
# by v3/@claude-flow/cli/__tests__/mods/*.test.ts and, where function hooks are
# on, by `claude plugin test plugins/ruflo-mods`.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }
HOOKS="$ROOT/hooks"

step "1. plugin.json declares ruflo-mods 0.1.1"
grep -q '"name": "ruflo-mods"' "$ROOT/.claude-plugin/plugin.json" \
  && grep -q '"version": "0.1.1"' "$ROOT/.claude-plugin/plugin.json" && ok || bad "name/version"

step "2. hooks.json names exactly one module and no classic hook commands"
grep -q '"modules": \["./register.ts"\]' "$HOOKS/hooks.json" && ! grep -q '"command"' "$HOOKS/hooks.json" \
  && ok || bad "hooks.json must be modules-only"

step "3. no import reaches outside the plugin folder"
# Modules live at most one folder below hooks/, so `../../` already leaves
# hooks/; the engine refuses anything outside the plugin, this keeps it to hooks/.
deep=$(grep -rnE "from ['\"](\.\./){2,}" "$HOOKS" || true)
[[ -z "$deep" ]] && ok || bad "$deep"

step "4. no network, process, model or MCP calls (no network by default)"
hits=$(grep -rnE '\$\.(http|process|model|mcp)\.' "$HOOKS" || true)
[[ -z "$hits" ]] && ok || bad "$hits"

step "5. only the documented events are hooked"
events=$(grep -rhoE "on\('[a-z.*]+'" "$HOOKS" | sort -u | tr '\n' ' ')
expected="on('agent.spawn' on('command.run' on('engine.create' on('plugin.register' on('prompt.submit' on('session.end' on('session.measure' on('session.start' on('tool.call' on('tool.check' on('turn.complete' "
[[ "$events" == "$expected" ]] && ok || bad "got: $events"

step "6. tool.check merges with stricter() (tighten-only)"
grep -q "stricter(chain" "$HOOKS/guard/index.ts" && ! grep -qE "decision: 'allow'" "$HOOKS/guard/index.ts" "$HOOKS/guard/policy.ts" \
  && ok || bad "guard must never answer allow of its own"

step "7. the only environment variable written is the handshake"
envw=$(grep -rhoE "\\\$\.env\.set\('[A-Z_]+'" "$HOOKS" | sort -u | tr '\n' ' ')
[[ "$envw" == "\$.env.set('RUFLO_MODS_OWNS' " ]] && ok || bad "got: $envw"

step "8. no secrets or credentials in the module"
sec=$(grep -rniE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}" "$HOOKS" || true)
[[ -z "$sec" ]] && ok || bad "$sec"

step "9. every hooks file is under 500 lines"
long=$(find "$HOOKS" -name '*.ts' -exec awk 'END { if (NR > 500) print FILENAME }' {} \;)
[[ -z "$long" ]] && ok || bad "$long"

step "10. the \$.ruflo contract is declared and flat (one input per method)"
grep -q '"types": "./types/index.d.ts"' "$ROOT/.claude-plugin/plugin.json" \
  && grep -q "ruflo: Ruflo" "$ROOT/types/index.d.ts" \
  && ! grep -qE "^\s+[a-z]+: \{" "$ROOT/types/index.d.ts" && ok || bad "types/index.d.ts must declare a flat Ruflo noun"

printf "\n%d passed, %d failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
