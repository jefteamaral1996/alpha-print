# Plan: Reconexao Robusta no Alpha Print

**Goal:** Adicionar multiplos mecanismos de reconexao automatica ao Alpha Print para que o app nunca fique preso em "Tentando reconectar..." sem precisar fechar/abrir.
**Date:** 2026-04-15
**Tipo:** C — Codigo / Tamanho: M

## Diagnostico do Problema

O mecanismo atual (`scheduleReconnect`) tem as seguintes falhas:

1. **Guard `if (reconnectTimer) return`**: se um timer ja existe, qualquer nova tentativa e ignorada. Se o timer falhar silenciosamente ou o canal entrar em loop de erro sem acionar o callback de status, o guard bloqueia novas reconexoes para sempre.

2. **Sem watchdog de estado**: nao ha nenhum processo que observe se o canal ficou preso em `reconnecting` por muito tempo e force uma nova tentativa.

3. **Sem forcado reset do cliente Supabase**: ao reconectar, os canais sao removidos mas o singleton `supabase` continua o mesmo — se a websocket subjacente entrou em estado corrompido, recriar canais no mesmo cliente nao resolve.

4. **Sem deteccao de "conectado mas sem resposta"**: o canal pode reportar `SUBSCRIBED` mas na pratica nao receber eventos (o servidor web-socket pode ter morrido silenciosamente). Sem heartbeat/ping proprio, nao ha como saber.

5. **Token expirado nao aciona reconexao**: se o token JWT vencer enquanto o canal esta ativo, o Supabase pode desconectar sem acionar `CHANNEL_ERROR`, deixando o status preso.

6. **UI nao tem botao manual de reconexao**: usuario fica sem opcao quando o automatico falha.

## Solucao: 4 Mecanismos Complementares

| Mecanismo | O que resolve | Onde |
|-----------|--------------|------|
| **Watchdog de estado** | Detecta "preso em reconnecting > 60s" e forca novo ciclo | `print-listener.ts` |
| **Heartbeat de canal** | Detecta canal "conectado" mas silencioso (sem eventos por N min) | `print-listener.ts` |
| **Reset completo do cliente Supabase** | Garante que websocket corrompida seja descartada | `supabase.ts` + `print-listener.ts` |
| **Botao manual de reconexao na UI** | Ultimo recurso para o usuario — reinicia servico sem fechar app | `preload.ts` + `index.ts` + `app.js` |

## Architecture

- `print-listener.ts` recebe os 3 mecanismos automaticos (watchdog, heartbeat, reset de cliente)
- `supabase.ts` expoe `resetSupabaseClient()` para criar novo singleton quando necessario
- `index.ts` expoe IPC `connection:reconnect` para o renderer
- `preload.ts` expoe `reconnect()` para o renderer via contextBridge
- `app.js` adiciona botao "Reconectar" na UI e logica de clique

## Tech Stack / Key Dependencies

- Electron (main process + renderer)
- @supabase/supabase-js (Realtime websocket)
- electron-store (tokens persistidos)
- TypeScript (main process), vanilla JS (renderer)

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/supabase.ts` | Modify | Adicionar `resetSupabaseClient()` que destroi singleton |
| `src/main/print-listener.ts` | Modify | Watchdog de estado, heartbeat, usar resetSupabaseClient no ciclo de reconexao |
| `src/main/index.ts` | Modify | IPC handler `connection:reconnect` que chama `stopListening` + `startListening` |
| `src/main/preload.ts` | Modify | Expor `reconnect()` via contextBridge |
| `src/renderer/app.js` | Modify | Botao "Reconectar" na UI, handler de clique, feedback visual |

---

## Task 1: resetSupabaseClient em supabase.ts

**Files:** `src/main/supabase.ts`

### Steps

1. Adicionar funcao `resetSupabaseClient()` que nulifica o singleton, forcando `getSupabase()` a criar nova instancia na proxima chamada:

```typescript
/**
 * Destroy the current Supabase singleton so the next getSupabase() call
 * creates a fresh client with a new WebSocket connection.
 * Use before a full reconnect cycle when the socket may be corrupted.
 */
