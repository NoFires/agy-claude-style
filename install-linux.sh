#!/usr/bin/env bash
# First-class Linux installer & service manager for AGY Claude Style (agy-claude-style).
# Mirrors the Windows installer.exe and macOS AGY Claude Style.app workflow on Linux:
#   - Deploys runtime files to ${XDG_DATA_HOME:-~/.local/share}/agy-claude-style
#   - Preserves existing config.json on upgrades
#   - Registers & starts systemd --user service (with XDG autostart fallback)
#   - Supports --uninstall, --status, --no-autostart, --no-start, and --install-dir <path>
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/agy-claude-style"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_NAME="agy-claude-style.service"
AUTOSTART_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
AUTOSTART_DESKTOP="$AUTOSTART_DIR/agy-claude-style.desktop"

MODE="install"
AUTOSTART=1
START_DAEMON=1
INSTALL_DIR="${AGY_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall|-u)
      MODE="uninstall"
      shift
      ;;
    --status)
      MODE="status"
      shift
      ;;
    --no-autostart)
      AUTOSTART=0
      shift
      ;;
    --no-start)
      START_DAEMON=0
      shift
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./install-linux.sh [options]

Options:
  --uninstall, -u       Stop watcher, restore native Antigravity UI, and remove installation
  --status              Show installation, service, and live CDP injection status
  --no-autostart        Skip systemd --user / XDG autostart registration
  --no-start            Copy files without starting the watcher process
  --install-dir <path>  Override target directory (default: ~/.local/share/agy-claude-style)
EOF
      exit 0
      ;;
    *)
      echo "[!] Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "[!] Node.js (>= 22) is required on Linux. Please install Node.js 22+ first." >&2
  exit 1
fi

has_systemd_user() {
  command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1
}

stop_existing_watcher() {
  local dir="$1"
  if [[ "$AUTOSTART" -eq 1 ]] && has_systemd_user; then
    systemctl --user stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi
  if [[ -f "$dir/.watch.pid" ]]; then
    local pid
    pid="$(tr -d '[:space:]' < "$dir/.watch.pid" || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 0.2
    fi
    rm -f "$dir/.watch.pid"
  fi
}

if [[ "$MODE" == "status" ]]; then
  echo "[*] Install directory: $INSTALL_DIR"
  if [[ -d "$INSTALL_DIR" && -f "$INSTALL_DIR/inject.js" ]]; then
    echo "[✓] Installed: yes"
    "$NODE_BIN" "$INSTALL_DIR/inject.js" --status || true
  else
    echo "[-] Installed: no"
  fi
  if has_systemd_user && systemctl --user is-active "$SERVICE_NAME" >/dev/null 2>&1; then
    echo "[✓] systemd --user ($SERVICE_NAME): active"
  elif [[ -f "$INSTALL_DIR/.watch.pid" ]] && kill -0 "$(tr -d '[:space:]' < "$INSTALL_DIR/.watch.pid")" >/dev/null 2>&1; then
    echo "[✓] Background watcher PID: $(tr -d '[:space:]' < "$INSTALL_DIR/.watch.pid")"
  else
    echo "[-] Background watcher: inactive"
  fi
  exit 0
fi

if [[ "$MODE" == "uninstall" ]]; then
  echo "[*] Uninstalling AGY Claude Style from $INSTALL_DIR ..."
  if has_systemd_user; then
    systemctl --user disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi
  rm -f "$SYSTEMD_USER_DIR/$SERVICE_NAME" "$AUTOSTART_DESKTOP"
  if has_systemd_user; then
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
  if [[ -f "$INSTALL_DIR/remove.js" ]]; then
    "$NODE_BIN" "$INSTALL_DIR/remove.js" || true
  elif [[ -f "$SRC_DIR/remove.js" ]]; then
    "$NODE_BIN" "$SRC_DIR/remove.js" || true
  fi
  stop_existing_watcher "$INSTALL_DIR"
  if [[ -d "$INSTALL_DIR" && "$INSTALL_DIR" != "$SRC_DIR" ]]; then
    rm -rf "$INSTALL_DIR"
  fi
  echo "[✓] Uninstalled cleanly and restored native Antigravity UI."
  exit 0
