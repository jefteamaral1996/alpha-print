; Alpha Print - Customizacao do Instalador NSIS
; Personaliza textos e paginas do instalador/desinstalador

; =============================================================
; HEADER — Sobrescreve configuracoes globais do NSIS
; O common.nsh do electron-builder define "ShowInstDetails nevershow"
; Aqui redefinimos para "show" — a ultima diretiva vence no NSIS
; =============================================================
!macro customHeader
  ShowInstDetails show
  ShowUnInstDetails show
!macroend

; =============================================================
; INSTALADOR — Paginas e acoes
; =============================================================

; --- Re-habilita logs na caixa de detalhes antes da copia de arquivos ---
; PROBLEMA: o installSection.nsh do electron-builder executa
;   SetDetailsPrint none
; antes de copiar os arquivos, silenciando toda a caixa de logs.
; SOLUCAO: usar o hook MUI_PAGE_CUSTOMFUNCTION_SHOW da pagina INSTFILES
; para chamar SetDetailsPrint both logo antes da instalacao comecar.
; Este macro e inserido em assistedInstaller.nsh ANTES do MUI_PAGE_INSTFILES.
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW EnableInstDetailsLog
  Function EnableInstDetailsLog
    SetDetailsPrint both
  FunctionEnd
!macroend

; --- Matar processo do Alpha Print antes de instalar/atualizar ---
; Resolve o erro "Nao e possivel fechar o Alpha Print" do NSIS
!macro customInstall
  ; Garante que os DetailPrint abaixo sejam visiveis
  ; (o installSection.nsh chama SetDetailsPrint none antes da copia,
  ;  mas o hook SHOW acima ja re-habilita. Mantemos aqui como seguranca.)
  SetDetailsPrint both

  ; Mata o processo caso esteja rodando
  nsExec::ExecToLog "taskkill /f /im $\"Alpha Print.exe$\""

  ; Mostra no log o que esta acontecendo
  DetailPrint ""
  DetailPrint "====================================="
  DetailPrint "  Alpha Print - Instalacao concluida"
  DetailPrint "====================================="
  DetailPrint ""
  DetailPrint "Todos os arquivos foram copiados."
  DetailPrint "Atalhos criados na area de trabalho e no menu Iniciar."
!macroend

; --- Pagina de boas-vindas customizada ---
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Bem-vindo ao Alpha Print"
  !define MUI_WELCOMEPAGE_TEXT "Este assistente ira instalar o Alpha Print no seu computador.$\r$\n$\r$\nO Alpha Print e o aplicativo de impressao do Alpha Cardapio. Com ele, seus pedidos sao impressos automaticamente.$\r$\n$\r$\nClique em Proximo para continuar."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; --- Textos da tela de conclusao (instalador) ---
; Estes defines ficam no escopo global, mas so sao usados pelo MUI_PAGE_FINISH
; que roda dentro do bloco !ifndef BUILD_UNINSTALLER do assistedInstaller.nsh
; O desinstalador redefine seus proprios textos via customUninstallPage
!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_TITLE "Instalacao concluida!"
  !define MUI_FINISHPAGE_TEXT "O Alpha Print foi instalado com sucesso no seu computador.$\r$\n$\r$\nClique em Concluir para fechar o instalador."
  !define MUI_FINISHPAGE_RUN_TEXT "Abrir o Alpha Print agora"
!endif

; =============================================================
; DESINSTALADOR — Paginas customizadas
; =============================================================

; --- Pagina de boas-vindas do desinstalador ---
!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Desinstalar o Alpha Print"
  !define MUI_WELCOMEPAGE_TEXT "Este assistente ira remover o Alpha Print do seu computador.$\r$\n$\r$\nAntes de continuar, feche o Alpha Print se ele estiver aberto.$\r$\n$\r$\nClique em Proximo para continuar."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

; --- Acoes extras durante a desinstalacao ---
!macro customUnInstall
  ; Mata o processo caso esteja rodando
  nsExec::ExecToLog "taskkill /f /im $\"Alpha Print.exe$\""

  ; Aguarda o processo fechar completamente
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

  ; 1. AppData\Roaming\Alpha Print (electron-store: storeId, deviceId, configuracoes)
  DetailPrint "Removendo dados de configuracao (AppData\Roaming)..."
  RMDir /r "$APPDATA\Alpha Print"

  ; 2. AppData\Local\alpha-print (cache Electron: GPU cache, logs, Code Cache)
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
  ; Remove entrada de auto-start caso o app tenha criado
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Alpha Print"

  DetailPrint ""
  DetailPrint "Limpeza concluida. Nenhum dado do Alpha Print permanece no computador."
!macroend

; --- Pagina final do desinstalador (apos MUI_UNPAGE_INSTFILES) ---
!macro customUninstallPage
  !define MUI_FINISHPAGE_TITLE "Desinstalacao concluida!"
  !define MUI_FINISHPAGE_TEXT "O Alpha Print foi completamente removido do seu computador.$\r$\n$\r$\nTodos os dados, configuracoes e arquivos temporarios foram apagados.$\r$\n$\r$\nSe quiser reinstalar, baixe novamente em portal.alphacardapio.com.$\r$\n$\r$\nClique em Concluir para fechar."
!macroend