export function resetSupabaseClient(): void {
  if (supabase) {
    try {
      // Remove all channels before destroying
      supabase.removeAllChannels();
    } catch { /* ignore */ }
  }
  supabase = undefined as unknown as SupabaseClient;
  console.log("[Auth] Supabase client reset — new client will be created on next call");
}
```

2. Exportar `resetSupabaseClient` no mesmo modulo.

3. Verificar que `getSupabase()` ja trata `!supabase` corretamente (ja trata — `if (!supabase) { supabase = createClient(...) }`).

4. Verificar compilacao:
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npx tsc --noEmit
```
Expected: sem erros de tipo.

---

## Task 2: Watchdog de estado em print-listener.ts

**Files:** `src/main/print-listener.ts`

### Steps

O problema: `reconnectTimer` guard bloqueia novas tentativas se o timer anterior nao completou. E nao ha ninguem observando se o status ficou preso em `reconnecting` por tempo demais.

1. Adicionar variaveis de controle do watchdog junto aos outros timers existentes:

```typescript
let watchdogTimer: NodeJS.Timeout | null = null;
let lastStatusChangeAt: number = Date.now();
```

2. Atualizar `emitConnectionStatus()` para registrar o timestamp da mudanca:

```typescript
function emitConnectionStatus(): void {
  lastStatusChangeAt = Date.now();
  connectionStatusCallback?.({
    internet: currentInternetStatus,
    server: currentServerStatus,
    serverDetail: currentServerDetail,
  });
}
```

3. Adicionar funcao `startWatchdog(storeId)` que verifica a cada 30s se o status ficou preso:

```typescript
const WATCHDOG_INTERVAL_MS = 30_000;  // verifica a cada 30s
const WATCHDOG_MAX_RECONNECTING_MS = 90_000; // tolera reconnecting por ate 90s

function startWatchdog(storeId: string): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    if (!isActive) return;
    const stuckMs = Date.now() - lastStatusChangeAt;
    if (
      currentServerStatus === "reconnecting" &&
      stuckMs > WATCHDOG_MAX_RECONNECTING_MS
    ) {
      console.warn(`[Watchdog] Status preso em 'reconnecting' por ${Math.round(stuckMs / 1000)}s — forcando reset completo`);
      forceFullReconnect(storeId);
    }
  }, WATCHDOG_INTERVAL_MS);
}

function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}
```

4. Adicionar funcao `forceFullReconnect(storeId)` que limpa o guard `reconnectTimer`, reseta o cliente Supabase e inicia novo ciclo:

```typescript
function forceFullReconnect(storeId: string): void {
  console.log("[PrintListener] Force full reconnect — resetting Supabase client");

  // Clear the guard so scheduleReconnect can run again
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;

  // Remove all channels
  const supabase = getSupabase();
  [channel, presenceChannel, areasChannel, mappingsChannel].forEach(ch => {
    if (ch) {
      try { supabase.removeChannel(ch); } catch { /* ignore */ }
    }
  });
  channel = null;
  presenceChannel = null;
  areasChannel = null;
  mappingsChannel = null;

  // Reset the Supabase singleton so next call creates fresh WebSocket
  resetSupabaseClient();

  // Update status
  currentServerStatus = "reconnecting";
  currentServerDetail = "Reiniciando conexao...";
  emitConnectionStatus();

  // Short delay then re-setup
  setTimeout(() => {
    if (!isActive) return;
    setupChannels(storeId);
  }, 2000);
}
```

5. Importar `resetSupabaseClient` de `./supabase` no topo do arquivo.

6. Chamar `startWatchdog(storeId)` dentro de `startListening()`, apos `setupChannels(storeId)`.

7. Chamar `stopWatchdog()` dentro de `stopListening()`, junto aos outros stops.

