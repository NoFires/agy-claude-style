import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildIcns } from '../scripts/build-common.mjs';
import { buildMacosApp, generateInfoPlist } from '../scripts/build-macos.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const cdp = require(path.join(ROOT_DIR, 'cdp.js'));

function runBin(binPath, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`Timeout running ${path.basename(binPath)} ${args.join(' ')}`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(binPath)} exited with code ${code}`));
    });
  });
}

function createMockCdpServer() {
  const receivedCalls = [];
  const sockets = new Set();
  let claudeStyleMounted = false;
  let lastInjectedExpr = null;
  let lastRemovedExpr = null;

  function encodeWsTextFrame(str) {
    const payload = Buffer.from(str, 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
  }

  function sendWsMessage(socket, obj) {
    if (!socket.destroyed) {
      socket.write(encodeWsTextFrame(JSON.stringify(obj)));
    }
  }

  function handleCdpCommand(socket, msg) {
    receivedCalls.push(msg);
    let result = {};
    if (msg.method === 'Page.addScriptToEvaluateOnNewDocument') {
      result = { identifier: 'script-' + receivedCalls.length };
    } else if (msg.method === 'Runtime.evaluate') {
      const expr = msg.params && msg.params.expression ? msg.params.expression : '';
      if (expr === 'Boolean(window.__agClaudeStyle)') {
        result = { result: { type: 'boolean', value: claudeStyleMounted } };
      } else if (expr.includes('delete globalThis.__agCsUiMain')) {
        lastRemovedExpr = expr;
        claudeStyleMounted = false;
        result = { result: { type: 'object', value: { removed: 3 } } };
      } else {
        lastInjectedExpr = expr;
        claudeStyleMounted = true;
        result = {
          result: {
            type: 'object',
            value: { version: cdp.PLUGIN_VERSION, status: 'ok', state: { mounted: true } },
          },
        };
      }
    }
    sendWsMessage(socket, { id: msg.id, result });
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/json/list') {
      const addr = server.address();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify([
          {
            id: 'PAGE_1',
            type: 'page',
            title: 'Antigravity',
            url: 'https://127.0.0.1:9999/',
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/page/PAGE_1`,
          },
          {
            id: 'DEVTOOLS_1',
            type: 'page',
            title: 'DevTools',
            url: 'devtools://devtools/bundled/inspector.html',
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/page/DEVTOOLS_1`,
          },
        ])
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));

    let buf = Buffer.alloc(0);
    let fragChunks = [];
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const b0 = buf[0];
        const b1 = buf[1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let offset = 2;
        if (payloadLen === 126) {
          if (buf.length < 4) return;
          payloadLen = buf.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (buf.length < 10) return;
          payloadLen = Number(buf.readBigUInt64BE(2));
          offset = 10;
        }
        const maskLen = masked ? 4 : 0;
        if (buf.length < offset + maskLen + payloadLen) return;
        let payload = buf.subarray(offset + maskLen, offset + maskLen + payloadLen);
        if (masked) {
          const mask = buf.subarray(offset, offset + 4);
          const unmasked = Buffer.allocUnsafe(payloadLen);
          for (let i = 0; i < payloadLen; i++) {
            unmasked[i] = payload[i] ^ mask[i & 3];
          }
          payload = unmasked;
        }
        buf = buf.subarray(offset + maskLen + payloadLen);

        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (opcode === 0x9) {
          const pong = Buffer.alloc(2 + payload.length);
          pong[0] = 0x8a;
          pong[1] = payload.length;
          payload.copy(pong, 2);
          socket.write(pong);
          continue;
        }
        if (opcode === 0x1 || opcode === 0x0) {
          fragChunks.push(payload);
          if (fin) {
            const fullText = Buffer.concat(fragChunks).toString('utf8');
            fragChunks = [];
            try {
              const msg = JSON.parse(fullText);
              handleCdpCommand(socket, msg);
            } catch {}
          }
        }
      }
    });
  });

  return {
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return server.address().port;
    },
    emitBindingCalled(name, payload) {
      for (const s of sockets) {
        sendWsMessage(s, {
          method: 'Runtime.bindingCalled',
          params: { name, payload: JSON.stringify(payload) },
        });
      }
    },
    getCalls() {
      return receivedCalls;
    },
    getLastInjectedExpr() {
      return lastInjectedExpr;
    },
    getLastRemovedExpr() {
      return lastRemovedExpr;
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function waitFor(fn, timeoutMs = 6000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = await fn();
    if (val) return val;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

test('buildIcns generates a valid Apple ICNS container with PNG icon chunks', () => {
  const icns = buildIcns();
  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);

  let offset = 8;
  const types = [];
  const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  while (offset < icns.length) {
    const chunkType = icns.subarray(offset, offset + 4).toString('ascii');
    const chunkLen = icns.readUInt32BE(offset + 4);
    assert.ok(chunkLen > 16, `Chunk ${chunkType} has payload`);
    assert.deepEqual(icns.subarray(offset + 8, offset + 16), pngMagic, `Chunk ${chunkType} is valid PNG`);
    types.push(chunkType);
    offset += chunkLen;
  }
  assert.equal(offset, icns.length);
  assert.ok(types.includes('icp4'));
  assert.ok(types.includes('ic08'));
  assert.ok(types.includes('ic10'));
});

test('generateInfoPlist generates valid bundle metadata and escapes special XML characters', () => {
  const plist = generateInfoPlist('1.2.3-beta&1<test>');
  assert.ok(plist.includes('<key>CFBundleExecutable</key>'));
  assert.ok(plist.includes('<string>AGY Claude Style</string>'));
  assert.ok(plist.includes('<string>io.github.0dnancy.agy-claude-style</string>'));
  assert.ok(plist.includes('<key>NSAllowsLocalNetworking</key>'));
  assert.ok(plist.includes('<string>1.2.3-beta&amp;1&lt;test&gt;</string>'));
});

test(
  'macOS .app builds cleanly as universal binary and executes full install, CDP injection, setting sync, upgrade, and uninstall lifecycle',
  { skip: process.platform !== 'darwin' ? 'macOS-only .app E2E test' : false },
  async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-macos-e2e-'));
    const appPath = path.join(workDir, 'AGY Claude Style.app');
    const installDir = path.join(workDir, 'installed');
    const outInstall = path.join(workDir, 'install.json');
    const outUpgrade = path.join(workDir, 'upgrade.json');
    const outUninstall = path.join(workDir, 'uninstall.json');
    const outStatus = path.join(workDir, 'status.json');
    const mockCdp = createMockCdpServer();

    try {
      const buildRes = buildMacosApp({ appOut: appPath, createDmg: false });
      assert.ok(fs.existsSync(appPath));
      assert.ok(buildRes.appSizeBytes > 100 * 1024);

      const installerBin = path.join(appPath, 'Contents', 'MacOS', 'AGY Claude Style');
      const watcherBundleBin = path.join(appPath, 'Contents', 'MacOS', 'agy-claude-style-watcher');
      assert.ok(fs.existsSync(installerBin));
      assert.ok(fs.existsSync(watcherBundleBin));

      for (const bin of [installerBin, watcherBundleBin]) {
        const archs = execFileSync('lipo', ['-archs', bin], { encoding: 'utf8' }).trim().split(/\s+/);
        assert.ok(archs.includes('arm64'), `${path.basename(bin)} includes arm64`);
        assert.ok(archs.includes('x86_64'), `${path.basename(bin)} includes x86_64`);
      }

      execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });

      const port = await mockCdp.start();

      // 1. Check --status CLI
      await runBin(
        installerBin,
        ['--status', '--install-dir', installDir, '--cdp-port', String(port), '--out', outStatus],
        10000
      );
      const st = JSON.parse(fs.readFileSync(outStatus, 'utf8'));
      assert.equal(st.installed, false);
      assert.equal(st.cdpPort, port);

      // 2. Run --silent install against mock CDP server
      await runBin(
        installerBin,
        [
          '--silent',
          '--no-autostart',
          '--no-kill-legacy',
          '--install-dir',
          installDir,
          '--cdp-port',
          String(port),
          '--out',
          outInstall,
        ],
        20000
      );

      const installResult = JSON.parse(fs.readFileSync(outInstall, 'utf8'));
      assert.equal(installResult.ok, true);
      assert.equal(installResult.preservedExistingConfig, false);
      assert.deepEqual(installResult.injectedPages, ['Antigravity']);
      assert.ok(fs.existsSync(path.join(installDir, 'agy-claude-style-watcher')));
      assert.ok(fs.existsSync(path.join(installDir, 'agy-claude-style-installer')));
      assert.ok(fs.existsSync(path.join(installDir, 'manifest.json')));
      assert.ok(fs.existsSync(path.join(installDir, '.watch.pid')));

      const activeCfgPath = fs.existsSync(path.join(ROOT_DIR, 'config.json'))
        ? path.join(ROOT_DIR, 'config.json')
        : path.join(ROOT_DIR, 'config.example.json');
      const expectedCfg = fs.readFileSync(activeCfgPath, 'utf8');
      assert.equal(fs.readFileSync(path.join(installDir, 'config.json'), 'utf8'), expectedCfg);

      // Verify exact CDP sequence & valid JS payload
      const calls = mockCdp.getCalls();
      assert.ok(calls.some((c) => c.method === 'Page.enable'));
      assert.ok(calls.some((c) => c.method === 'Runtime.enable'));
      assert.ok(
        calls.some(
          (c) =>
            c.method === 'Runtime.addBinding' &&
            c.params &&
            c.params.name === cdp.SETTING_BINDING
        )
      );
      assert.ok(calls.some((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument'));
      const injectedExpr = mockCdp.getLastInjectedExpr();
      assert.ok(injectedExpr, 'injected expression was sent over CDP');
      assert.doesNotThrow(() => new vm.Script(injectedExpr), 'Swift injected JS compiles cleanly');

      // Verify codeHash parity and active config values between Node cdp.js and Swift watcher
      const nodeExpr = cdp.buildInjectExpression();
      const nodeHash = nodeExpr.match(/"codeHash":"([^"]+)"/)[1];
      const swiftHash = injectedExpr.match(/"codeHash":"([^"]+)"/)[1];
      assert.equal(swiftHash, nodeHash);
      const expectedCfgObj = JSON.parse(expectedCfg);
      assert.ok(injectedExpr.includes(`"palette":"${expectedCfgObj.palette}"`));
      assert.ok(injectedExpr.includes(`"ringMode":"${expectedCfgObj.ringMode}"`));

      // Verify watcher --once CLI mode works standalone against CDP
      const watcherBin = path.join(installDir, 'agy-claude-style-watcher');
      const onceOut = path.join(workDir, 'once.json');
      await runBin(
        watcherBin,
        ['--once', '--dir', installDir, '--cdp-port', String(port), '--out', onceOut],
        10000
      );
      const onceResult = JSON.parse(fs.readFileSync(onceOut, 'utf8'));
      assert.equal(onceResult.ok, true);
      assert.deepEqual(onceResult.pages, ['Antigravity']);

      // 3. Test Runtime.bindingCalled -> config.json update & hot-reload (including Aurora palette)
      const beforeCallCount = mockCdp.getCalls().length;
      mockCdp.emitBindingCalled(cdp.SETTING_BINDING, { key: 'palette', value: 'hacker-invalid' });
      mockCdp.emitBindingCalled(cdp.SETTING_BINDING, { key: 'palette', value: 'gemini' });

      const updatedCfg = await waitFor(() => {
        const parsed = JSON.parse(fs.readFileSync(path.join(installDir, 'config.json'), 'utf8'));
        return parsed.palette === 'gemini' ? parsed : null;
      });
      assert.equal(updatedCfg.palette, 'gemini');

      // Confirm hot-reload fired on watcher
      await waitFor(() => {
        const newer = mockCdp.getCalls().slice(beforeCallCount);
        return newer.some((c) => c.method === 'Page.removeScriptToEvaluateOnNewDocument') ? true : null;
      });

      // 4. Test re-install / upgrade preserves existing user config.json
      await runBin(
        installerBin,
        [
          '--silent',
          '--no-autostart',
          '--no-kill-legacy',
          '--install-dir',
          installDir,
          '--cdp-port',
          String(port),
          '--out',
          outUpgrade,
        ],
        20000
      );
      const upgradeResult = JSON.parse(fs.readFileSync(outUpgrade, 'utf8'));
      assert.equal(upgradeResult.ok, true);
      assert.equal(upgradeResult.preservedExistingConfig, true);
      const cfgAfterUpgrade = JSON.parse(fs.readFileSync(path.join(installDir, 'config.json'), 'utf8'));
      assert.equal(cfgAfterUpgrade.palette, 'gemini');

      // 5. Test --uninstall from installed copy inside installDir
      const installedSelf = path.join(installDir, 'agy-claude-style-installer');
      await runBin(
        installedSelf,
        [
          '--uninstall',
          '--silent',
          '--no-autostart',
          '--install-dir',
          installDir,
          '--cdp-port',
          String(port),
          '--out',
          outUninstall,
        ],
        20000
      );

      const uninstallResult = JSON.parse(fs.readFileSync(outUninstall, 'utf8'));
      assert.equal(uninstallResult.ok, true);
      assert.deepEqual(uninstallResult.injectedPages, ['Antigravity']);
      assert.equal(mockCdp.getLastRemovedExpr(), cdp.REMOVE_EXPRESSION);

      await waitFor(() => (!fs.existsSync(installDir) ? true : null), 5000, 100);
      assert.equal(fs.existsSync(installDir), false);
    } finally {
      try {
        const pidPath = path.join(installDir, '.watch.pid');
        if (fs.existsSync(pidPath)) {
          const pid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
          if (pid) process.kill(pid);
        }
      } catch {}
      await mockCdp.close();
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    }
  }
);
