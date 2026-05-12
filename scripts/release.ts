#!/usr/bin/env bun

/**
 * Interactive release script for yolo-reviewer.
 *
 * Usage: bun scripts/release.ts
 *
 * What it does:
 *   1. Shows current version
 *   2. Asks which bump type (patch / minor / major)
 *   3. Bumps version in package.json
 *   4. Runs build to verify
 *   5. Creates a git commit + tag (v1.2.3)
 *   6. Pushes commit + tag to remote → triggers GitHub Actions to publish to npm
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import prompts from 'prompts';

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

const PKG_PATH = resolve(import.meta.dirname, '../package.json');

function readPkg(): Record<string, any> {
  return JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
}

function writePkg(pkg: Record<string, any>): void {
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
}

function bumpVersion(current: string, type: 'patch' | 'minor' | 'major'): string {
  const parts = current.split('.').map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function run(cmd: string): void {
  console.info(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

function hasUncommittedChanges(): boolean {
  try {
    const output = execSync('git status --porcelain', { encoding: 'utf-8' });
    // Ignore changes only in package.json (we'll commit that ourselves)
    const lines = output
      .trim()
      .split('\n')
      .filter((l) => l && !l.includes('package.json'));
    return lines.length > 0;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────

async function main() {
  console.info('\n🚀 Yolo AI Reviewer — Release Script\n');

  const pkg = readPkg();
  const currentVersion = pkg.version as string;

  console.info(`📦 Package : ${pkg.name}`);
  console.info(`🔖 Current : v${currentVersion}\n`);

  // Guard: uncommitted changes (except package.json)
  if (hasUncommittedChanges()) {
    console.error('❌ You have uncommitted changes. Please commit or stash them first.');
    process.exit(1);
  }

  const { bumpType } = await prompts({
    choices: [
      {
        title: `patch  — v${bumpVersion(currentVersion, 'patch')}  (bug fixes)`,
        value: 'patch',
      },
      {
        title: `minor  — v${bumpVersion(currentVersion, 'minor')}  (new features, backwards compatible)`,
        value: 'minor',
      },
      {
        title: `major  — v${bumpVersion(currentVersion, 'major')}  (breaking changes)`,
        value: 'major',
      },
    ],
    message: 'Select release type',
    name: 'bumpType',
    type: 'select',
  });

  if (!bumpType) {
    console.info('❌ Release cancelled.');
    process.exit(0);
  }

  const nextVersion = bumpVersion(currentVersion, bumpType as 'patch' | 'minor' | 'major');
  const tag = `v${nextVersion}`;

  const { confirmed } = await prompts({
    initial: true,
    message: `Release ${tag} and push to remote? This will trigger npm publish.`,
    name: 'confirmed',
    type: 'confirm',
  });

  if (!confirmed) {
    console.info('❌ Release cancelled.');
    process.exit(0);
  }

  // 1. Bump version in package.json
  console.info(`\n📝 Bumping version: ${currentVersion} → ${nextVersion}`);
  pkg.version = nextVersion;
  writePkg(pkg);

  // 2. Build to verify everything compiles
  console.info('\n🔨 Building...');
  run('bun run build');

  // 3. Git commit + tag
  run('git add package.json');
  run(`git commit -m "chore: release ${tag}"`);
  run(`git tag ${tag}`);

  // 4. Push commit + tag → triggers GitHub Actions publish workflow
  run('git push');
  run(`git push origin ${tag}`);

  console.info(`\n✅ Done! Tag ${tag} pushed.`);
  console.info('🤖 GitHub Actions will now build and publish to npm automatically.');
  console.info(`📦 Check: https://www.npmjs.com/package/${pkg.name}`);
}

main().catch((err) => {
  console.error('❌ Release failed:', err.message);
  process.exit(1);
});
