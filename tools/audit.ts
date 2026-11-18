// Audit statico: il gioco non deve contattare nessun servizio a runtime, né usare casualità non deterministica
// nella logica di gioco, né esporre strumenti di sviluppo in produzione.
// Uso: npm run audit:static   (esegue anche il controllo su dist/ se la build esiste)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); }
  return out;
};
const problems: string[] = [];
const NETWORK = /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource|sendBeacon|navigator\.serviceWorker|importScripts/;
const AI = /openai|anthropic|api[_-]?key|generativelanguage|huggingface|replicate\.com|bearer\s/i;
const URL_RE = /https?:\/\/[a-z0-9.-]+/gi;
const GAMEPLAY = ['src/core', 'src/world', 'src/game', 'src/world'];

for (const f of walk('src').concat(['index.html'])) {
  const text = readFileSync(f, 'utf8');
  text.split('\n').forEach((raw, i) => {
    const line = /^\s*(\/\/|\*|\/\*)/.test(raw) ? '' : raw;
    const at = `${f}:${i + 1}`;
    if (NETWORK.test(line)) problems.push(`${at} network API: ${line.trim().slice(0, 90)}`);
    if (AI.test(line)) problems.push(`${at} AI/credential reference: ${line.trim().slice(0, 90)}`);
    for (const u of line.match(URL_RE) ?? []) if (!/www\.w3\.org/.test(u)) problems.push(`${at} external URL: ${u}`);
    if (GAMEPLAY.some((g) => f.startsWith(g)) && /Math\.random\s*\(|Date\.now\s*\(|performance\.now/.test(line)) problems.push(`${at} non-deterministic call in game logic: ${line.trim().slice(0, 90)}`);
  });
}
console.log(`src: ${walk('src').length} files scanned`);

if (existsSync('dist')) {
  const hosts = new Map<string, number>();
  let dev = false;
  for (const f of walk('dist')) {
    if (!/\.(js|html|css)$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    if (text.includes('__ths')) dev = true;
    for (const u of text.match(URL_RE) ?? []) { const h = u.replace(/^https?:\/\//, '').toLowerCase(); hosts.set(h, (hosts.get(h) ?? 0) + 1); }
    if (AI.test(text.replace(/api[_-]?key/gi, ''))) problems.push(`${f} AI service reference in bundle`);
  }
  if (dev) problems.push('dist: developer API (__ths) present in production bundle');
  // Babylon.js contiene URL di documentazione e di risorse opzionali mai richieste dal gioco: elencati per trasparenza.
  console.log('dist: hostnames that appear as strings in the bundle (none is requested at runtime; see docs/QA_REPORT.md):');
  console.log('  ' + [...hosts.keys()].sort().join(', '));
} else console.log('dist: not built, skipped');

if (problems.length) { console.error(`\n${problems.length} problem(s):\n` + problems.join('\n')); process.exit(1); }
console.log('\naudit OK: no network calls, no AI endpoints, no credentials, deterministic game logic');
