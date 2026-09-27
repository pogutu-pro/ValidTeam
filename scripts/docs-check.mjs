#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readJsonIfPresent(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function fail(message) {
  failures.push(message);
}

const listed = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md', '*.mdc'],
  { cwd: repoRoot, encoding: 'utf8' }
)
  .split(/\r?\n/)
  .filter(Boolean);
const markdownFiles = [...new Set(listed)].sort();
const existingMarkdownFiles = markdownFiles.filter((relativePath) =>
  fs.existsSync(path.join(repoRoot, relativePath))
);

const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
for (const relativePath of existingMarkdownFiles) {
  const content = read(relativePath);
  for (const match of content.matchAll(linkPattern)) {
    let target = match[1]?.trim() ?? '';
    if (!target || target.startsWith('#')) continue;
    if (/^(?:https?:|mailto:|data:)/i.test(target)) continue;

    if (target.startsWith('<') && target.endsWith('>')) {
      target = target.slice(1, -1);
    } else {
      target = target.split(/\s+["']/)[0] ?? target;
    }
    target = target.split('#')[0] ?? target;
    if (!target || target.startsWith('/')) continue;

    let decoded = target;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      fail(`${relativePath}: invalid URL encoding in link ${target}`);
      continue;
    }
    const resolved = path.resolve(repoRoot, path.dirname(relativePath), decoded);
    if (!resolved.startsWith(`${repoRoot}${path.sep}`) && resolved !== repoRoot) {
      fail(`${relativePath}: link escapes the repository: ${target}`);
      continue;
    }
    if (!fs.existsSync(resolved)) {
      fail(`${relativePath}: missing local link target: ${target}`);
    }
  }
}

const historicalFiles = new Set(['CHANGELOG.md']);
const forbiddenActiveReferences = [
  'docker-compose.prod.yml',
  'docs/AUDIT_2026-06.md',
  'docs/QUICK_START.md',
  'docs/DATABASE_SETUP.md',
  'apps/web/src/lib/i18n/MIGRATION.md',
];
for (const relativePath of existingMarkdownFiles) {
  if (historicalFiles.has(relativePath)) continue;
  const content = read(relativePath);
  for (const reference of forbiddenActiveReferences) {
    if (content.includes(reference)) {
      fail(`${relativePath}: references removed/stale path ${reference}`);
    }
  }
}

const rootPackage = JSON.parse(read('package.json'));
const dbPackage = JSON.parse(read('packages/db/package.json'));
const turbo = JSON.parse(read('turbo.json'));
const claudeSettings = readJsonIfPresent('.claude/settings.json');
if (rootPackage.scripts?.['db:generate']) fail('package.json: db:generate must stay removed');
if (dbPackage.scripts?.['db:generate']) {
  fail('packages/db/package.json: db:generate must stay removed');
}
if (turbo.tasks?.['db:generate']) fail('turbo.json: db:generate task must stay removed');
if (
  claudeSettings &&
  JSON.stringify(claudeSettings.permissions?.allow ?? []).includes('db:generate')
) {
  fail('.claude/settings.json: db:generate must not be allowlisted');
}

const requiredAdapters = [
  'AGENTS.md',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
  '.cursor/rules/project.mdc',
  'docs/README.md',
  'docs/STATUS.md',
  'docs/ROADMAP_2026.md',
  'docs/ARCHITECTURE.md',
  'docs/AGENT_RUNTIME.md',
];
for (const relativePath of requiredAdapters) {
  if (!fs.existsSync(path.join(repoRoot, relativePath))) {
    fail(`required canonical document/adapter is missing: ${relativePath}`);
  }
}

if (failures.length > 0) {
  console.error(`Documentation check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Documentation check passed: ${existingMarkdownFiles.length} Markdown/rule files, local links, canonical adapters, and migration-command guard.`
);
