// Auditoria do conteúdo que entrará no Git, sem ler dependências, builds ou arquivos ignorados.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: root, encoding: 'utf8',
}).split('\0').filter(Boolean))];
const errors = [];
const oldTitle = new RegExp(['ronin', 'na', 'chuva'].join('[\\s_-]*'), 'i');
const secrets = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b|\bAKIA[0-9A-Z]{16}\b/;
const textFile = /\.(?:md|ts|mjs|js|css|html|json|ya?ml|svg|txt)$|(?:^|\/)LICENSE$/;
let bytes = 0, links = 0;

for (const file of files) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) { errors.push(`${file}: arquivo ausente`); continue; }
  const stat = fs.statSync(full);
  bytes += stat.size;
  if (stat.size > 50 * 1024 * 1024) errors.push(`${file}: excede 50 MiB; revise a distribuição`);
  if (oldTitle.test(file)) errors.push(`${file}: nome antigo no caminho`);
  if (/(^|\/)(node_modules|dist|dist-single|test-results|playwright-report|\.claude|\.codex|\.agents)(\/|$)|(^|\/)\.env(?:\.|$)|\.(pem|key|p12|pfx|bak)$/.test(file)) {
    errors.push(`${file}: arquivo local incluído no Git`);
  }
  if (!textFile.test(file)) continue;
  const content = fs.readFileSync(full, 'utf8');
  if (oldTitle.test(content)) errors.push(`${file}: título antigo no conteúdo`);
  if (secrets.test(content)) errors.push(`${file}: possível credencial privada; revise antes de publicar`);
  if (!file.endsWith('.md')) continue;
  // Remove blocos de código: caminhos de exemplo não são links de documentação.
  const prose = content.replace(/```[\s\S]*?```/g, '');
  const refs = [
    ...prose.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g),
    ...prose.matchAll(/(?:src|srcset|href)="([^"]+)"/g),
    ...prose.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm),
  ];
  for (const [, ref] of refs) {
    if (/^(?:[a-z]+:|#|\/\/)/i.test(ref)) continue;
    const rel = decodeURIComponent(ref.replace(/^<|>$/g, '').split(/[?#]/)[0]);
    if (!rel) continue;
    links++;
    if (!fs.existsSync(path.resolve(path.dirname(full), rel))) errors.push(`${file}: link local ausente → ${ref}`);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
if (pkg.name !== lock.name || pkg.version !== lock.version) errors.push('package.json e package-lock.json divergem');
for (const key of ['dependencies', 'devDependencies', 'engines']) {
  if (JSON.stringify(pkg[key]) !== JSON.stringify(lock.packages[''][key])) errors.push(`lockfile divergente: ${key}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`${files.length} arquivos · ${(bytes / 1024 / 1024).toFixed(1)} MiB · ${links} links locais válidos`);
  console.log('Identidade, lockfile, tamanhos e padrões de credenciais: OK.');
}
