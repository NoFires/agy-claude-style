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
  'Linux release archive builds cleanly and install-linux.sh installs, preserves config on upgrade, and uninstalls',
  { skip: process.platform === 'win32' ? 'POSIX shell installer test' : false },
  () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-linux-e2e-'));
    try {
      const archivePath = path.join(tmpRoot, 'AGY-Claude-Style-linux.tar.gz');
      const res = buildLinuxArchive({ outputPath: archivePath });
      assert.ok(fs.existsSync(archivePath));
      assert.ok(res.sizeBytes > 100000);

      const extractDir = path.join(tmpRoot, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });
      execFileSync('tar', ['-xzf', archivePath, '-C', extractDir]);

      const unpackedDir = path.join(extractDir, 'agy-claude-style-linux');
      const installerSh = path.join(unpackedDir, 'install-linux.sh');
      assert.ok(fs.existsSync(installerSh));
      assert.ok(fs.existsSync(path.join(unpackedDir, 'custom-themes.js')));

      const installDir = path.join(tmpRoot, 'installed');
      execFileSync('bash', [installerSh, '--install-dir', installDir, '--no-autostart', '--no-start'], {
        env: { ...process.env, AG_CDP_PORT: '65534' },
      });

      for (const part of cdp.RUNTIME_PARTS) {
        assert.ok(fs.existsSync(path.join(installDir, part)), `Expected installed runtime part ${part}`);
      }
      assert.ok(fs.existsSync(path.join(installDir, 'config.json')));

      // Customize palette to Aurora "purple" and verify re-install preserves config.json
      const cfgPath = path.join(installDir, 'config.json');
      const customCfg = { ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')), palette: 'purple' };
      fs.writeFileSync(cfgPath, JSON.stringify(customCfg, null, 2) + '\n');

      execFileSync('bash', [installerSh, '--install-dir', installDir, '--no-autostart', '--no-start'], {
        env: { ...process.env, AG_CDP_PORT: '65534' },
      });
      const afterUpgrade = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      assert.equal(afterUpgrade.palette, 'purple');

      const statusOut = execFileSync('bash', [installerSh, '--install-dir', installDir, '--status'], {
        encoding: 'utf8',
        env: { ...process.env, AG_CDP_PORT: '65534' },
      });
      assert.ok(statusOut.includes('Installed: yes'));

      execFileSync('bash', [installerSh, '--install-dir', installDir, '--no-autostart', '--uninstall'], {
        env: { ...process.env, AG_CDP_PORT: '65534' },
      });
      assert.equal(fs.existsSync(installDir), false);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
);