8. Verificar compilacao:
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npx tsc --noEmit
```
Expected: sem erros.

---

## Task 3: Heartbeat de canal em print-listener.ts

**Files:** `src/main/print-listener.ts`

### Steps

O problema: o canal pode reportar `SUBSCRIBED` mas nao receber eventos se o servidor WebSocket morreu silenciosamente (TCP half-open). Sem um ping/heartbeat proprio, nunca sabemos.

Estrategia: a cada 2 minutos, quando o status e `connected`, fazer uma query simples no Supabase (equivalente a um ping de rede). Se falhar, acionar reconexao.

1. Adicionar variaveis para o heartbeat:

```typescript
let heartbeatTimer: NodeJS.Timeout | null = null;
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutos
```

2. Adicionar funcao `startHeartbeat(storeId)`:

```typescript
function startHeartbeat(storeId: string): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(async () => {
    if (!isActive) return;
    if (currentServerStatus !== "connected") return; // so verifica quando "conectado"

    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from("print_jobs")
        .select("id")
        .eq("store_id", storeId)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn("[Heartbeat] Ping falhou:", error.message, "— acionando reconexao");
        currentServerStatus = "reconnecting";
        currentServerDetail = "Verificando conexao...";
        emitConnectionStatus();
        scheduleReconnect(storeId);
      } else {
        console.log("[Heartbeat] Ping OK");
      }
    } catch (err) {
      console.warn("[Heartbeat] Erro no ping:", err, "— acionando reconexao");
      currentServerStatus = "reconnecting";
      currentServerDetail = "Verificando conexao...";
      emitConnectionStatus();
      scheduleReconnect(storeId);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
```

3. Chamar `startHeartbeat(storeId)` dentro de `startListening()`.

4. Chamar `stopHeartbeat()` dentro de `stopListening()`.

5. Verificar compilacao:
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npx tsc --noEmit
```
Expected: sem erros.

---

## Task 4: Fix no guard reconnectTimer (bug critico)

**Files:** `src/main/print-listener.ts`

### Steps

O guard atual `if (reconnectTimer) return` e o principal responsavel pelo estado preso. Se dois eventos de erro chegam rapidamente, o segundo e descartado, e se o timer do primeiro falhar silenciosamente, nenhum reconecta.

Correcao: quando `scheduleReconnect` e chamado e ja ha um timer ativo, verificar se o delay do timer atual e razoavel. Se o status ja esta em `reconnecting` por muito tempo, limpar o timer existente e criar novo.

1. Substituir o guard em `scheduleReconnect`:

```typescript
function scheduleReconnect(storeId: string): void {
  if (!isActive) return;

  // Se ja tem timer E o status mudou recentemente, aguardar o timer existente
  if (reconnectTimer) {
    const stalledMs = Date.now() - lastStatusChangeAt;
    if (stalledMs < 10_000) {
      // Timer recente — aguardar, nao duplicar
      return;
    }
    // Timer antigo que pode estar preso — descartar e criar novo
    console.warn("[PrintListener] Timer de reconexao antigo detectado, substituindo");
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  reconnectAttempts++;

  console.log(`[PrintListener] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isActive) return;
    // ... resto do codigo existente sem alteracao
  }, delay);
}
```

2. Verificar que o bloco interno do `setTimeout` permanece identico ao existente (remover canais, chamar `setupChannels`).

3. Verificar compilacao:
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npx tsc --noEmit
```
Expected: sem erros.

---

## Task 5: Botao manual de reconexao — IPC + preload + UI

**Files:** `src/main/index.ts`, `src/main/preload.ts`, `src/renderer/app.js`

### Steps

Ultimo recurso: botao na UI que o usuario pode clicar quando o automatico falha.

**5a — index.ts: IPC handler**

Adicionar apos o handler `connection:status` existente:

```typescript
// Manual reconnect — restarts print service entirely
ipcMain.handle("connection:reconnect", async () => {
  const storeId = store.get("storeId");
  if (!storeId) return { success: false, error: "Nao autenticado" };

  console.log("[App] Manual reconnect requested by user");
  stopPrintService();

  // Short pause to let channels drain
  await new Promise(resolve => setTimeout(resolve, 1500));

  const restored = await restoreSession();
  if (!restored) {
    return { success: false, error: "Sessao expirada — faca login novamente" };
  }

  startPrintService();
  return { success: true };
});
```

**5b — preload.ts: expor reconnect**

Adicionar dentro do objeto `alphaPrint`:

```typescript
reconnect: () => ipcRenderer.invoke("connection:reconnect"),
```

**5c — app.js: botao na UI**

No `updateConnectionStatus`, quando `status.server === "reconnecting"`, mostrar botao de reconexao. Quando `connected`, esconder o botao.

Adicionar elemento HTML dinamicamente via JS (nao exige mudanca no HTML):

