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

; --- Matar processo do Alpha Print antes de instalar/atualizar ---
; Resolve o erro "Nao e possivel fechar o Alpha Print" do NSIS
!macro customInstall
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

  ; Mostra no log o que esta acontecendo
  DetailPrint ""
  DetailPrint "====================================="
  DetailPrint "  Alpha Print - Desinstalacao"
  DetailPrint "====================================="
  DetailPrint ""
  DetailPrint "Removendo arquivos do Alpha Print..."
!macroend

; --- Pagina final do desinstalador (apos MUI_UNPAGE_INSTFILES) ---
!macro customUninstallPage
  !define MUI_FINISHPAGE_TITLE "Desinstalacao concluida!"
  !define MUI_FINISHPAGE_TEXT "O Alpha Print foi removido do seu computador.$\r$\n$\r$\nSe quiser reinstalar, baixe novamente em portal.alphacardapio.com.$\r$\n$\r$\nClique em Concluir para fechar."
!macroend
