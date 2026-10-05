#!/usr/bin/env node
/**
 * Bootstrap for `npx @validteam/mcp-server`.
 *
 * The published package ships compiled `.js` output under `dist/`. In
 * the workspace we also support running directly from TypeScript via
 * `tsx` for dev convenience.
 */
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distEntry = join(__dirname, '..', 'dist', 'stdio.js');
const srcEntry = join(__dirname, '..', 'src', 'stdio.ts');

async function main() {
  let mod;
  if (existsSync(distEntry)) {
    mod = await import(pathToFileURL(distEntry).href);
  } else if (existsSync(srcEntry)) {
    // Workspace dev path: rely on the consumer having tsx available.
    try {
      const { register } = await import('tsx/esm/api');
      register();
    } catch {
      console.error(
        '[validteam-mcp] dist not built and tsx not installed. ' +
          'Run `pnpm --filter @validteam/mcp-server build` first.'
      );
      process.exit(1);
    }
    mod = await import(pathToFileURL(srcEntry).href);
  } else {
    console.error('[validteam-mcp] No entry point found.');
    process.exit(1);
  }
  await mod.runStdio();
}

main().catch((err) => {
  console.error('[validteam-mcp] fatal:', err);
  process.exit(1);
});
