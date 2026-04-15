# Plan: Script de Bump de Versao para Alpha Print

**Goal:** Criar um script Node.js (bump-version.mjs) que atualiza a versao em todos os lugares, garante que o release no GitHub contenha apenas o .exe da versao nova, e documenta o processo no CLAUDE.md.

**Date:** 2026-04-15

## Diagnostico do Problema Real

O problema vivido hoje (v1.0.6 com asset v1.0.5.exe no release) **NAO foi causado** pelo script `release.sh` — ele esta correto e usa GitHub Actions para o build. O problema foi que o release foi criado manualmente (ou com upload extra de asset antigo).

O fluxo atual funciona assim:
1. `bash scripts/release.sh patch` → bumpa package.json, commita, cria tag, push
2. GitHub Actions (`.github/workflows/release.yml`) detecta a tag → builda o .exe → cria o GitHub Release com APENAS `AlphaPrintSetup-{version}.exe`
3. O workflow usa `fail_on_unmatched_files: true` — se o .exe nao existir com o nome certo, o release falha

**O problema real:** O `release.sh` e um script Bash que **nao funciona no Windows** sem WSL/Git Bash. Alem disso, nao ha um script Node.js (`.mjs`) que o CEO pode chamar diretamente via `node scripts/bump-version.mjs patch`.

**O que ja funciona:**
- GitHub Actions workflow esta correto — builda e publica com o nome certo
- `fail_on_unmatched_files: true` ja previne upload de asset errado
- Portal busca via GitHub API e resolve nome do .exe dinamicamente
- `electron-updater` ja implementado — quando o release e publicado, apps instalados recebem update

**O que precisa ser criado:**
1. `scripts/bump-version.mjs` — versao Node.js do release.sh (funciona no Windows sem dependencias extras)
2. `CLAUDE.md` no alpha-print com a regra documentada

## Architecture

O `bump-version.mjs` substitui o `release.sh` com vantagens:
- Funciona em Windows sem WSL (`node scripts/bump-version.mjs patch`)
- Logica em JavaScript (mais facil de manter)
- Validacoes mais robustas
- Usa `child_process` para chamar git, nunca faz HTTP para GitHub (o GitHub Actions cuida do build/release)
- NAO precisa de GITHUB_TOKEN — o push da tag dispara o GitHub Actions automaticamente

## Tech Stack / Key Dependencies

- Node.js ESM (`.mjs`) — sem dependencias externas
- `child_process.execSync` para git
- `fs` e `path` nativos
- `JSON.parse/stringify` para package.json

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/bump-version.mjs` | Create | Script Node.js para bump de versao e push de tag |
| `CLAUDE.md` | Create | Documentacao do processo de release para o projeto |
| `scripts/release.sh` | Keep | Manter como referencia (Bash para quem usar WSL/Linux) |

---

## Task 1: Criar scripts/bump-version.mjs

**Files:** `scripts/bump-version.mjs`

### Steps

1. Criar o arquivo com logica completa:

```javascript
#!/usr/bin/env node
// scripts/bump-version.mjs
// Uso: node scripts/bump-version.mjs [patch|minor|major]
// Padrao: patch

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// --- Helpers ---
const run = (cmd, opts = {}) => {
  console.log(`> ${cmd}`);
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
};

const runCapture = (cmd) => {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
};

// --- Leitura do package.json ---
const pkgPath = resolve(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const oldVersion = pkg.version;

// --- Calculo da nova versao ---
const bumpType = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error(`Erro: tipo invalido "${bumpType}". Use: patch, minor ou major`);
  process.exit(1);
}

const [major, minor, patch] = oldVersion.split('.').map(Number);
let newVersion;
if (bumpType === 'major') newVersion = `${major + 1}.0.0`;
else if (bumpType === 'minor') newVersion = `${major}.${minor + 1}.0`;
else newVersion = `${major}.${minor}.${patch + 1}`;

// --- Validacoes ---
const branch = runCapture('git branch --show-current');
if (branch !== 'main') {
  console.error(`Erro: voce precisa estar no branch "main". Branch atual: ${branch}`);
  process.exit(1);
}

const gitStatus = runCapture('git status --porcelain');
if (gitStatus) {
  console.error('Erro: ha mudancas nao commitadas. Commit ou stash antes de fazer release.');
  console.error(gitStatus);
  process.exit(1);
}

// --- Confirmacao ---
console.log('');
console.log('========================================');
console.log('  Alpha Print - Bump de Versao');
console.log('========================================');
console.log(`  Versao atual : ${oldVersion}`);
console.log(`  Nova versao  : ${newVersion}  (${bumpType})`);
console.log('========================================');
console.log('');

// --- Atualizar package.json ---
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`package.json atualizado: ${oldVersion} -> ${newVersion}`);

