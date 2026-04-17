; Alpha Print - Customizacao do Instalador NSIS
; Personaliza textos, logs e progresso do instalador/desinstalador
;
; PROBLEMA RESOLVIDO:
; O electron-builder (installSection.nsh) executa "SetDetailsPrint none"
; antes de copiar arquivos, silenciando a caixa de logs.
; A solucao usa dois mecanismos:
; 1. customHeader: ShowInstDetails show / ShowUnInstDetails show
;    (sobrescreve o "nevershow" do common.nsh — ultima diretiva vence)
; 2. customPageAfterChangeDir: define callback SHOW na pagina INSTFILES
;    que exibe mensagens de progresso antes da secao rodar
; 3. customInstall: re-habilita SetDetailsPrint both e mostra logs apos copia
;
; Para porcentagem: NSIS mostra barra de progresso nativa na pagina INSTFILES.
; Adicionamos DetailPrint com porcentagem manual nas etapas pos-copia.

; =============================================================
; HEADER — Sobrescreve configuracoes globais do NSIS
; O common.nsh do electron-builder define "ShowInstDetails nevershow"
; e "ShowUninstDetails nevershow" (quando BUILD_UNINSTALLER).
; Aqui redefinimos para "show" — a ultima diretiva vence no NSIS.
; =============================================================
!macro customHeader
  ShowInstDetails show
  ShowUnInstDetails show
!macroend

; =============================================================
; INSTALADOR — Paginas e acoes
; =============================================================

; --- Callback SHOW da pagina INSTFILES ---
; Este hook roda quando a pagina INSTFILES e exibida (antes da secao executar).
; Re-habilita logs e mostra mensagem inicial de progresso.
; NOTA: o installSection.nsh vai chamar SetDetailsPrint none logo apos,
; silenciando os logs de extracao individual de arquivo (por design do
; electron-builder). Os logs voltam a funcionar no customInstall.
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW InstFilesPageShow

  Function InstFilesPageShow
    ; Re-habilita impressao de detalhes
    SetDetailsPrint both

    ; Mensagem inicial visivel ao usuario enquanto a barra de progresso avanca
    DetailPrint ""
    DetailPrint "====================================="
    DetailPrint "  Alpha Print - Instalando..."
    DetailPrint "====================================="
    DetailPrint ""
    DetailPrint "Preparando arquivos do aplicativo..."
    DetailPrint "A barra de progresso acima mostra o andamento."
    DetailPrint "Aguarde enquanto os arquivos sao copiados..."
    DetailPrint ""
  FunctionEnd
!macroend

; --- Matar processo do Alpha Print antes de instalar/atualizar ---
; Resolve o erro "Nao e possivel fechar o Alpha Print" do NSIS
!macro customInstall
  ; Re-habilita logs (o installSection.nsh chamou SetDetailsPrint none antes)
  SetDetailsPrint both

  ; Mata o processo caso esteja rodando
  DetailPrint "Verificando se o Alpha Print esta em execucao..."
  nsExec::ExecToLog "taskkill /f /im $\"Alpha Print.exe$\""
  Pop $0
  ${If} $0 == 0
    DetailPrint "Alpha Print foi fechado automaticamente."
    Sleep 500
  ${Else}
    DetailPrint "Alpha Print nao estava em execucao. OK."
  ${EndIf}

  ; Progresso: arquivos copiados
  DetailPrint ""
  DetailPrint "[100%] Copia de arquivos concluida."
  DetailPrint ""

  ; Progresso: atalhos
  DetailPrint "[100%] Atalhos criados na area de trabalho e no Menu Iniciar."
  DetailPrint ""

  ; Resumo final
  DetailPrint "====================================="
  DetailPrint "  Instalacao concluida com sucesso!"
  DetailPrint "====================================="
  DetailPrint ""
  DetailPrint "O Alpha Print esta pronto para uso."
  DetailPrint "Voce pode abri-lo pela area de trabalho ou Menu Iniciar."
