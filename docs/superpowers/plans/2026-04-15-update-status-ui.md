# Plan: Update Status UI — Versao Visivel + Botao Verificar Atualizacoes

**Goal:** Adicionar versao atual visivel na UI, botao "Verificar atualizacoes agora" com feedback visual em tempo real (verificando, baixando X%, pronto para instalar), e publicar como v1.0.8.
**Date:** 2026-04-15

## Architecture

O electron-updater ja roda silenciosamente em background. O que falta e:
1. Expor os eventos do updater para o renderer via IPC push (main → renderer)
2. Adicionar canal IPC para trigger manual do `checkForUpdates()`
3. Adicionar secao "Atualizacoes" na UI com versao atual + botao + status em tempo real

O fluxo de dados e:
```
Renderer clica "Verificar" 
  → ipcRenderer.invoke("updater:checkNow")
  → main chama autoUpdater.checkForUpdates()
  → autoUpdater dispara eventos (checking, available, not-available, progress, downloaded)
  → main faz mainWindow.webContents.send("updater:status", payload)
  → renderer atualiza UI com o status recebido
```

A versao atual ja e exposta pelo canal `app:info` existente (campo `version`). Nao e necessario criar novo canal para isso — apenas usar o que ja existe.

## Tech Stack / Key Dependencies

- Electron 36 (IPC: ipcMain/ipcRenderer + contextBridge)
- electron-updater 6.8.3 (ja instalado)
- Vanilla JS no renderer (nao React — app.js + index.html + styles.css)
- TypeScript no main process

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/updater.ts` | Modify | Aceitar referencia a `mainWindow` para push de eventos; registrar handler IPC `updater:checkNow` |
| `src/main/index.ts` | Modify | Passar `mainWindow` getter pro updater apos janela criada; registrar handler IPC `updater:checkNow` |
| `src/main/preload.ts` | Modify | Expor `checkForUpdates()` e `onUpdaterStatus(callback)` via contextBridge |
| `src/renderer/index.html` | Modify | Adicionar secao "Atualizacoes" com versao + botao + area de status |
| `src/renderer/app.js` | Modify | Conectar botao ao IPC; receber e renderizar status em tempo real |
| `src/renderer/styles.css` | Modify | Estilos para secao de atualizacao, barra de progresso, badge de status |

---

## Task 1: Refatorar updater.ts para suportar push de status ao renderer

**Files:** `src/main/updater.ts`

### Steps

1. Modificar a assinatura de `initAutoUpdater` para aceitar um getter de janela e registrar o handler IPC:

```typescript
// Novo import no topo
import { autoUpdater } from "electron-updater";
import { dialog, BrowserWindow, ipcMain } from "electron";

// Tipo do payload de status
export interface UpdaterStatusPayload {
  state: "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  version?: string;
  percent?: number;
  error?: string;
}

// Funcao helper para enviar status ao renderer
function sendStatus(getWindow: () => BrowserWindow | null, payload: UpdaterStatusPayload): void {
  const win = getWindow();
  win?.webContents.send("updater:status", payload);
}

// Assinatura atualizada: aceita getter de janela
export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  // ... configuracao existente permanece igual ...

  // Substituir cada console.log de evento por sendStatus() tambem:
  autoUpdater.on("checking-for-update", () => {
    console.log("[Updater] Verificando atualizacoes...");
    sendStatus(getWindow, { state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[Updater] Nova versao disponivel: ${info.version}`);
    sendStatus(getWindow, { state: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[Updater] App esta atualizado.");
    sendStatus(getWindow, { state: "not-available" });
  });

  autoUpdater.on("error", (err) => {
    console.error("[Updater] Erro:", err.message);
    sendStatus(getWindow, { state: "error", error: err.message });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent);
    console.log(`[Updater] Download: ${percent}%`);
    sendStatus(getWindow, { state: "downloading", percent });
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[Updater] Versao ${info.version} baixada.`);
    sendStatus(getWindow, { state: "downloaded", version: info.version });
    // ... dialog existente permanece igual ...
  });

  // Handler IPC para trigger manual
  ipcMain.handle("updater:checkNow", () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[Updater] checkForUpdates manual falhou:", err.message);
    });
    return { triggered: true };
  });

  // Check automatico ao iniciar (delay de 3s — ja existia)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[Updater] checkForUpdates falhou:", err.message);
    });
  }, 3000);
}
```

2. Verificar compilacao TypeScript:
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npx tsc --noEmit
```
Esperado: sem erros.

3. Commit:
```bash
git add src/main/updater.ts
git commit -m "feat(updater): expor status via IPC push + handler checkNow manual"
```

---

## Task 2: Atualizar index.ts para passar getter de mainWindow ao updater

**Files:** `src/main/index.ts`

### Steps

1. Alterar a chamada de `initAutoUpdater()` para passar um getter de `mainWindow`:

```typescript
// Linha atual (dentro de app.on("ready")):
initAutoUpdater();

// Substituir por:
initAutoUpdater(() => mainWindow);
```

