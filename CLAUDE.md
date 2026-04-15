# Alpha Print — Regras do Projeto

## REGRA PRINCIPAL: Como Publicar uma Nova Versao

**UNICO comando para fazer release:**

```
node scripts/bump-version.mjs patch
```

Ou para versoes maiores:
```
node scripts/bump-version.mjs minor
node scripts/bump-version.mjs major
```

**NAO** crie releases manualmente no GitHub. **NAO** faça upload de .exe direto. Use sempre o script.

---

## O que o Script Faz (Passo a Passo)

1. Valida que voce esta no branch `main` e sem mudancas pendentes
2. Le a versao atual do `package.json` (ex: `1.0.6`)
3. Calcula a nova versao (ex: `1.0.7` para patch)
4. Atualiza o `package.json`
5. Commita: `git commit -m "release: v1.0.7"`
6. Cria tag: `git tag v1.0.7`
7. Push do commit + tag pro GitHub

Depois do push, o **GitHub Actions** (`.github/workflows/release.yml`) assume:
- Builda o `.exe` na maquina Windows do GitHub
- Cria o GitHub Release com APENAS `AlphaPrintSetup-1.0.7.exe`
- O `latest.yml` e atualizado com a versao e hash corretos
- Apps instalados recebem notificacao de update automaticamente (electron-updater)

---

## Onde a Versao Aparece no Projeto

| Arquivo | Como a versao entra | Quem atualiza |
|---------|--------------------|----|
| `package.json` | Campo `"version"` | O script bump-version.mjs |
| `release/latest.yml` | Gerado pelo electron-builder durante o build | GitHub Actions automaticamente |
| Nome do .exe | `AlphaPrintSetup-{version}.exe` — definido em `electron-builder.yml` via `artifactName` | GitHub Actions automaticamente |
| GitHub Release | Tag `v{version}` e asset `AlphaPrintSetup-{version}.exe` | GitHub Actions automaticamente |

**Nao ha versao hardcoded em nenhum outro arquivo.** O `electron-builder.yml` le a versao do `package.json` automaticamente.

---

## Como o Auto-Update Funciona

```
node scripts/bump-version.mjs patch
         |
         v
  package.json: 1.0.6 -> 1.0.7
  git tag v1.0.7 + push
         |
         v
  GitHub Actions detecta tag v1.0.7
  Build: AlphaPrintSetup-1.0.7.exe
         |
         v
  GitHub Release criado com APENAS AlphaPrintSetup-1.0.7.exe
  (fail_on_unmatched_files: true — se nome errado, o release falha)
         |
         v
  latest.yml atualizado (versao 1.0.7 + sha512 correto)
         |
         v
  electron-updater nos apps instalados detecta nova versao
  Usuario recebe notificacao de update na bandeja do sistema
```

---

## Por que Nao Precisa de GITHUB_TOKEN Local

O script nao faz chamadas a API do GitHub. Ele apenas faz `git push` da tag. O GitHub Actions usa automaticamente o `secrets.GITHUB_TOKEN` interno para criar o release — esse token nunca sai do ambiente do GitHub.

Voce **nao precisa** de nenhum `.env` para rodar o script de release.

---

## Diagnostico: O que fazer se o Release der Errado

### "fail_on_unmatched_files" falhou no GitHub Actions
- O .exe nao foi gerado com o nome esperado
- Verifique o log do Actions: https://github.com/jefteamaral1996/alpha-print/actions
- Verifique se o `electron-builder.yml` tem `artifactName: "AlphaPrintSetup-${version}.${ext}"`

### O app instalado nao esta recebendo update
1. Verifique se o release existe: https://github.com/jefteamaral1996/alpha-print/releases/latest
2. Verifique se o release contem o `latest.yml` e o `.exe` com o nome correto
3. O `latest.yml` deve conter a versao nova e o sha512 correto
4. O electron-updater verifica a cada 24h por padrao (pode ser configurado em `src/main/index.ts`)

### Assets duplicados no release (problema que motivou este script)
- Isso acontece se voce criar o release manualmente e fazer upload de .exe de versoes antigas
- A solucao e: **sempre usar o script** e **nunca fazer upload manual**
- O GitHub Actions com `fail_on_unmatched_files: true` previne isso automaticamente

---

## Stack Tecnica

- **Electron** (app desktop Windows)
- **TypeScript** (compilado para `dist/`)
- **electron-updater** (auto-update via GitHub Releases)
- **electron-builder** (empacota o .exe, configura em `electron-builder.yml`)
- **GitHub Actions** (CI/CD: builda e publica releases)
- **Supabase** (backend para jobs de impressao)

## Estrutura do Projeto

```
alpha-print/
  src/
    main/         — processo principal do Electron (Node.js)
    renderer/     — interface HTML/CSS/JS
  dist/           — compilado TypeScript (gerado, nao commitar)
  release/        — builds locais (gerado, nao commitar)
  assets/         — icones e recursos estaticos
  scripts/
    bump-version.mjs   — USAR ESTE para fazer release
    release.sh         — versao Bash (para quem usa WSL/Linux)
  .github/workflows/
    release.yml        — GitHub Actions: build + publish
  electron-builder.yml — configuracao de build e publish
```
