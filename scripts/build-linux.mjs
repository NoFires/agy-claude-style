#!/usr/bin/env node
// Build portable Linux release archive (AGY-Claude-Style-linux.tar.gz) for AGY Claude Style.
// Zero external npm dependencies: uses Node fs + system tar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR, cdp, resolveActiveConfigFile } from './build-common.mjs';

const __filename = fileURLToPath(import.meta.url);

function buildLinuxArchive({
  outputPath = path.join(ROOT_DIR, 'AGY-Claude-Style-linux.tar.gz'),
  configPath,
} = {}) {
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-linux-build-'));
  const bundleDirName = 'agy-claude-style-linux';
  const bundleDir = path.join(stageRoot, bundleDirName);
  fs.mkdirSync(bundleDir, { recursive: true });

  try {
    const activeConfig = resolveActiveConfigFile(configPath);
    const coreFiles = [
      'cdp.js',
      'inject.js',
      'remove.js',
      'style.css',
      'config.example.json',
      'package.json',
      'LICENSE',
      'README.md',
      'inject.sh',
      'watch.sh',
      'remove.sh',
      'install-linux.sh',
      ...cdp.RUNTIME_PARTS,
    ];

    for (const rel of coreFiles) {
      const src = path.join(ROOT_DIR, rel);
      const dst = path.join(bundleDir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      if (rel.endsWith('.sh')) {
        fs.chmodSync(dst, 0o755);
      }
    }

    fs.copyFileSync(activeConfig, path.join(bundleDir, 'config.json'));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });

    execFileSync('tar', ['-czf', outputPath, '-C', stageRoot, bundleDirName], {
      stdio: 'inherit',
    });

    const stat = fs.statSync(outputPath);
    return {
      outputPath,
      sizeBytes: stat.size,
      fileCount: coreFiles.length + 1,
    };
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  let outputPath = path.join(ROOT_DIR, 'AGY-Claude-Style-linux.tar.gz');
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--out' || args[i] === '-o') && i + 1 < args.length) {
      outputPath = path.resolve(args[++i]);
    }
  }
  const res = buildLinuxArchive({ outputPath });
  console.log(
    `[✓] Built ${res.outputPath} (${(res.sizeBytes / 1024).toFixed(1)} KB, ${res.fileCount} files)`
  );
}

export { buildLinuxArchive };
