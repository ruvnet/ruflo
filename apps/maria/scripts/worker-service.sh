#!/usr/bin/env bash
# Installe le worker MarIA comme service systemd utilisateur : il démarre avec la session (ou la machine,
# avec « linger »), redémarre tout seul en cas de plantage, et ses journaux vont dans journalctl.
#
#   npm run service -- install     installe (ou met à jour) et démarre le service
#   npm run service -- restart     redémarre (après un git pull)
#   npm run service -- status      état du service
#   npm run service -- logs        suit les journaux (Ctrl+C pour quitter)
#   npm run service -- uninstall   arrête et supprime le service
#   npm run service -- print       affiche le fichier de service sans rien installer
set -euo pipefail

NAME=maria-worker
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/$NAME.service"

unit() {
  local node claude path_dirs
  node="$(command -v node || true)"
  [ -n "$node" ] || { echo "node introuvable dans le PATH (nvm use 22 ?)" >&2; exit 1; }
  local major
  major="$("$node" -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 22 ] || { echo "Node $("$node" -v) détecté : Node 22 ou plus requis (nvm use 22)." >&2; exit 1; }
  claude="$(command -v claude || true)"
  [ -n "$claude" ] || echo "Attention : « claude » introuvable dans le PATH ; le worker ne pourra pas lancer de mission." >&2
  [ -f "$APP_DIR/.env.local" ] || echo "Attention : $APP_DIR/.env.local absent ; le worker ne démarrera pas sans lui." >&2
  [ -f "$APP_DIR/node_modules/tsx/dist/cli.mjs" ] || { echo "Dépendances absentes : lance « npm install » dans $APP_DIR." >&2; exit 1; }

  # systemd ne lit pas ~/.bashrc : on fige le PATH actuel (node de nvm, claude, git, npx pour Ruflo).
  path_dirs="$(dirname "$node")"
  [ -n "$claude" ] && path_dirs="$path_dirs:$(dirname "$(readlink -f "$claude")"):$(dirname "$claude")"
  path_dirs="$path_dirs:/usr/local/bin:/usr/bin:/bin"

  cat <<UNIT
[Unit]
Description=MarIA worker (missions Claude Code)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
Environment=PATH=$path_dirs
Environment=NODE_NO_WARNINGS=1
ExecStart=$node $APP_DIR/node_modules/tsx/dist/cli.mjs $APP_DIR/worker/index.ts
# Arrêt propre : seul le worker reçoit SIGTERM et termine ses missions, le reste est tué après le délai.
KillMode=mixed
TimeoutStopSec=30
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
UNIT
}

case "${1:-}" in
  install)
    mkdir -p "$UNIT_DIR"
    unit > "$UNIT"
    systemctl --user daemon-reload
    systemctl --user enable --now "$NAME"
    systemctl --user restart "$NAME"
    echo "Service installé : $UNIT"
    if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
      echo "Pour qu'il tourne aussi quand tu n'es pas connecté (et dès le démarrage du PC) :"
      echo "  sudo loginctl enable-linger $USER"
    fi
    echo "Journaux : npm run service -- logs"
    ;;
  restart) systemctl --user restart "$NAME" && systemctl --user --no-pager status "$NAME" | head -5 ;;
  status) systemctl --user --no-pager status "$NAME" ;;
  logs) journalctl --user -u "$NAME" -f -n 100 ;;
  uninstall)
    systemctl --user disable --now "$NAME" 2>/dev/null || true
    rm -f "$UNIT"
    systemctl --user daemon-reload
    echo "Service supprimé."
    ;;
  print) unit ;;
  *)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
