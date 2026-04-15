#!/usr/bin/env node
// =============================================================================
// Alpha Print - Script de Bump de Versao
// =============================================================================
// Uso: node scripts/bump-version.mjs [patch|minor|major]
// Padrao: patch
//
// Regra de auto-promocao de versao (CEO 2026-04-15):
//   - patch + 1 >= 10  →  sobe minor automaticamente (x.y.10 → x.y+1.0)
//   - minor + 1 >= 10  →  sobe major automaticamente (x.10.z → x+1.0.0)
//   Exemplos: v1.0.9+patch=v1.0.10  |  v1.0.10+patch=v1.1.0  |  v1.9.10+patch=v2.0.0
//
// O que este script faz:
//   1. Valida que voce esta no branch "main" e sem mudancas pendentes
//   2. Le a versao atual do package.json
//   3. Calcula a nova versao (patch/minor/major) com regra de auto-promocao
//   4. Atualiza o package.json
//   5. Commita a mudanca de versao
//   6. Cria tag git (ex: v1.0.7)
//   7. Faz push do commit + tag pro GitHub
//
// Depois disso, o GitHub Actions (.github/workflows/release.yml) faz o resto:
//   - Builda o .exe com o nome correto (AlphaPrintSetup-1.0.7.exe)
//   - Cria o GitHub Release contendo APENAS esse .exe
//   - Os apps instalados recebem notificacao de update automaticamente
//
// NAO e necessario GITHUB_TOKEN local — o push da tag dispara o GitHub Actions.
// =============================================================================

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// --- Helpers ---

const log = (msg) => console.log(msg);
const err = (msg) => { console.error(`\nERRO: ${msg}\n`); process.exit(1); };

const run = (cmd) => {
  log(`> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
};

const capture = (cmd) =>
  execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();

// --- Argumento ---

const bumpType = process.argv[2] || 'patch';

if (!['patch', 'minor', 'major'].includes(bumpType)) {
  err(`tipo invalido "${bumpType}". Use: patch, minor ou major`);
}

// --- Ler versao atual ---

const pkgPath = resolve(ROOT, 'package.json');
let pkg;
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
} catch {
  err('Nao foi possivel ler o package.json');
}

const oldVersion = pkg.version;
if (!oldVersion || !/^\d+\.\d+\.\d+$/.test(oldVersion)) {
  err(`Versao invalida no package.json: "${oldVersion}"`);
}

// --- Calcular nova versao ---
//
// Regra de auto-promocao (CEO 2026-04-15):
//   patch >= 10  →  o proximo bump de patch vira bump de minor  (x.y.10 + patch = x.y+1.0)
//   minor >= 10  →  o proximo bump de minor vira bump de major  (x.10.y + minor = x+1.0.0)
//
// Exemplos:
//   v1.0.9  + patch → v1.0.10   (normal)
//   v1.0.10 + patch → v1.1.0    (patch saturado, sobe minor)
//   v1.9.10 + patch → v2.0.0    (patch saturado, minor saturado, sobe major)
//   v1.9.3  + minor → v1.10.0   (normal)
//   v1.10.0 + minor → v2.0.0    (minor saturado, sobe major)

const [maj, min, pat] = oldVersion.split('.').map(Number);
let newVersion;

if (bumpType === 'major') {
  newVersion = `${maj + 1}.0.0`;
} else if (bumpType === 'minor') {
  // minor saturado (>= 10) → sobe major
  if (min >= 10) newVersion = `${maj + 1}.0.0`;
  else           newVersion = `${maj}.${min + 1}.0`;
} else {
  // patch: calcula o proximo patch primeiro
  const nextPat = pat + 1;
  if (nextPat >= 10) {
    // patch saturado → sobe minor (ou major se minor tambem saturado)
    const nextMin = min + 1;
    if (nextMin >= 10) newVersion = `${maj + 1}.0.0`;
    else               newVersion = `${maj}.${nextMin}.0`;
  } else {
    newVersion = `${maj}.${min}.${nextPat}`;
  }
}

// --- Validacoes git ---

let branch;
try {
  branch = capture('git branch --show-current');
} catch {
  err('Nao foi possivel ler o branch atual. Verifique se este e um repositorio git.');
}

if (branch !== 'main') {
  err(`Voce precisa estar no branch "main". Branch atual: "${branch}"`);
}

const gitStatus = capture('git status --porcelain');
if (gitStatus) {
  err(`Ha mudancas nao commitadas. Commit ou stash antes de fazer release.\n\n${gitStatus}`);
}

// --- Confirmacao visual ---

log('');
log('========================================');
log('  Alpha Print - Bump de Versao');
log('========================================');
log(`  Versao atual : ${oldVersion}`);
log(`  Nova versao  : ${newVersion}  (${bumpType})`);
log('========================================');
log('');

// --- Puxar ultimas mudancas ---

log('Puxando mudancas mais recentes do GitHub...');
run('git pull origin main');

// --- Atualizar package.json ---

pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
log(`package.json atualizado: ${oldVersion} -> ${newVersion}`);

// --- Commit ---

log('');
log('Commitando mudanca de versao...');
run('git add package.json');

// Adiciona package-lock.json se existir
try {
  capture('git ls-files package-lock.json');
  run('git add package-lock.json');
} catch { /* package-lock nao rastreado, ignora */ }

run(`git commit -m "release: v${newVersion}"`);

// --- Tag ---

log('');
log(`Criando tag v${newVersion}...`);
run(`git tag v${newVersion}`);

// --- Push ---

log('');
log('Enviando para o GitHub...');
run('git push origin main');
run(`git push origin v${newVersion}`);

// --- Resultado ---

log('');
log('========================================');
log(`  Release v${newVersion} iniciado com sucesso!`);
log('========================================');
log('');
log('O GitHub Actions vai agora:');
log('  1. Detectar a tag v' + newVersion);
log('  2. Buildar o Alpha Print (Windows)');
log('  3. Criar instalador: AlphaPrintSetup-' + newVersion + '.exe');
log('  4. Publicar no GitHub Releases (somente este .exe)');
log('  5. Apps instalados receberao notificacao de update automaticamente');
log('');
log('Acompanhe o build:');
log('  https://github.com/jefteamaral1996/alpha-print/actions');
log('');
log('Release quando estiver pronto:');
log(`  https://github.com/jefteamaral1996/alpha-print/releases/tag/v${newVersion}`);
log('');
