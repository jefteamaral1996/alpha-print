# Plan: Humanizar Mensagem de Erro de Impressao

**Goal:** Substituir o dump tecnico do PowerShell por mensagens de erro claras e acionaveis para o usuario final.
**Date:** 2026-04-15
**Contexto:** Quando a impressora nao e encontrada (erro Windows 1801) ou falha por outro motivo, o sistema exibe o stack trace completo do PowerShell — caminho do .exe, CategoryInfo, FullyQualifiedErrorId, etc. O CEO quer texto simples que o atendente entenda e saiba o que fazer.

## Arquitetura

O erro nasce no PowerShell (dentro do script .ps1 que chama `[RawPrinter]::SendRaw`), e viaja assim:

```
PowerShell (stderr) -> printer.ts sendToPrinter() reject(new Error(...))
                    -> print-listener.ts processJob() catch -> errorMsg
                    -> salvo em print_jobs.error (banco)
                    -> enviado ao renderer via IPC "print:failure"
                    -> exibido no toast (app.js showFailureAlert)
```

A sanitizacao deve acontecer em `printer.ts` (fonte do erro), pois e la que o stderr bruto do PowerShell e capturado. Assim, tudo que consume o errorMsg (banco, toast, logs) ja recebe texto limpo.

## Mapa de Erros Windows Conhecidos

| Codigo Win32 | Significado | Mensagem para usuario |
|---|---|---|
| 1801 | Printer name is invalid | Impressora 'X' nao encontrada. Verifique se o nome esta correto nas configuracoes e se a impressora esta instalada neste computador. |
| 5 | Access denied | Sem permissao para acessar a impressora 'X'. Execute o Alpha Print como administrador ou verifique as permissoes de impressora no Windows. |
| 1722 / 1753 | RPC server unavailable / endpoint mapper failed | Servico de impressao do Windows com problema. Reinicie o Spooler: Painel de Controle > Servicos > Print Spooler > Reiniciar. |
| 2 | File not found (spooler) | Impressora 'X' nao esta acessivel no momento. Verifique se ela esta ligada e conectada ao computador. |
| 6 | Invalid handle | Falha ao comunicar com a impressora 'X'. Tente desligar e ligar a impressora e tente novamente. |
| 1797 | The printer driver is unknown | Driver da impressora 'X' nao esta instalado. Instale o driver correto e tente novamente. |
| generico | Qualquer outro erro | Falha ao imprimir em 'X'. Verifique se a impressora esta ligada e conectada. (codigo: ERR_CODE) |

## Tech Stack / Key Dependencies

- **alpha-print**: Electron + TypeScript + PowerShell Win32 API
- **arquivo principal**: `alpha-print/src/main/printer.ts` (funcao `sendToPrinter`)
- **sem dependencias novas**: logica de parsing e puro JS/TS

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `alpha-print/src/main/printer.ts` | Modify | Adicionar funcao `humanizePrintError(stderr, printerName)` e usar no `reject()` do `sendToPrinter` |

**Apenas 1 arquivo modificado** — a mudanca e cirurgica.

---

## Task 1: Adicionar funcao `humanizePrintError` em printer.ts e usar no erro

**Files:** `alpha-print/src/main/printer.ts`

### Steps

1. Ler o arquivo atual (ja lido — linhas 209-268, funcao `sendToPrinter`)

2. Implementar a funcao `humanizePrintError` logo antes de `sendToPrinter` (linha 209):

