#!/usr/bin/env bash
# First-class Linux full-workstation installer & service manager for AGY Claude Style + Plugins + CLI Suite.
# Deploys in one command:
#   1) AGY Claude Style Studio UI runtime (~/.local/share/agy-claude-style) + systemd --user live watcher
#   2) Full ~/.gemini/config/plugins suite (pi-kit w/ 13 skills + PI Hub sidecar + MCP + Hooks, dev-workflow,
#      coderabbit, context7, gdrive) with automatic Linux $HOME path rewriting & GUI Node shim
#   3) Safe atomic merge of Antigravity Turbo / Sidecar preferences into ~/.gemini/config/config.json
#   4) Companion CLI toolchain (uv + colab CLI + ~/.ssh/config bridge, coderabbit/cr CLI, gdrive Linux binary)
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/agy-claude-style"
DEFAULT_GEMINI_DIR="${AGY_GEMINI_DIR:-$HOME/.gemini}"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_NAME="agy-claude-style.service"
AUTOSTART_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
AUTOSTART_DESKTOP="$AUTOSTART_DIR/agy-claude-style.desktop"

MODE="install"
AUTOSTART=1
START_DAEMON=1
INSTALL_PLUGINS=1
INSTALL_SETTINGS=1
INSTALL_TOOLS=1
INSTALL_SSH_CFG=1
PURGE_PLUGINS=0
INSTALL_DIR="${AGY_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
GEMINI_DIR="$DEFAULT_GEMINI_DIR"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall|-u)
      MODE="uninstall"
      shift
      ;;
    --purge-plugins)
      PURGE_PLUGINS=1
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
    --ui-only|--no-plugins)
      INSTALL_PLUGINS=0
      INSTALL_SETTINGS=0
      INSTALL_TOOLS=0
      INSTALL_SSH_CFG=0
      shift
      ;;
    --no-settings)
      INSTALL_SETTINGS=0
      shift
      ;;
    --no-tools)
      INSTALL_TOOLS=0
      shift
      ;;
    --no-ssh-config)
      INSTALL_SSH_CFG=0
      shift
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --gemini-dir)
      GEMINI_DIR="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./install-linux.sh [options]

Options:
  --uninstall, -u       Stop watcher, restore native Antigravity UI, and remove UI installation
  --purge-plugins       With --uninstall, also remove bundled plugins from ~/.gemini/config/plugins
  --status              Show UI service, CDP injection, installed plugins, and CLI toolchain status
  --ui-only             Install only AGY Claude Style UI (skip plugins, settings, and CLI tools)
  --no-plugins          Alias for --ui-only
  --no-settings         Skip merging Turbo/Sidecar preset into ~/.gemini/config/config.json
  --no-tools            Skip downloading external CLIs (uv, colab, coderabbit, gdrive binary)
  --no-ssh-config       Skip adding Host colab / Host colab-t4 block to ~/.ssh/config
  --no-autostart        Skip systemd --user / XDG autostart registration
  --no-start            Copy files without starting the watcher process
  --install-dir <path>  Override UI install directory (default: ~/.local/share/agy-claude-style)
  --gemini-dir <path>   Override Antigravity ~/.gemini root (default: ~/.gemini)
EOF
      exit 0
      ;;
    *)
      echo "[!] Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

GEMINI_DIR="${GEMINI_DIR%/}"
[[ -z "$GEMINI_DIR" ]] && GEMINI_DIR="/"
DEFAULT_HOME_GEMINI="${HOME%/}/.gemini"

export PATH="$HOME/.local/bin:$GEMINI_DIR/bin:$GEMINI_DIR/antigravity/bin:$PATH"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "[!] Node.js (>= 22) is required on Linux. Quick install via nvm or NodeSource:" >&2
  echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs" >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "[!] Found Node.js $($NODE_BIN -v) at $NODE_BIN, but Node.js >= 22 is required." >&2
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
  echo "=== 1. AGY Claude Style UI ==="
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

  echo "=== 2. Antigravity Plugins ($GEMINI_DIR/config/plugins) ==="
  for p in pi-kit dev-workflow coderabbit context7 gdrive; do
    if [[ -f "$GEMINI_DIR/config/plugins/$p/plugin.json" ]]; then
      echo "[✓] Plugin $p: installed"
    else
      echo "[-] Plugin $p: missing"
    fi
  done

  echo "=== 3. Companion CLI Toolchain ==="
  for cmd in node agy uv colab coderabbit cr gdrive gh; do
    if loc="$(command -v "$cmd" 2>/dev/null)"; then
      echo "[✓] $cmd -> $loc"
    else
      echo "[-] $cmd -> not found in PATH"
    fi
  done
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
  if [[ "$PURGE_PLUGINS" -eq 1 ]]; then
    for p in pi-kit dev-workflow coderabbit context7 gdrive; do
      rm -rf "$GEMINI_DIR/config/plugins/$p"
    done
    echo "[✓] Removed bundled plugins from $GEMINI_DIR/config/plugins"
  fi
  echo "[✓] Uninstalled cleanly and restored native Antigravity UI."
  exit 0
