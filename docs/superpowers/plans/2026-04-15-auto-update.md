# Plan: Auto-Update via GitHub Releases

**Goal:** Implementar atualizacao automatica silenciosa no Alpha Print — ao iniciar o app, verifica nova versao no GitHub Releases, baixa em background e pergunta ao usuario se quer reiniciar agora ou depois.
**Date:** 2026-04-15
**Spec:** N/A — requisitos passados diretamente pelo CEO via COO

## Diagnostico do Estado Atual

- `electron-updater` NAO esta no package.json (ausente em dependencies e devDependencies)
- `electron-builder` ja esta presente como devDependency (^26.0.0)
- `electron-builder.yml` NAO tem bloco `publish` configurado para GitHub
- `latest.yml` ja e gerado no build (versao 1.0.5 presente em release/)
- O `app.on("ready")` em `src/main/index.ts` e o ponto de entrada ideal para iniciar o updater
- Nao ha code signing — o update vai funcionar porem o Windows pode alertar (comportamento esperado, ja documentado no projeto)

## Arquitetura

1. Adicionar `electron-updater` como dependencia de runtime em package.json
2. Adicionar bloco `publish` no electron-builder.yml apontando para GitHub Releases
3. Criar modulo isolado `src/main/updater.ts` com toda a logica de auto-update
4. Integrar o modulo no `app.on("ready")` em `index.ts` (chamada unica apos setup inicial)
5. Bump de versao: 1.0.5 → 1.0.6
6. Gerar novo build

## Tech Stack / Key Dependencies

- `electron-updater` ^6.x — modulo de auto-update para Electron
- `electron-builder` ^26.0.0 — ja presente, gera `latest.yml` e blocos de update
- GitHub Releases — fonte publica das atualizacoes (NSIS installers + latest.yml)
- TypeScript 5.8

## Observacao de Seguranca (OWASP)

- O `electron-updater` verifica o hash SHA-512 de cada arquivo listado no `latest.yml` antes de instalar — protecao contra tamper/man-in-the-middle
- A URL de update vem da config do `electron-builder.yml` (estatica, nao injetavel pelo usuario)
- Nenhum input do usuario e usado para construir a URL ou caminhos de arquivo
- O app ja roda sem code signing (decisao do CEO) — o Windows SmartScreen vai alertar na PRIMEIRA instalacao de cada versao nova, comportamento esperado e ja documentado

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Adicionar `electron-updater` em dependencies |
| `electron-builder.yml` | Modify | Adicionar bloco `publish` com provider github, owner e repo |
| `src/main/updater.ts` | Create | Modulo isolado com toda logica de auto-update |
| `src/main/index.ts` | Modify | Importar e chamar `initAutoUpdater()` no `app.on("ready")` |

---

## Task 1: Adicionar electron-updater ao package.json

**Files:** `package.json`

### Steps

1. Instalar electron-updater:
   ```bash
   cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npm install electron-updater
   ```
   Expected: electron-updater adicionado em `dependencies` no package.json

2. Verificar que foi adicionado:
   ```bash
   node -e "const p = require('./package.json'); console.log(p.dependencies['electron-updater'])"
   ```
   Expected: string de versao (ex: `^6.6.2`)

3. Commit:
   ```bash
   git add package.json package-lock.json
   git commit -m "feat(deps): adicionar electron-updater para auto-update"
   ```

---

## Task 2: Configurar publish no electron-builder.yml

**Files:** `electron-builder.yml`

### Steps

1. Adicionar bloco `publish` ao final do arquivo:
   ```yaml
   publish:
     provider: github
     owner: jefteamaral
     repo: alpha-print
     releaseType: release
   ```
   
   Nota: O owner e repo devem corresponder exatamente ao repositorio GitHub onde os releases estao publicados. Se o repo nao existir ainda no GitHub, o auto-update ainda funciona para verificacao local (latest.yml presente), mas o download remoto vai falhar ate o repo existir com releases publicos.

2. Verificar sintaxe YAML valida:
   ```bash
   node -e "const yaml = require('js-yaml'); yaml.load(require('fs').readFileSync('./electron-builder.yml','utf8')); console.log('YAML valido')" 2>/dev/null || echo "js-yaml nao disponivel — verificar manualmente"
   ```

3. Commit:
   ```bash
   git add electron-builder.yml
   git commit -m "feat(build): configurar publish provider GitHub no electron-builder"
   ```

---

## Task 3: Criar src/main/updater.ts

**Files:** `src/main/updater.ts`

### Steps