// --- Commit, Tag, Push ---
run('git pull origin main');
run('git add package.json package-lock.json');
try { run('git add package-lock.json'); } catch {}
run(`git commit -m "release: v${newVersion}"`);
run(`git tag v${newVersion}`);
run('git push origin main');
run(`git push origin v${newVersion}`);

console.log('');
console.log('========================================');
console.log(`  Release v${newVersion} iniciado!`);
console.log('========================================');
console.log('');
console.log('O GitHub Actions vai agora:');
console.log('  1. Detectar a tag v' + newVersion);
console.log('  2. Buildar o Alpha Print (Windows)');
console.log('  3. Criar instalador AlphaPrintSetup-' + newVersion + '.exe');
console.log('  4. Publicar no GitHub Releases');
console.log('  5. Apps instalados receberao notificacao de update automaticamente');
console.log('');
console.log('Acompanhe: https://github.com/jefteamaral1996/alpha-print/actions');
console.log(`Release:   https://github.com/jefteamaral1996/alpha-print/releases/tag/v${newVersion}`);
```

2. Verificar que o arquivo foi criado:
   ```bash
   ls scripts/bump-version.mjs
   ```
   Expected: arquivo existe

3. Verificar que nenhum token/secret aparece no script:
   ```bash
   grep -i "token\|secret\|password\|key" scripts/bump-version.mjs
   ```
   Expected: sem resultados (o script nao usa GITHUB_TOKEN — quem faz o release e o GitHub Actions)

4. Commit:
   ```bash
   git add scripts/bump-version.mjs
   git commit -m "feat(scripts): adicionar bump-version.mjs para release no Windows"
   ```

---

## Task 2: Criar CLAUDE.md no alpha-print

**Files:** `CLAUDE.md`

### Steps

1. Criar o arquivo com documentacao completa do processo de release:

O conteudo deve cobrir:
- Como fazer um release novo (comando unico)
- O que o script faz passo a passo
- Como o auto-update funciona
- Onde a versao aparece no projeto
- Regra de seguranca para GITHUB_TOKEN
- Como diagnosticar se o release deu errado

2. Verificar que o arquivo foi criado com o comando documentado corretamente.

3. Commit:
   ```bash
   git add CLAUDE.md
   git commit -m "docs: criar CLAUDE.md com processo de release do Alpha Print"
   ```

---

## Task 3: Checklist de Seguranca (OWASP)

**Files:** `scripts/bump-version.mjs`, `.gitignore`

### Verificacoes obrigatorias:

1. **GITHUB_TOKEN** — O script NAO usa GITHUB_TOKEN. O push da tag dispara o GitHub Actions, que usa `secrets.GITHUB_TOKEN` automaticamente (nunca exposto localmente). APROVADO.

2. **.env no .gitignore** — Verificar que `.env` esta no `.gitignore`:
   ```bash
   grep "\.env" .gitignore
   ```
   Expected: `.env` aparece na lista

3. **Sem dados sensiveis em logs** — O script so loga comandos git e mensagens de status. NAO loga tokens, senhas ou dados de usuario. APROVADO.

4. **Injection via argumento** — O argumento `bumpType` e validado contra whitelist `['patch', 'minor', 'major']` antes de qualquer uso. APROVADO.

5. **Sem `eval` ou `exec` com input do usuario** — O script usa `execSync` apenas com strings literais ou a variavel `newVersion` que e calculada internamente (nunca do input direto). APROVADO.

---

## Regra Final — Como o Auto-Update Funciona

```
node scripts/bump-version.mjs patch
         |
         v
  package.json atualizado (1.0.6 -> 1.0.7)
         |
         v
  git commit + tag v1.0.7 + push
         |
         v
  GitHub Actions detecta tag v1.0.7
         |
         v
  Build: AlphaPrintSetup-1.0.7.exe
         |
         v
  GitHub Release criado com APENAS AlphaPrintSetup-1.0.7.exe
  (fail_on_unmatched_files: true garante que nao tem exe errado)
         |
         v
  latest.yml atualizado com versao 1.0.7 e hash correto
         |
         v
  electron-updater nos apps instalados detecta nova versao
         |
         v
  Usuario recebe notificacao de update automatica
```

## Por que o Problema de Hoje NAO vai se Repetir

O problema foi que um upload manual colocou o exe errado no release. Com o fluxo do script:
- Todo release passa pelo GitHub Actions
- O workflow usa `fail_on_unmatched_files: true` — se o nome do .exe nao bater com a versao da tag, o release **falha** em vez de publicar errado
- Nao ha mais motivo para upload manual de .exe
- O portal usa GitHub API para resolver o nome do asset dinamicamente — mesmo se houvesse dois .exe, ele pegaria o correto pelo nome `AlphaPrintSetup-{version}.exe`