```typescript
/**
 * Converte o stderr bruto do PowerShell em mensagem legivel pelo usuario.
 * O PowerShell pode retornar stack traces completos como:
 *   "Command failed: ... Excecao ao chamar 'SendRaw' ... (erro 1801) ..."
 *
 * Estrategia:
 * 1. Extrai o codigo de erro Win32 (se presente)
 * 2. Mapeia para mensagem humanizada especifica
 * 3. Se nao reconhecido, retorna mensagem generica sem dump tecnico
 */
function humanizePrintError(rawError: string, printerName: string): string {
  // Extrai codigo de erro Win32 do stderr do PowerShell
  // Ex: "(erro 1801)" ou "error 1801" ou "LastWin32Error: 1801"
  const errorCodeMatch = rawError.match(/\b(?:erro|error)\s+(\d+)\b/i)
    || rawError.match(/LastWin32Error[:\s]+(\d+)/i)
    || rawError.match(/GetLastError\(\)\s*[=:]\s*(\d+)/i);

  const code = errorCodeMatch ? parseInt(errorCodeMatch[1], 10) : null;
  const name = printerName ? `'${printerName}'` : "a impressora";

  switch (code) {
    case 1801:
      return (
        `Impressora ${name} nao encontrada. ` +
        `Verifique se o nome esta correto nas configuracoes e se a impressora esta instalada neste computador.`
      );
    case 5:
      return (
        `Sem permissao para acessar a impressora ${name}. ` +
        `Tente executar o Alpha Print como administrador ou verifique as permissoes de impressora no Windows.`
      );
    case 1722:
    case 1753:
      return (
        `Servico de impressao do Windows com problema. ` +
        `Reinicie o Spooler de Impressao: abra Servicos do Windows, encontre "Print Spooler" e clique em Reiniciar.`
      );
    case 2:
      return (
        `Impressora ${name} nao esta acessivel no momento. ` +
        `Verifique se ela esta ligada e conectada ao computador.`
      );
    case 6:
      return (
        `Falha ao comunicar com a impressora ${name}. ` +
        `Tente desligar e ligar a impressora e tente novamente.`
      );
    case 1797:
      return (
        `Driver da impressora ${name} nao esta instalado corretamente. ` +
        `Reinstale o driver da impressora e tente novamente.`
      );
    default: {
      const codeInfo = code ? ` (codigo: ${code})` : "";
      return (
        `Falha ao imprimir em ${name}. ` +
        `Verifique se a impressora esta ligada e conectada${codeInfo}.`
      );
    }
  }
}
```

3. Substituir o `reject(new Error(...))` na funcao `sendToPrinter` (linha ~254-261):

**Antes (atual):**
```typescript
if (err2) {
  reject(
    new Error(
      `Falha ao imprimir em "${printerName}". ` +
      `Verifique se a impressora esta ligada e conectada. ` +
      `Erro: ${error.message}`
    )
  );
}
```

**Depois:**
```typescript
if (err2) {
  // Tenta humanizar usando stderr do erro primario (Win32 raw) ou do fallback
  const rawStderr = error.message || err2.message || "";
  reject(new Error(humanizePrintError(rawStderr, printerName)));
}
```

4. Verificar que o codigo compila:
```bash
cd "c:/Users/Jefte/OneDrive/Área de Trabalho/Meu aplicativo/alpha feito no vs code com claud code/alpha-print"
npx tsc --noEmit
```
Esperado: sem erros de tipo.

5. Commit:
```bash
git add src/main/printer.ts
git commit -m "fix(printer): humanizar mensagens de erro de impressao (Win32 1801, 5, 1722, etc)"
```

---

## Task 2: Publicar nova versao

**Files:** `package.json` (via script bump-version.mjs)

### Steps

1. Verificar branch e estado do repositorio:
```bash
git status
git branch
```
Esperado: branch `main`, sem mudancas pendentes.

2. Executar o script de release:
```bash
node scripts/bump-version.mjs patch
```
Esperado: versao incrementada (ex: 1.x.y -> 1.x.y+1), commit e tag criados, push feito.

3. Aguardar GitHub Actions buildar e publicar o release.
   URL para acompanhar: https://github.com/jefteamaral1996/alpha-print/actions

4. Verificar que o release contem `AlphaPrintSetup-{nova-versao}.exe`:
   https://github.com/jefteamaral1996/alpha-print/releases/latest

---

## Criterio de Sucesso

- Usuario ve mensagem amigavel e acionavel para erros comuns (1801, 5, 1722/1753, 2, 6, 1797)
- Erros nao mapeados mostram mensagem generica sem nenhum texto tecnico (sem caminhos de arquivo, sem CategoryInfo, sem FullyQualifiedErrorId, sem stack trace)
- O erro com codigo e exibido de forma discreta no final apenas para erros nao mapeados (para facilitar suporte)
- Build compila sem erros
- Nova versao publicada no GitHub Releases

## Notas de Seguranca (OWASP)

- Nenhuma entrada de usuario e incluida no stderr — a `printerName` vem da configuracao da loja (ja sanitizada)
- A funcao `humanizePrintError` apenas faz parsing de string e switch — sem risco de injection
- O `rawError` e usado APENAS para extrair o numero do codigo de erro — o texto bruto NAO e repassado ao usuario