1. Criar o arquivo `src/main/updater.ts` com o seguinte conteudo:

   ```typescript
   // ============================================================
   // updater.ts — Auto-Update via GitHub Releases
   // electron-updater: verifica versao ao iniciar, baixa em
   // background silenciosamente, pergunta ao usuario ao concluir
   // ============================================================

   import { autoUpdater } from "electron-updater";
   import { dialog, BrowserWindow } from "electron";

   export function initAutoUpdater(): void {
     // Silencioso durante download — nao incomoda o usuario
     autoUpdater.autoDownload = true;
     autoUpdater.autoInstallOnAppQuit = true;

     // Log de status (visivel no console do processo main)
     autoUpdater.on("checking-for-update", () => {
       console.log("[Updater] Verificando atualizacoes...");
     });

     autoUpdater.on("update-available", (info) => {
       console.log(`[Updater] Nova versao disponivel: ${info.version} — baixando em background...`);
     });

     autoUpdater.on("update-not-available", () => {
       console.log("[Updater] App esta atualizado.");
     });

     autoUpdater.on("error", (err) => {
       console.error("[Updater] Erro ao verificar/baixar atualizacao:", err.message);
       // Nao mostra dialog de erro pro usuario — falha silenciosa
     });

     autoUpdater.on("download-progress", (progress) => {
       const percent = Math.round(progress.percent);
       console.log(`[Updater] Download: ${percent}% (${Math.round(progress.transferred / 1024)}KB / ${Math.round(progress.total / 1024)}KB)`);
     });

     autoUpdater.on("update-downloaded", (info) => {
       console.log(`[Updater] Versao ${info.version} baixada. Perguntando ao usuario...`);

       const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

       dialog
         .showMessageBox(win || undefined!, {
           type: "info",
           title: "Atualizacao disponivel",
           message: `Uma nova versao do Alpha Print (${info.version}) foi baixada.`,
           detail: "Deseja reiniciar o aplicativo agora para instalar a atualizacao?",
           buttons: ["Reiniciar agora", "Depois"],
           defaultId: 0,
           cancelId: 1,
           icon: undefined,
         })
         .then(({ response }) => {
           if (response === 0) {
             console.log("[Updater] Usuario escolheu reiniciar agora — instalando...");
             autoUpdater.quitAndInstall(false, true);
           } else {
             console.log("[Updater] Usuario escolheu instalar depois — sera instalado ao fechar o app.");
           }
         })
         .catch((err) => {
           console.error("[Updater] Erro ao exibir dialog de update:", err);
         });
     });

     // Iniciar verificacao com delay de 3s para nao atrasar o boot do app
     setTimeout(() => {
       autoUpdater.checkForUpdates().catch((err) => {
         console.error("[Updater] checkForUpdates falhou:", err.message);
       });
     }, 3000);
   }
   ```

2. Verificar que o TypeScript compila sem erros:
   ```bash
   cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npx tsc --noEmit
   ```
   Expected: sem erros de tipo

3. Commit:
   ```bash
   git add src/main/updater.ts
   git commit -m "feat(updater): criar modulo de auto-update silencioso via GitHub Releases"
   ```

---

## Task 4: Integrar updater no index.ts

**Files:** `src/main/index.ts`

### Steps

1. Adicionar import no topo do arquivo (apos os imports existentes):
   ```typescript
   import { initAutoUpdater } from "./updater";
   ```

2. No `app.on("ready", async () => { ... })`, adicionar chamada a `initAutoUpdater()` DEPOIS de `setupAutoStart()` e ANTES de verificar login:
   ```typescript
   app.on("ready", async () => {
     setupAutoStart();
     initAutoUpdater(); // <-- adicionar aqui
     createTray(showWindow, quitApp);
     // ... resto do codigo existente
   ```

3. Verificar que o TypeScript compila sem erros:
   ```bash
   cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npx tsc --noEmit
   ```
   Expected: sem erros

4. Commit:
   ```bash
   git add src/main/index.ts
   git commit -m "feat(main): integrar auto-updater no app ready"
   ```

---

## Task 5: Bump de versao e build

**Files:** `package.json`

### Steps

1. Atualizar versao no package.json: `"version": "1.0.5"` → `"version": "1.0.6"`

2. Gerar o build:
   ```bash
   cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npm run build
   ```
   Expected: `release/AlphaPrintSetup-1.0.6.exe` criado, `release/latest.yml` atualizado para versao 1.0.6

3. Verificar que latest.yml foi atualizado:
   ```bash
   cat "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print/release/latest.yml"
   ```
   Expected: `version: 1.0.6` no topo do arquivo

4. Commit:
   ```bash
   git add package.json package-lock.json release/
   git commit -m "feat(release): v1.0.6 — auto-update via GitHub Releases"
   ```

---

## Checklist de Entrega

- [ ] `electron-updater` presente em `dependencies` no package.json
- [ ] Bloco `publish` configurado no electron-builder.yml
- [ ] `src/main/updater.ts` criado com logica silenciosa + dialog "agora/depois"
- [ ] `initAutoUpdater()` chamado no `app.on("ready")` do index.ts
- [ ] `autoInstallOnAppQuit: true` garantido (instala automaticamente se usuario escolher "depois")
- [ ] TypeScript compila sem erros (`npx tsc --noEmit`)
- [ ] Build v1.0.6 gerado com sucesso
- [ ] `release/latest.yml` atualizado para 1.0.6
- [ ] OWASP: URL de update nao injetavel (hardcoded no yml), SHA-512 verificado pelo electron-updater automaticamente

## Notas sobre GitHub Releases

Para o auto-update funcionar em producao (usuarios reais baixando update):
1. O repositorio GitHub `alpha-print` precisa existir (publico ou privado com token)
2. O `release/AlphaPrintSetup-1.0.6.exe`, `release/AlphaPrintSetup-1.0.6.exe.blockmap` e `release/latest.yml` precisam ser publicados como assets de uma GitHub Release com tag `v1.0.6`
3. Se o repo for privado, o `electron-updater` precisa de `GH_TOKEN` no ambiente de build

Para testar localmente sem GitHub, o `electron-updater` pode usar `autoUpdater.setFeedURL` com um servidor local, mas isso esta fora do escopo deste plano.