```javascript
// No topo do app.js, junto com outras variaveis DOM
let reconnectBtn = null;

function ensureReconnectButton() {
  if (reconnectBtn) return;

  reconnectBtn = document.createElement("button");
  reconnectBtn.id = "manual-reconnect-btn";
  reconnectBtn.textContent = "Reconectar agora";
  reconnectBtn.className = "btn-reconnect";
  reconnectBtn.style.cssText = `
    display: none;
    margin: 8px auto 0;
    padding: 6px 16px;
    background: #f59e0b;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    width: 100%;
    max-width: 200px;
  `;

  reconnectBtn.addEventListener("click", async () => {
    reconnectBtn.disabled = true;
    reconnectBtn.textContent = "Reconectando...";
    try {
      const result = await api.reconnect();
      if (!result.success) {
        alert(result.error || "Falha ao reconectar");
      }
    } catch (err) {
      alert("Erro: " + err.message);
    } finally {
      reconnectBtn.disabled = false;
      reconnectBtn.textContent = "Reconectar agora";
    }
  });

  // Inserir apos o bloco de status do servidor
  const serverBlock = serverDot?.parentElement?.parentElement;
  if (serverBlock) {
    serverBlock.parentElement?.insertBefore(reconnectBtn, serverBlock.nextSibling);
  }
}

// Dentro de updateConnectionStatus, no case "reconnecting":
// ensureReconnectButton();
// reconnectBtn.style.display = "block";

// Dentro de updateConnectionStatus, no case "connected":
// if (reconnectBtn) reconnectBtn.style.display = "none";
```

4. Verificar compilacao TypeScript (apenas dos arquivos .ts):
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npx tsc --noEmit
```
Expected: sem erros.

---

## Task 6: Reconexao ao recuperar internet

**Files:** `src/main/print-listener.ts`

### Steps

Problema adicional: quando o usuario fica offline e volta online, o `startInternetCheck` detecta a transicao `offline -> online`, mas nao aciona reconexao automaticamente.

1. Dentro de `startInternetCheck` -> funcao `doCheck`, apos atualizar `currentInternetStatus`, adicionar logica para acionar reconexao quando a internet volta:

```typescript
const doCheck = async () => {
  const wasOnline = currentInternetStatus;
  const isOnline = await checkInternet();
  currentInternetStatus = isOnline ? "online" : "offline";

  if (wasOnline !== currentInternetStatus) {
    console.log(`[Connectivity] Internet: ${currentInternetStatus}`);
    emitConnectionStatus();

    // <<< NOVO: quando a internet VOLTA, forcar reconexao se nao conectado
    if (
      currentInternetStatus === "online" &&
      currentServerStatus !== "connected" &&
      isActive
    ) {
      const storeId = store.get("storeId");
      if (storeId) {
        console.log("[Connectivity] Internet restored — triggering reconnect");
        scheduleReconnect(storeId);
      }
    }
  }
};
```

2. Verificar compilacao:
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npx tsc --noEmit
```
Expected: sem erros.

---

## Task 7: Build final e validacao

**Files:** nenhum arquivo novo

### Steps

1. Build completo:
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npm run build
```
Expected: dist/ gerado sem erros de compilacao.

2. Registro de aprendizado no banco:
```bash
npx supabase db query --linked "INSERT INTO agent_knowledge_base (agent_name, knowledge_type, title, content, confidence, source) VALUES ('orquestrador-de-agentes', 'success_pattern', 'Alpha Print — Reconexao Robusta', 'Implementados 4 mecanismos complementares: watchdog de estado (90s timeout), heartbeat de canal (2min), reset do cliente Supabase, botao manual de reconexao na UI. Fix no guard reconnectTimer que bloqueava novas tentativas. Reconexao automatica ao recuperar internet.', 0.92, 'task_execution')"
```

3. Registro do entregavel:
```bash
npx supabase db query --linked "INSERT INTO agent_deliverables (agent_name, title, type, content, status) VALUES ('orquestrador-de-agentes', 'Alpha Print — Reconexao Robusta implementada', 'code', 'Tasks 1-6 concluidas: resetSupabaseClient, watchdog 90s, heartbeat 2min, fix guard reconnectTimer, botao manual UI, reconexao ao recuperar internet.', 'completed')"
```

---

## Resumo dos Mecanismos Implementados

| # | Mecanismo | Onde ativa | Delay |
|---|-----------|-----------|-------|
| 1 | Watchdog de estado | status preso em reconnecting > 90s | cada 30s |
| 2 | Heartbeat de canal | canal "connected" mas sem resposta | cada 2min |
| 3 | Reset cliente Supabase | chamado pelo watchdog | na hora |
| 4 | Reconexao ao recuperar internet | transicao offline->online | imediato |
| 5 | Fix guard reconnectTimer | timers antigos (>10s) sao substituidos | na hora |
| 6 | Botao manual de reconexao | usuario clica quando quer | UI |
