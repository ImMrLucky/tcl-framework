/**
 * Copy Agent Studio catalogue JSON from `agent-core` into `dist/` next to
 * `templates.js`, so runtime resolution works even when `node_modules` is
 * pruned or `process.cwd()` is not the monorepo root.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tclCoreRoot = path.join(here, '..');
const srcDir = path.join(tclCoreRoot, '..', 'agent-core', 'templates');
const destDir = path.join(tclCoreRoot, 'dist', 'server', 'agent-studio', 'agent-template-json');
const files = ['roles.json', 'personas.json', 'workflows.json'];

if (!fs.existsSync(srcDir)) {
  console.warn(
    '[copy-agent-templates] skip: source dir missing (' +
      srcDir +
      "). Production API still serves embedded catalog from generated-agent-catalog.ts."
  );
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
for (const f of files) {
  const from = path.join(srcDir, f);
  if (!fs.existsSync(from)) {
    console.warn('[copy-agent-templates] skip missing file:', from);
    continue;
  }
  fs.copyFileSync(from, path.join(destDir, f));
}
console.log('[copy-agent-templates] copied', files.join(', '), '→', destDir);