!macroend

; --- Pagina de boas-vindas customizada ---
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Bem-vindo ao Alpha Print"
  !define MUI_WELCOMEPAGE_TEXT "Este assistente ira instalar o Alpha Print no seu computador.$\r$\n$\r$\nO Alpha Print e o aplicativo de impressao do Alpha Cardapio. Com ele, seus pedidos sao impressos automaticamente.$\r$\n$\r$\nClique em Proximo para continuar."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; --- Textos da tela de conclusao (instalador) ---
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
  ; Garante que os DetailPrint sejam visiveis
  SetDetailsPrint both

  ; Mata o processo caso esteja rodando
  DetailPrint ""
  DetailPrint "====================================="
  DetailPrint "  Alpha Print - Desinstalacao"
  DetailPrint "====================================="
  DetailPrint ""

  DetailPrint "[  0%] Verificando processos em execucao..."
  nsExec::ExecToLog "taskkill /f /im $\"Alpha Print.exe$\""
  Pop $0
  ${If} $0 == 0
    DetailPrint "        Alpha Print foi fechado automaticamente."
  ${Else}
    DetailPrint "        Alpha Print nao estava em execucao. OK."
  ${EndIf}

  ; Aguarda o processo fechar completamente
  Sleep 1000
  DetailPrint "[ 10%] Processo encerrado."
  DetailPrint ""

  ; =============================================================
  ; LIMPEZA COMPLETA — Remove TODOS os dados do Alpha Print
  ; =============================================================

  ; 1. AppData\Roaming\Alpha Print (electron-store: storeId, deviceId, configuracoes)
  DetailPrint "[ 20%] Removendo dados de configuracao (AppData\Roaming)..."
  RMDir /r "$APPDATA\Alpha Print"
  DetailPrint "        Configuracoes removidas."

  ; 2. AppData\Local\alpha-print (cache Electron: GPU cache, logs, Code Cache)
  DetailPrint "[ 40%] Removendo cache do aplicativo (AppData\Local)..."
  RMDir /r "$LOCALAPPDATA\alpha-print"
  DetailPrint "        Cache removido."

  ; 3. Arquivos temporarios de impressao (*.bin e *.ps1 criados pelo printer.ts)
  DetailPrint "[ 60%] Removendo arquivos temporarios de impressao..."
  Delete "$TEMP\alpha-print-*.bin"
  Delete "$TEMP\alpha-print-*.ps1"
  DetailPrint "        Temporarios removidos."

  ; 4. Entradas de registro criadas pelo electron-store e pelo Electron
  DetailPrint "[ 80%] Removendo entradas do registro do Windows..."
  DeleteRegKey HKCU "Software\Alpha Print"
  DeleteRegKey HKCU "Software\alpha-print"
  ; Remove entrada de auto-start caso o app tenha criado
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Alpha Print"
  DetailPrint "        Registro limpo."

  DetailPrint ""
  DetailPrint "[100%] Limpeza completa concluida."
  DetailPrint ""
  DetailPrint "====================================="
  DetailPrint "  Desinstalacao concluida!"
  DetailPrint "====================================="
  DetailPrint ""
  DetailPrint "Nenhum dado do Alpha Print permanece no computador."
!macroend

; --- Pagina final do desinstalador (apos MUI_UNPAGE_INSTFILES) ---
!macro customUninstallPage
  !define MUI_FINISHPAGE_TITLE "Desinstalacao concluida!"
  !define MUI_FINISHPAGE_TEXT "O Alpha Print foi completamente removido do seu computador.$\r$\n$\r$\nTodos os dados, configuracoes e arquivos temporarios foram apagados.$\r$\n$\r$\nSe quiser reinstalar, baixe novamente em portal.alphacardapio.com.$\r$\n$\r$\nClique em Concluir para fechar."
!macroend
