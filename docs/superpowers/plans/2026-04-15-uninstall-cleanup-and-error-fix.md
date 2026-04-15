# Plan: Limpeza Total na Desinstalacao + Correcao do Erro Feio

**Goal:** Ao desinstalar o Alpha Print, remover TUDO (AppData, registro, temp) sem deixar rastro; garantir que humanizePrintError() seja usado em TODOS os caminhos de erro do printer.ts
**Date:** 2026-04-15
**Versao alvo:** 1.0.11 (ja em build) — aplicar nas mesmas fontes

---

## Diagnostico do Erro Feio

O `humanizePrintError()` JA EXISTE em `printer.ts` e JA e chamado na linha 320:
```typescript
reject(new Error(humanizePrintError(rawStderr, printerName)));
```

Porem o erro feio pode vir de um caminho diferente. Investigando:
- O erro e extraido de `error.message || err2.message` — o `error.message` vem do Node.js ao fazer exec() timeout ou kill, e pode nao conter o stderr do PowerShell
- O `stderr` do PowerShell (stack trace completo) pode estar chegando pela mensagem do erro primario sem passar por `humanizePrintError`
- `rawStderr` usa `error.message` (string do Node) ao inves de usar `stderr` (output real do PowerShell)

**Bug concreto:** na linha 319, `rawStderr = error.message || err2.message` — mas `error.message` e o erro do Node.js (`Command failed: ...`), NAO o stderr do PowerShell. O stderr real esta na variavel `stderr` (terceiro parametro do callback do exec primario). O codigo ignora `stderr` do exec primario e usa `error.message`.

---

## Architecture

**Parte 1 — Limpeza na desinstalacao:** adicionar codigo NSIS ao `customUnInstall` no `installer.nsh` para remover AppData\Local\alpha-print, AppData\Roaming\Alpha Print, entradas de registro, e arquivos temp.

**Parte 2 — Corrigir erro feio:** passar `stderr` (output real do PowerShell) como fonte primaria em `humanizePrintError`, e tambem adicionar tratamento para o caminho de erro onde so o erro primario falha (antes do fallback).

---

## Tech Stack / Key Dependencies

- NSIS (linguagem do instalador Windows, via electron-builder)
- TypeScript (printer.ts — processo principal Electron)
- electron-builder v26 + nsis customHeader/customUnInstall macros

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `assets/installer.nsh` | Modify | Adicionar limpeza total no macro customUnInstall |
| `src/main/printer.ts` | Modify | Corrigir rawStderr para usar stderr real do PowerShell |

---

## Task 1: Corrigir humanizePrintError para usar stderr real do PowerShell

**Files:** `src/main/printer.ts`

### Contexto

No callback do `exec` primario (linha ~292), a assinatura e:
```typescript
exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
```

O `stderr` aqui contem o dump completo do PowerShell com o codigo Win32.
Mas na linha ~319, o codigo usa `error.message` (mensagem do Node.js) ao inves de `stderr`:
```typescript
const rawStderr = error.message || err2.message || "";
```

O fix e: capturar o `stderr` do exec primario no escopo do fallback para usa-lo em `humanizePrintError`.

### Steps

1. Localizar o trecho em `sendToPrinter` onde o exec primario captura `(error, stdout, stderr)`:

```typescript
exec(cmd, { timeout: 30000 }, (error: Error | null, stdout: string, stderr: string) => {
  if (!error) {
    // Success
    ...
    return;
  }

  console.error("[Printer] Win32 raw print failed:", error.message);
  console.log("[Printer] Trying shared printer fallback...");
  ...
  exec(fallbackCmd, { timeout: 15000 }, (err2) => {
    ...
    if (err2) {
      const rawStderr = error.message || err2.message || "";   // <-- BUG: usa error.message, nao stderr
      reject(new Error(humanizePrintError(rawStderr, printerName)));
    }
  });
});
```

2. Aplicar fix — usar `stderr` do exec primario como fonte principal:

