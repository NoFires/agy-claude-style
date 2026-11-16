import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildLinuxArchive } from '../scripts/build-linux.mjs';

const require = createRequire(import.meta.url);
const cdp = require('../cdp.js');

test(
  'Linux release archive builds full AGY workstation (UI + 5 plugins + 13 skills + settings) and install-linux.sh deploys cleanly',
  { skip: process.platform === 'win32' ? 'POSIX shell installer test' : false },
  () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-linux-e2e-'));
    try {
      const archivePath = path.join(tmpRoot, 'AGY-Claude-Style-linux.tar.gz');
      const res = buildLinuxArchive({ outputPath: archivePath });
      assert.ok(fs.existsSync(archivePath));
      assert.ok(res.sizeBytes > 200000);

      const extractDir = path.join(tmpRoot, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });
      execFileSync('tar', ['-xzf', archivePath, '-C', extractDir]);

      const unpackedDir = path.join(extractDir, 'agy-claude-style-linux');
      const installerSh = path.join(unpackedDir, 'install-linux.sh');
      assert.ok(fs.existsSync(installerSh));
      assert.ok(fs.existsSync(path.join(unpackedDir, 'custom-themes.js')));
      assert.ok(fs.existsSync(path.join(unpackedDir, 'bundle', 'plugins', 'pi-kit', 'plugin.json')));

      const installDir = path.join(tmpRoot, 'installed');
      const geminiDir = path.join(tmpRoot, 'mock-gemini');
      execFileSync(
        'bash',
        [
          installerSh,
          '--install-dir',
          installDir,
          '--gemini-dir',
          geminiDir,
          '--no-autostart',
          '--no-start',
          '--no-tools',
          '--no-ssh-config',
        ],
        {
          env: { ...process.env, AG_CDP_PORT: '65534' },
        }
      );

      for (const part of cdp.RUNTIME_PARTS) {
        assert.ok(fs.existsSync(path.join(installDir, part)), `Expected installed runtime part ${part}`);
      }

      // Fresh install defaults to user's Gemini Studio UI preset
      const cfgPath = path.join(installDir, 'config.json');
      const initialUiCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      assert.equal(initialUiCfg.palette, 'gemini');
      assert.equal(initialUiCfg.mascot, 'crab');

      // All 5 plugins and all 13 materialized pi-kit skills are deployed
      for (const p of ['pi-kit', 'dev-workflow', 'coderabbit', 'context7', 'gdrive']) {
        assert.ok(
          fs.existsSync(path.join(geminiDir, 'config', 'plugins', p, 'plugin.json')),
          `Expected plugin ${p} to be installed`
        );
      }
      const installedSkills = fs.readdirSync(path.join(geminiDir, 'config', 'plugins', 'pi-kit', 'skills'));
      assert.equal(installedSkills.length, 13);
      assert.ok(installedSkills.includes('colab-operator'));
      assert.ok(installedSkills.includes('pi-plan'));

      // pi-kit MCP config is rewritten dynamically to the target geminiDir (zero /Users/sereden paths)
      const piMcpCfg = JSON.parse(
        fs.readFileSync(path.join(geminiDir, 'config', 'plugins', 'pi-kit', 'mcp_config.json'), 'utf8')
      );
      assert.ok(piMcpCfg.mcpServers['pi-kit'].args[0].endsWith('/config/plugins/pi-kit/mcp/server.mjs'));
      assert.equal(piMcpCfg.mcpServers['pi-kit'].args[0].includes('/Users/sereden'), false);

      // Antigravity settings preset merged at 0600
      const agyCfgPath = path.join(geminiDir, 'config', 'config.json');
      assert.ok(fs.existsSync(agyCfgPath));
      const agyCfg = JSON.parse(fs.readFileSync(agyCfgPath, 'utf8'));
      assert.equal(agyCfg.userSettings.permissionPreset, 'AGENT_PERMISSION_PRESET_TURBO');
      assert.equal(agyCfg.plugins.coderabbit.installedFrom.version, '1.2.1');

      // Customize palette to Aurora "purple", write mock gdrive/auth.json & malformed config.json,
      // and verify re-install preserves UI config, preserves gdrive/auth.json, and leaves malformed config.json untouched
      const customCfg = { ...initialUiCfg, palette: 'purple' };
      fs.writeFileSync(cfgPath, JSON.stringify(customCfg, null, 2) + '\n');
      const gdriveAuthPath = path.join(geminiDir, 'config', 'plugins', 'gdrive', 'auth.json');
      fs.writeFileSync(gdriveAuthPath, '{"providers":{"google":{"type":"oauth2"}}}\n');
      fs.writeFileSync(agyCfgPath, '{broken-json');

      execFileSync(
        'bash',
        [
          installerSh,
          '--install-dir',
          installDir,
          '--gemini-dir',
          `${geminiDir}/`,
          '--no-autostart',
          '--no-start',
          '--no-tools',
          '--no-ssh-config',
        ],
        {
          env: { ...process.env, AG_CDP_PORT: '65534' },
        }
      );
      const afterUpgrade = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      assert.equal(afterUpgrade.palette, 'purple');
      assert.equal(fs.readFileSync(gdriveAuthPath, 'utf8'), '{"providers":{"google":{"type":"oauth2"}}}\n');
      assert.equal(fs.readFileSync(agyCfgPath, 'utf8'), '{broken-json');

      const statusOut = execFileSync(
        'bash',
        [installerSh, '--install-dir', installDir, '--gemini-dir', geminiDir, '--status'],
        {
          encoding: 'utf8',
          env: { ...process.env, AG_CDP_PORT: '65534' },
        }
      );
      assert.ok(statusOut.includes('Installed: yes'));
      assert.ok(statusOut.includes('Plugin pi-kit: installed'));

      execFileSync(
        'bash',
        [installerSh, '--install-dir', installDir, '--gemini-dir', geminiDir, '--no-autostart', '--uninstall'],
        {
          env: { ...process.env, AG_CDP_PORT: '65534' },
        }
      );
      assert.equal(fs.existsSync(installDir), false);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
);
