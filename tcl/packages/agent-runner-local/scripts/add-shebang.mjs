import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', 'dist', 'cli.js');
let src = readFileSync(cliPath, 'utf8');
if (!src.startsWith('#!')) {
  src = '#!/usr/bin/env node\n' + src;
}
writeFileSync(cliPath, src, { mode: 0o755 });