```typescript
exec(cmd, { timeout: 30000 }, (error: Error | null, stdout: string, stderr: string) => {
  if (!error) {
    cleanupTemp(tempFile);
    cleanupTemp(scriptFile);
    resolve();
    return;
  }

  console.error("[Printer] Win32 raw print failed:", error.message);
  if (stderr) console.error("[Printer] PowerShell stderr:", stderr.substring(0, 500));
  console.log("[Printer] Trying shared printer fallback...");

  const shareName = printerName.replace(/["|&<>^%!`]/g, "");
  const fallbackCmd = `cmd /c copy /b "${tempFile}" "\\\\localhost\\${shareName}"`;

  exec(fallbackCmd, { timeout: 15000 }, (err2) => {
    cleanupTemp(tempFile);
    cleanupTemp(scriptFile);

    if (err2) {
      // Usa stderr do PowerShell como fonte primaria (contem codigo Win32 real)
      // Fallback para error.message se stderr estiver vazio (ex: timeout do Node)
      const rawStderr = stderr || error.message || err2.message || "";
      reject(new Error(humanizePrintError(rawStderr, printerName)));
    } else {
      resolve();
    }
  });
});
```

3. Verificar que a assinatura do callback ja inclui `stderr` como terceiro parametro (confirmar na linha 292 do arquivo atual — ja esta correto: `(error: Error | null, stdout: string, stderr: string)`).

4. Verificar compilacao TypeScript:
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && npx tsc --noEmit
```
Esperado: sem erros de tipo.

5. Commit:
```bash
git add src/main/printer.ts
git commit -m "fix(printer): usar stderr real do PowerShell em humanizePrintError"
```

---

## Task 2: Limpeza total na desinstalacao via NSIS

**Files:** `assets/installer.nsh`

### Contexto

O NSIS tem acesso a variaveis especiais:
- `$APPDATA` — C:\Users\{usuario}\AppData\Roaming
- `$LOCALAPPDATA` — C:\Users\{usuario}\AppData\Local
- `$TEMP` — C:\Users\{usuario}\AppData\Local\Temp

O electron-store salva dados em `$APPDATA\Alpha Print\` (productName do electron-builder).
O Electron salva cache/dados em `$LOCALAPPDATA\alpha-print\` (appId sem o prefixo da empresa).
Arquivos temp sao salvos em `$TEMP\alpha-print-*.bin` e `$TEMP\alpha-print-*.ps1`.
Registro: o NSIS ja remove as chaves criadas por ele proprio, mas pode sobrar `HKCU\Software\Alpha Print` criado pelo electron-store.

### Steps

1. Editar o macro `customUnInstall` em `assets/installer.nsh` para adicionar limpeza completa APOS matar o processo:

```nsis
!macro customUnInstall
  ; Mata o processo caso esteja rodando
  nsExec::ExecToLog "taskkill /f /im $\"Alpha Print.exe$\""

  ; Aguarda o processo fechar
  Sleep 1000

  ; =============================================================
  ; LIMPEZA COMPLETA — Remove TODOS os dados do Alpha Print
  ; =============================================================
  DetailPrint ""
  DetailPrint "====================================="
  DetailPrint "  Alpha Print - Desinstalacao"
  DetailPrint "====================================="
  DetailPrint ""
  DetailPrint "Removendo arquivos e dados do Alpha Print..."

  ; 1. AppData\Roaming\Alpha Print (electron-store: config, storeId, deviceId)
  DetailPrint "Removendo dados de configuracao (AppData\Roaming)..."
  RMDir /r "$APPDATA\Alpha Print"

  ; 2. AppData\Local\alpha-print (cache Electron: GPU, logs, squirrel, Code Cache)
  DetailPrint "Removendo cache do aplicativo (AppData\Local)..."
  RMDir /r "$LOCALAPPDATA\alpha-print"

  ; 3. Arquivos temporarios de impressao (*.bin e *.ps1 criados pelo printer.ts)
  DetailPrint "Removendo arquivos temporarios de impressao..."
  Delete "$TEMP\alpha-print-*.bin"
  Delete "$TEMP\alpha-print-*.ps1"

  ; 4. Entradas de registro criadas pelo electron-store e pelo Electron
  DetailPrint "Removendo entradas do registro do Windows..."
  DeleteRegKey HKCU "Software\Alpha Print"
  DeleteRegKey HKCU "Software\alpha-print"
  ; Entrada de auto-start (se tiver sido criada pelo app)
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Alpha Print"

  DetailPrint ""
  DetailPrint "Limpeza concluida. Nenhum dado do Alpha Print permanece no computador."