fi

# ---------------------------------------------------------------------------
# Phase 1: Install AGY Claude Style Studio UI & Watcher
# ---------------------------------------------------------------------------
echo "[*] [1/4] Installing AGY Claude Style UI to $INSTALL_DIR ..."
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
  elif [[ -f "$SRC_DIR/bundle/ui-config.preset.json" ]]; then
    cp "$SRC_DIR/bundle/ui-config.preset.json" "$INSTALL_DIR/config.json"
  else
    cp "$INSTALL_DIR/config.example.json" "$INSTALL_DIR/config.json"
  fi
fi

# ---------------------------------------------------------------------------
# Phase 2: Deploy All 5 Plugins, 13 Skills, MCP, Hooks & PI Hub Sidecar
# ---------------------------------------------------------------------------
BUNDLE_DIR="$SRC_DIR/bundle"
if [[ "$INSTALL_PLUGINS" -eq 1 && -d "$BUNDLE_DIR/plugins" ]]; then
  echo "[*] [2/4] Deploying Antigravity plugins & skills to $GEMINI_DIR/config/plugins ..."
  mkdir -p "$GEMINI_DIR/config/plugins" "$GEMINI_DIR/config/plugin-data/pi-kit" "$GEMINI_DIR/antigravity/bin"

  for plugin_src in "$BUNDLE_DIR/plugins"/*; do
    [[ -d "$plugin_src" ]] || continue
    plugin_name="$(basename "$plugin_src")"
    target_plugin_dir="$GEMINI_DIR/config/plugins/$plugin_name"
    stage_plugin_dir="$GEMINI_DIR/config/plugins/.${plugin_name}.stage.$$"
    rm -rf "$stage_plugin_dir"
    cp -RL "$plugin_src" "$stage_plugin_dir"
    if [[ "$plugin_name" == "gdrive" && -f "$target_plugin_dir/auth.json" ]]; then
      cp "$target_plugin_dir/auth.json" "$stage_plugin_dir/auth.json"
    fi
    rm -rf "$target_plugin_dir"
    mv "$stage_plugin_dir" "$target_plugin_dir"
  done

  # Ensure GUI-launched Antigravity Desktop on Linux (GNOME/KDE) can always resolve `node`
  if [[ ! -x "/usr/bin/node" && ! -e "$GEMINI_DIR/antigravity/bin/node" ]]; then
    ln -sf "$NODE_BIN" "$GEMINI_DIR/antigravity/bin/node"
  fi

  # Rewrite pi-kit/mcp_config.json with exact target $NODE_BIN and resolved server.mjs path
  RESOLVED_GEMINI_DIR="$(cd "$GEMINI_DIR" && pwd)"
  "$NODE_BIN" -e '
    const fs = require("fs");
    const [mcpCfgPath, nodeBin, serverMjs] = process.argv.slice(1);
    const cfg = {
      mcpServers: {
        "pi-kit": {
          command: nodeBin,
          args: [serverMjs],
        },
      },
    };
    fs.writeFileSync(mcpCfgPath, JSON.stringify(cfg, null, 2) + "\n");
  ' "$RESOLVED_GEMINI_DIR/config/plugins/pi-kit/mcp_config.json" \
    "$NODE_BIN" \
    "$RESOLVED_GEMINI_DIR/config/plugins/pi-kit/mcp/server.mjs"

  # Ensure gdrive launcher is executable and registered in antigravity/bin
  GDRIVE_LAUNCHER="$RESOLVED_GEMINI_DIR/config/plugins/gdrive/skills/gdrive/scripts/gdrive"
  if [[ -f "$GDRIVE_LAUNCHER" ]]; then
    chmod +x "$GDRIVE_LAUNCHER"
    ln -sf "$GDRIVE_LAUNCHER" "$RESOLVED_GEMINI_DIR/antigravity/bin/gdrive"
  fi

  # Fetch official gdrive plugin metadata (including OAuth auth.json) via agy CLI if available
  AGY_BIN=""
  if [[ -x "$GEMINI_DIR/bin/agy" ]]; then
    AGY_BIN="$GEMINI_DIR/bin/agy"
  elif command -v agy >/dev/null 2>&1; then
    AGY_BIN="$(command -v agy)"
  fi
  if [[ "$INSTALL_TOOLS" -eq 1 && -n "$AGY_BIN" && ! -f "$RESOLVED_GEMINI_DIR/config/plugins/gdrive/auth.json" ]]; then
    "$AGY_BIN" plugin install "gdrive@antigravity-plugins-official" >/dev/null 2>&1 || true
  fi

  echo "[✓] Installed 5 plugins (pi-kit w/ 13 skills, dev-workflow, coderabbit, context7, gdrive)"
fi

# ---------------------------------------------------------------------------
# Phase 3: Safely Merge Antigravity Turbo & Sidecar Preferences
# ---------------------------------------------------------------------------
if [[ "$INSTALL_SETTINGS" -eq 1 && -f "$BUNDLE_DIR/antigravity-settings.preset.json" ]]; then
  echo "[*] [3/4] Applying Antigravity settings preset to $GEMINI_DIR/config/config.json ..."
  LS_RUNNING=0
  if [[ "$GEMINI_DIR" == "$DEFAULT_HOME_GEMINI" ]] && command -v pgrep >/dev/null 2>&1; then
    if pgrep -f "Antigravity.*language_server|antigravity.*language_server" >/dev/null 2>&1; then
      LS_RUNNING=1
    fi
  fi

  if [[ "$LS_RUNNING" -eq 1 ]]; then
    echo "[!] Antigravity Language Server is currently running; skipped writing config.json to avoid clobbering live state."
    echo "    Close Antigravity and re-run './install-linux.sh --no-tools' once if you want Turbo settings merged."
  else
    mkdir -p "$GEMINI_DIR/config"
    if "$NODE_BIN" -e '
      const fs = require("fs");
      const [cfgPath, presetPath] = process.argv.slice(1);
      const preset = JSON.parse(fs.readFileSync(presetPath, "utf8"));
      let current = {};
      if (fs.existsSync(cfgPath)) {
        let raw;
        try {
          raw = fs.readFileSync(cfgPath, "utf8").trim();
        } catch (err) {
          console.error(`[!] Failed to read existing ${cfgPath}: ${err.message}`);
          process.exit(2);
        }
        if (raw) {
          try {
            current = JSON.parse(raw);
          } catch (err) {
            console.error(`[!] Existing ${cfgPath} is malformed JSON; leaving file untouched: ${err.message}`);
            process.exit(2);
          }
        }
      }
      current.plugins = { ...(preset.plugins || {}), ...(current.plugins || {}) };
      const curSettings = current.userSettings || {};
      const preSettings = preset.userSettings || {};
      const mergedAllow = Array.from(new Set([
        ...((preSettings.globalPermissionGrants && preSettings.globalPermissionGrants.allow) || []),
        ...((curSettings.globalPermissionGrants && curSettings.globalPermissionGrants.allow) || []),
      ]));
      current.userSettings = {
        ...preSettings,
        ...curSettings,
        globalPermissionGrants: {
          ...(curSettings.globalPermissionGrants || {}),
          allow: mergedAllow,
        },
      };
      const tmp = `${cfgPath}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, cfgPath);
    ' "$GEMINI_DIR/config/config.json" "$BUNDLE_DIR/antigravity-settings.preset.json"; then
      echo "[✓] Merged Antigravity Turbo & plugin registry settings (mode 0600)"
    else
      echo "[!] Skipped config.json merge to preserve existing file." >&2
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Phase 4: Install / Verify Companion CLI Toolchain & SSH Bridge
# ---------------------------------------------------------------------------
ensure_shell_path() {
  local rc_file="$1"
  [[ -f "$rc_file" ]] || return 0
  local gemini_expr="$GEMINI_DIR"
  if [[ "$GEMINI_DIR" == "$DEFAULT_HOME_GEMINI" ]]; then
    gemini_expr="\$HOME/.gemini"
  fi
  local desired_line="export PATH=\"\$HOME/.local/bin:${gemini_expr}/bin:${gemini_expr}/antigravity/bin:\$PATH\""
  "$NODE_BIN" -e '
    const fs = require("fs");
    const [rcPath, desiredLine] = process.argv.slice(1);
    const startMarker = "# >>> agy-workstation-path >>>";
    const endMarker = "# <<< agy-workstation-path <<<";
    const block = `${startMarker}\n${desiredLine}\n${endMarker}`;
    const content = fs.readFileSync(rcPath, "utf8");
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const existing = content.slice(startIdx, endIdx + endMarker.length);
      if (existing === block) process.exit(0);
      const updated = content.slice(0, startIdx) + block + content.slice(endIdx + endMarker.length);
      fs.writeFileSync(rcPath, updated, "utf8");
    } else {
      const prefix = content.endsWith("\n") || content.length === 0 ? "\n" : "\n\n";
      fs.writeFileSync(rcPath, `${content}${prefix}${block}\n`, "utf8");
    }
  ' "$rc_file" "$desired_line"
}

if [[ "$INSTALL_SSH_CFG" -eq 1 && -f "$BUNDLE_DIR/ssh-colab.preset.conf" ]]; then
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh" 2>/dev/null || true
  touch "$HOME/.ssh/config"
  chmod 600 "$HOME/.ssh/config" 2>/dev/null || true
  if ! grep -Eq "^[[:space:]]*Host[[:space:]]+colab([[:space:]]|$)" "$HOME/.ssh/config" 2>/dev/null; then
    printf "\n" >> "$HOME/.ssh/config"
    cat "$BUNDLE_DIR/ssh-colab.preset.conf" >> "$HOME/.ssh/config"
    echo "[✓] Added 'Host colab' & 'Host colab-t4' proxy block to ~/.ssh/config"
  fi
fi

if [[ "$INSTALL_TOOLS" -eq 1 ]]; then
  echo "[*] [4/4] Installing / verifying companion CLI tools (uv, colab, coderabbit/cr, gdrive) ..."
  mkdir -p "$HOME/.local/bin"
  ensure_shell_path "$HOME/.bashrc"
  ensure_shell_path "$HOME/.zshrc"

  if ! command -v uv >/dev/null 2>&1; then
    echo "[*] Installing uv ..."
    curl -LsSf https://astral.sh/uv/install.sh | sh || echo "[!] Warning: uv install failed (install manually: https://docs.astral.sh/uv/)"
  fi

  if command -v uv >/dev/null 2>&1 && ! command -v colab >/dev/null 2>&1; then
    echo "[*] Installing google-colab-cli (colab) via uv ..."
    uv tool install google-colab-cli || echo "[!] Warning: google-colab-cli install failed"
  fi

  if ! command -v coderabbit >/dev/null 2>&1; then
    echo "[*] Installing CodeRabbit CLI (coderabbit & cr) ..."
    curl -fsSL https://cli.coderabbit.ai/install.sh | sh || echo "[!] Warning: coderabbit CLI install failed"
  fi
  if [[ -x "$HOME/.local/bin/coderabbit" && ! -e "$HOME/.local/bin/cr" ]]; then
    ln -sf "$HOME/.local/bin/coderabbit" "$HOME/.local/bin/cr"
  fi

  if [[ -x "$GEMINI_DIR/config/plugins/gdrive/skills/gdrive/scripts/gdrive" ]]; then
    ANTIGRAVITY_APP_DATA_DIR="$GEMINI_DIR/antigravity" \
      "$GEMINI_DIR/config/plugins/gdrive/skills/gdrive/scripts/gdrive" --help >/dev/null 2>&1 || true
  fi

  if ! command -v gh >/dev/null 2>&1; then
    echo "[i] Tip: GitHub CLI (gh) not found. On Ubuntu/Debian install via: sudo apt update && sudo apt install -y gh"
  fi
fi

# ---------------------------------------------------------------------------
# Start Live UI Watcher (systemd --user or XDG autostart fallback)
# ---------------------------------------------------------------------------
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

echo ""
echo "[✓] Full AGY Workstation installed successfully!"
echo "    - UI Watcher & Gemini Studio Theme : $INSTALL_DIR"
if [[ "$INSTALL_PLUGINS" -eq 1 ]]; then
  echo "    - Plugins & 13 Skills + PI Hub     : $GEMINI_DIR/config/plugins"
  echo "    - Next on fresh Linux login        :"
  echo "      1) Open Antigravity & sign in (if Google Drive OAuth needs init: 'agy plugin install gdrive@antigravity-plugins-official')"
  echo "      2) Open PI Hub side panel -> GitHub Sync to pull Global & Project memories from pi-memory-sync"
  echo "      3) Authenticate CLIs as needed: 'gh auth login', 'coderabbit auth login', 'colab auth login'"
fi
