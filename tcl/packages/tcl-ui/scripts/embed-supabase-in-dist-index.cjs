'use strict';

/**
 * After `ng build`, injects Supabase URL + anon key into dist/.../index.html so the
 * browser never depends on a separate /assets/supabase-env.js request (avoids SPA
 * rules or missing-asset issues on Netlify).
 *
 * Reads the same env vars as scripts/inject-supabase-assets.cjs.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function readDotEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const dot = readDotEnv(path.join(root, '.env.supabase'));
const url = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL ||
  dot.SUPABASE_URL ||
  ''
).trim();
const anonKey = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.PUBLIC_SUPABASE_ANON_KEY ||
  dot.SUPABASE_ANON_KEY ||
  ''
).trim();

const indexPath = path.join(root, 'dist', 'tcl-ui', 'browser', 'index.html');
if (!fs.existsSync(indexPath)) {
  console.warn('[embed-supabase-dist] No dist/tcl-ui/browser/index.html — skipping (run after ng build).');
  process.exit(0);
}

let html = fs.readFileSync(indexPath, 'utf8');
if (html.includes('/*tcl-supabase-runtime*/')) {
  console.log('[embed-supabase-dist] index.html already has Supabase runtime block, skipping.');
  process.exit(0);
}

const inline = `<script>/*tcl-supabase-runtime*/(function(){window.__SUPABASE_URL=${JSON.stringify(url)};window.__SUPABASE_ANON_KEY=${JSON.stringify(anonKey)};})();</script>`;

html = html.replace(/\s*<script\s+src="assets\/supabase-env\.js"\s*>\s*<\/script>\s*/i, '\n');

if (!html.includes('<head>')) {
  console.warn('[embed-supabase-dist] Unexpected index.html (no <head>), skipping.');
  process.exit(0);
}

html = html.replace('<head>', `<head>${inline}`);

fs.writeFileSync(indexPath, html, 'utf8');

if (url && anonKey) {
  console.log('[embed-supabase-dist] Inlined Supabase URL + anon key into dist index.html');
} else {
  console.warn(
    '[embed-supabase-dist] Inlined empty Supabase config. Set SUPABASE_URL + SUPABASE_ANON_KEY for Netlify builds (Build environment scope).'
  );
}