!macroend
```

2. Atualizar o texto da pagina final do desinstalador para refletir a limpeza total:

```nsis
!macro customUninstallPage
  !define MUI_FINISHPAGE_TITLE "Desinstalacao concluida!"
  !define MUI_FINISHPAGE_TEXT "O Alpha Print foi completamente removido do seu computador.$\r$\n$\r$\nTodos os dados, configuracoes e arquivos temporarios foram apagados.$\r$\n$\r$\nSe quiser reinstalar, baixe novamente em portal.alphacardapio.com.$\r$\n$\r$\nClique em Concluir para fechar."
!macroend
```

3. Verificar que o arquivo nao tem erros de sintaxe NSIS revisando visualmente os macros (sem ferramenta de compilacao local — o build do GitHub Actions validara).

4. Commit:
```bash
git add assets/installer.nsh
git commit -m "feat(installer): limpeza total na desinstalacao (AppData, registro, temp)"
```

---

## Task 3: Bump de versao e release

**Files:** `package.json` (via script)

### Steps

1. Confirmar que as duas tasks anteriores estao commitadas e que o branch esta limpo:
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print" && git status
```
Esperado: `nothing to commit, working tree clean`

2. Verificar versao atual:
```bash
node -e "console.log(require('./package.json').version)"
```
Esperado: `1.0.11`

3. Fazer bump de versao:
```bash
node scripts/bump-version.mjs patch
```
Esperado: versao sobe para `1.0.12`, commit + tag criados + push feito.

4. Acompanhar o build no GitHub Actions:
   https://github.com/jefteamaral1996/alpha-print/actions

---

## Checklist de Entrega

- [ ] Task 1: printer.ts usa `stderr` real do PowerShell em humanizePrintError
- [ ] Task 2: installer.nsh remove AppData/Roaming, AppData/Local, Temp, Registro
- [ ] Task 3: versao bumped e release publicado
- [ ] CEO confirma que erro feio nao aparece mais apos reinstalar
- [ ] CEO confirma que desinstalar nao deixa pasta em AppData

---

## Notas de Segurança (OWASP)

- RMDir /r com path fixo (sem input de usuario) — sem risco de path traversal
- DeleteRegKey com caminho fixo e scope HKCU (usuario atual apenas) — sem elevacao de privilegio indevida
- Variaveis NSIS `$APPDATA` e `$LOCALAPPDATA` sao resolvidas pelo Windows para o usuario atual da sessao — correto para perMachine=true com usuario logado
- Nenhum dado sensivel (credenciais, tokens) e logado — apenas nomes de pasta

---

## Registro de Aprendizado (inserir apos conclusao)

```sql
INSERT INTO agent_knowledge_base (agent_name, knowledge_type, title, content, confidence, source)
VALUES (
  'engenheiro-de-software',
  'learned_rule',
  'Alpha Print: stderr vs error.message em exec() Node.js',
  'No Node.js child_process.exec(), error.message contem a mensagem do Node (ex: "Command failed"), NAO o stderr do processo filho. Para capturar a saida de erro do processo (ex: stack trace do PowerShell com codigo Win32), usar o terceiro parametro stderr do callback. Corrigido em printer.ts linha ~319.',
  0.95,
  'task_execution'
);

INSERT INTO agent_knowledge_base (agent_name, knowledge_type, title, content, confidence, source)
VALUES (
  'engenheiro-de-software',
  'best_practice',
  'Alpha Print: variaveis NSIS para limpeza na desinstalacao',
  '$APPDATA = AppData/Roaming, $LOCALAPPDATA = AppData/Local, $TEMP = AppData/Local/Temp. electron-store salva em $APPDATA/{productName}. Electron cache em $LOCALAPPDATA/{appName-lowercase}. Usar RMDir /r para pastas e Delete com wildcard para arquivos temp.',
  0.92,
  'task_execution'
);
```