Isso garante que o updater sempre tem acesso a janela atual, mesmo que ela seja recriada.

2. Verificar compilacao:
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npx tsc --noEmit
```
Esperado: sem erros.

3. Commit:
```bash
git add src/main/index.ts
git commit -m "feat(main): passar getter de mainWindow ao initAutoUpdater"
```

---

## Task 3: Expor IPC de atualizacao no preload.ts

**Files:** `src/main/preload.ts`

### Steps

1. Adicionar dois metodos ao objeto `alphaPrint` exposto via contextBridge:

```typescript
// Adicionar apos os metodos existentes (antes do fechamento do objeto):

  // Updater: trigger manual
  checkForUpdates: () => ipcRenderer.invoke("updater:checkNow"),

  // Updater: receber status em tempo real do main process
  onUpdaterStatus: (callback: (payload: { state: string; version?: string; percent?: number; error?: string }) => void) => {
    ipcRenderer.on("updater:status", (_event, payload) => callback(payload));
  },
```

2. Verificar compilacao:
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npx tsc --noEmit
```
Esperado: sem erros.

3. Commit:
```bash
git add src/main/preload.ts
git commit -m "feat(preload): expor checkForUpdates e onUpdaterStatus via contextBridge"
```

---

## Task 4: Adicionar secao de atualizacao no index.html

**Files:** `src/renderer/index.html`

### Steps

1. Adicionar secao "Atualizacoes" na main-screen, ANTES da secao "Informacoes" existente (que tem id `app-info`):

```html
<!-- Updates -->
<div class="section">
  <div class="section-header">
    <h3>Atualizacoes</h3>
  </div>
  <div id="update-section" class="update-section">
    <div class="update-version-row">
      <span class="label">Versao instalada:</span>
      <span id="update-current-version" class="value">...</span>
    </div>
    <div id="update-status-row" class="update-status-row hidden">
      <div id="update-status-dot" class="update-dot"></div>
      <span id="update-status-text" class="update-status-text"></span>
    </div>
    <div id="update-progress-bar-wrap" class="update-progress-bar-wrap hidden">
      <div id="update-progress-bar" class="update-progress-bar" style="width: 0%"></div>
    </div>
    <button id="check-update-btn" class="btn-secondary" onclick="doCheckUpdates()">
      Verificar atualizacoes
    </button>
  </div>
</div>
```

2. Confirmar posicionamento correto: a secao deve ficar entre a secao "Informacoes do Portal" e a secao "Informacoes" (app-info).

3. Commit:
```bash
git add src/renderer/index.html
git commit -m "feat(renderer): adicionar secao de atualizacoes no HTML"
```

---

## Task 5: Conectar logica de atualizacao no app.js

**Files:** `src/renderer/app.js`

### Steps

1. Adicionar referencia ao elemento botao de update no bloco de DOM Elements:
```javascript
const checkUpdateBtn = document.getElementById("check-update-btn");
const updateCurrentVersion = document.getElementById("update-current-version");
const updateStatusRow = document.getElementById("update-status-row");
const updateStatusDot = document.getElementById("update-status-dot");
const updateStatusText = document.getElementById("update-status-text");
const updateProgressBarWrap = document.getElementById("update-progress-bar-wrap");
const updateProgressBar = document.getElementById("update-progress-bar");
```

2. Adicionar funcao `updateUpdaterStatus(payload)` que reage a cada estado:
```javascript
function updateUpdaterStatus(payload) {
  if (!updateStatusRow) return;

  updateStatusDot.className = "update-dot";
  updateProgressBarWrap.classList.add("hidden");

  switch (payload.state) {
    case "checking":
      updateStatusRow.classList.remove("hidden");
      updateStatusDot.classList.add("checking");
      updateStatusText.textContent = "Verificando atualizacoes...";
      if (checkUpdateBtn) { checkUpdateBtn.disabled = true; checkUpdateBtn.textContent = "Verificando..."; }
      break;

    case "available":
      updateStatusRow.classList.remove("hidden");
      updateStatusDot.classList.add("yellow");
      updateStatusText.textContent = `Nova versao disponivel: v${payload.version || ""}`;
      if (checkUpdateBtn) { checkUpdateBtn.disabled = true; checkUpdateBtn.textContent = "Baixando..."; }
      break;

    case "not-available":
      updateStatusRow.classList.remove("hidden");
      updateStatusDot.classList.add("green");
      updateStatusText.textContent = "Ja esta na versao mais recente.";
      if (checkUpdateBtn) { checkUpdateBtn.disabled = false; checkUpdateBtn.textContent = "Verificar atualizacoes"; }
      // Oculta status apos 4s
      setTimeout(() => { updateStatusRow.classList.add("hidden"); }, 4000);
      break;

    case "downloading":
      updateStatusRow.classList.remove("hidden");
      updateStatusDot.classList.add("yellow");
      updateStatusText.textContent = `Baixando atualizacao... ${payload.percent || 0}%`;
      updateProgressBarWrap.classList.remove("hidden");
      if (updateProgressBar) updateProgressBar.style.width = `${payload.percent || 0}%`;
      if (checkUpdateBtn) { checkUpdateBtn.disabled = true; checkUpdateBtn.textContent = `Baixando ${payload.percent || 0}%...`; }
      break;

    case "downloaded":
      updateStatusRow.classList.remove("hidden");
      updateStatusDot.classList.add("green");
      updateStatusText.textContent = `v${payload.version || ""} pronta para instalar. Reinicie o app.`;
      if (checkUpdateBtn) { checkUpdateBtn.disabled = true; checkUpdateBtn.textContent = "Reiniciando ao fechar"; }
      break;

    case "error":
      updateStatusRow.classList.remove("hidden");
      updateStatusDot.classList.add("red");
      updateStatusText.textContent = "Erro ao verificar atualizacao.";
      if (checkUpdateBtn) { checkUpdateBtn.disabled = false; checkUpdateBtn.textContent = "Tentar novamente"; }
      break;
  }
}
```

