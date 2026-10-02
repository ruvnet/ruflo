#!/usr/bin/env bash
# Static contract for the mod manager (ADR-406): what the module may and may not do.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS="$ROOT/hooks"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json names ruflo-mods-manager 0.1.0 with cli/refreshSeconds/animate options"
P="$ROOT/.claude-plugin/plugin.json"
grep -q '"name": "ruflo-mods-manager"' "$P" && grep -q '"version": "0.1.0"' "$P" \
  && grep -q '"cli"' "$P" && grep -q '"refreshSeconds"' "$P" && grep -q '"animate"' "$P" && ok || bad "manifest"

step "2. no node: imports, Buffer, process, or dynamic import() in the module"
hits=$(grep -rnE "from 'node:|require\(|\bBuffer\b|[^$.]\bprocess\.|import\(" "$HOOKS" || true)
[[ -z "$hits" ]] && ok || bad "$hits"

step "3. imports stay inside the plugin (claude-code types excepted)"
hits=$(grep -rhoE "from '[^']+'" "$HOOKS" | grep -vE "from '\./|from '\.\./|from 'claude-code'" || true)
[[ -z "$hits" ]] && ok || bad "$hits"

step "4. read-only: no fs.write, env, http, model, mcp or agent calls"
hits=$(grep -rnE '\$\.(fs\.write|env\.|http\.|model\.|mcp\.|agent\.|tool\.)' "$HOOKS" || true)
[[ -z "$hits" ]] && ok || bad "$hits"

step "5. hooks none of ruflo-mods' risky events (tool.check, tool.call, *, classic.*, plugin.register, prompt.compose)"
hits=$(grep -rnE "on\('(tool\.check|tool\.call|\*|classic\.[^']*|plugin\.register|prompt\.compose)'" "$HOOKS" || true)
[[ -z "$hits" ]] && ok || bad "$hits"

step "6. every process.run argv is built in model/argv.ts (no argv literal elsewhere)"
hits=$(grep -rn "run(\[" "$HOOKS" | grep -v "model/argv.ts" || true)
[[ -z "$hits" ]] && ok || bad "$hits"

step "7. hotkeys are one digit or one lowercase letter"
hits=$(grep -rhoE 'hotkey="[^"]*"' "$HOOKS" | grep -vE 'hotkey="[0-9a-z]"' || true)
[[ -z "$hits" ]] && ok || bad "$hits"

step "8. the dialog form: open with focus, closeOnEscape and holdToasts"
grep -q "focus: true, closeOnEscape: true, holdToasts: true" "$HOOKS/controller.ts" && ok || bad "dialog form missing"

step "9. claude plugin validate passes (skipped without claude)"
if command -v claude >/dev/null 2>&1; then
  out=$(claude plugin validate "$ROOT" 2>&1) && echo "$out" | grep -q "Validation passed" && ok || bad "$(echo "$out" | tail -3)"
else
  printf "SKIP (no claude)\n"
fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