fi

echo "[*] Installing AGY Claude Style to $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"

PRESERVED_CONFIG=0
TMP_CFG=""
if [[ -f "$INSTALL_DIR/config.json" ]]; then
  PRESERVED_CONFIG=1
  TMP_CFG="$(mktemp)"
  cp "$INSTALL_DIR/config.json" "$TMP_CFG"
fi

stop_existing_watcher "$INSTALL_DIR"

RUNTIME_FILES=(
  cdp.js
  inject.js
  remove.js
  style.css
  config.example.json
  package.json
  inject.sh
  watch.sh
  remove.sh
  install-linux.sh
)

while IFS= read -r part; do
  [[ -n "$part" ]] && RUNTIME_FILES+=("$part")
done < <("$NODE_BIN" -e 'const cdp = require(process.argv[1]); for (const p of cdp.RUNTIME_PARTS) console.log(p);' "$SRC_DIR/cdp.js")

if [[ "$(cd "$SRC_DIR" && pwd)" != "$(cd "$INSTALL_DIR" && pwd)" ]]; then
  for f in "${RUNTIME_FILES[@]}"; do
    if [[ -f "$SRC_DIR/$f" ]]; then
      cp "$SRC_DIR/$f" "$INSTALL_DIR/$f"
    fi
  done
fi

chmod +x "$INSTALL_DIR/inject.sh" "$INSTALL_DIR/watch.sh" "$INSTALL_DIR/remove.sh" "$INSTALL_DIR/install-linux.sh" 2>/dev/null || true

if [[ "$PRESERVED_CONFIG" -eq 1 && -n "$TMP_CFG" ]]; then
  cp "$TMP_CFG" "$INSTALL_DIR/config.json"
  rm -f "$TMP_CFG"
  echo "[✓] Preserved existing user config.json"
elif [[ ! -f "$INSTALL_DIR/config.json" ]]; then
  if [[ -f "$SRC_DIR/config.json" ]]; then
    cp "$SRC_DIR/config.json" "$INSTALL_DIR/config.json"
  else
    cp "$INSTALL_DIR/config.example.json" "$INSTALL_DIR/config.json"
  fi
fi

if [[ "$AUTOSTART" -eq 1 ]]; then
  if has_systemd_user; then
    mkdir -p "$SYSTEMD_USER_DIR"
    cat > "$SYSTEMD_USER_DIR/$SERVICE_NAME" <<EOF
[Unit]
Description=AGY Claude Style Live CDP Watcher for Google Antigravity
After=graphical-session.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN $INSTALL_DIR/inject.js --watch
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    if [[ "$START_DAEMON" -eq 1 ]]; then
      systemctl --user enable --now "$SERVICE_NAME"
      echo "[✓] Enabled & started systemd --user service: $SERVICE_NAME"
    else
      systemctl --user enable "$SERVICE_NAME"
      echo "[✓] Enabled systemd --user service: $SERVICE_NAME"
    fi
  else
    mkdir -p "$AUTOSTART_DIR"
    cat > "$AUTOSTART_DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=AGY Claude Style Watcher
Comment=Live CDP theme & studio UI injector for Google Antigravity
Exec=$INSTALL_DIR/watch.sh
Terminal=false
Hidden=false
X-GNOME-Autostart-enabled=true
EOF
    echo "[✓] Registered XDG login autostart: $AUTOSTART_DESKTOP"
    if [[ "$START_DAEMON" -eq 1 ]]; then
      (cd "$INSTALL_DIR" && ./watch.sh)
    fi
  fi
elif [[ "$START_DAEMON" -eq 1 ]]; then
  (cd "$INSTALL_DIR" && ./watch.sh)
fi

echo "[✓] AGY Claude Style installed at: $INSTALL_DIR"