3. Adicionar funcao `doCheckUpdates()`:
```javascript
async function doCheckUpdates() {
  if (!checkUpdateBtn) return;
  try {
    await api.checkForUpdates();
  } catch {
    // O status de erro chegara via onUpdaterStatus
  }
}
```

4. Em `init()`, registrar o listener de status e preencher a versao atual. Adicionar APOS as linhas de `api.onPrintersUpdated`:
```javascript
// Updater status em tempo real
api.onUpdaterStatus((payload) => {
  updateUpdaterStatus(payload);
});
```

5. Em `showMainScreen()`, preencher a versao atual apos o `const appInfo = await api.getAppInfo();`:
```javascript
// Mostrar versao atual na secao de atualizacoes
if (updateCurrentVersion) {
  updateCurrentVersion.textContent = `v${appInfo.version}`;
}
```

6. Registrar `doCheckUpdates` no escopo global (junto com os outros ao final do arquivo):
```javascript
window.doCheckUpdates = doCheckUpdates;
```

7. Verificar que `doReconnect` ja esta registrado (para nao duplicar):
Apenas adicionar `window.doCheckUpdates = doCheckUpdates;` — as outras linhas ja existem.

3. Commit:
```bash
git add src/renderer/app.js
git commit -m "feat(renderer): conectar logica de status de atualizacao na UI"
```

---

## Task 6: Adicionar estilos para a secao de atualizacao

**Files:** `src/renderer/styles.css`

### Steps

1. Adicionar os seguintes estilos ao final do arquivo (antes de qualquer `@media` existente, ou ao final):

```css
/* ── Update Section ── */

.update-version-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.update-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #374151;
}

.update-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #d1d5db;
}

.update-dot.green  { background: #22c55e; }
.update-dot.yellow { background: #f59e0b; }
.update-dot.red    { background: #ef4444; }
.update-dot.checking {
  background: #6366f1;
  animation: pulse 1.2s ease-in-out infinite;
}

.update-progress-bar-wrap {
  height: 4px;
  background: #e5e7eb;
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 10px;
}

.update-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #8b5cf6);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: #f3f4f6;
  color: #374151;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.btn-secondary:hover:not(:disabled) {
  background: #e9ecef;
  border-color: #d1d5db;
}

.btn-secondary:disabled {
  opacity: 0.6;
  cursor: default;
}
```

2. Verificar que a classe `pulse` usada em `.update-dot.checking` ja existe no CSS (usada pelo `.status-dot.checking`). Se existir, nao duplicar.

3. Commit:
```bash
git add src/renderer/styles.css
git commit -m "feat(styles): adicionar estilos para secao de atualizacoes"
```

---

## Task 7: Build e publicacao v1.0.8

**Files:** `package.json` (via script)

### Steps

1. Garantir que todos os arquivos modificados estao commitados:
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && git status
```
Esperado: "nothing to commit, working tree clean"

2. Confirmar branch main:
```bash
git branch --show-current
```
Esperado: `main`

3. Rodar o script de release:
```bash
node scripts/bump-version.mjs patch
```
Esperado: versao 1.0.7 → 1.0.8, commit "release: v1.0.8" criado, tag v1.0.8 criada, push realizado.

4. Verificar que o GitHub Actions esta rodando:
```
https://github.com/jefteamaral1996/alpha-print/actions
```
Esperado: workflow "Release" rodando para a tag v1.0.8.

5. Apos o Actions concluir (~5-10 min), verificar o release:
```
https://github.com/jefteamaral1996/alpha-print/releases/latest
```
Esperado: Release v1.0.8 com `AlphaPrintSetup-1.0.8.exe` e `latest.yml`.

---

## Resumo dos Commits

```
feat(updater): expor status via IPC push + handler checkNow manual
feat(main): passar getter de mainWindow ao initAutoUpdater
feat(preload): expor checkForUpdates e onUpdaterStatus via contextBridge
feat(renderer): adicionar secao de atualizacoes no HTML
feat(renderer): conectar logica de status de atualizacao na UI
feat(styles): adicionar estilos para secao de atualizacoes
release: v1.0.8 (gerado pelo bump-version.mjs)
```
