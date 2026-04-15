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
    console.log(
      `[Updater] Nova versao disponivel: ${info.version} — baixando em background...`
    );
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[Updater] App esta atualizado.");
  });

  autoUpdater.on("error", (err) => {
    console.error(
      "[Updater] Erro ao verificar/baixar atualizacao:",
      err.message
    );
    // Falha silenciosa — nao exibe dialog de erro pro usuario
    // O app continua funcionando normalmente
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent);
    console.log(
      `[Updater] Download: ${percent}% (${Math.round(progress.transferred / 1024)}KB / ${Math.round(progress.total / 1024)}KB)`
    );
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(
      `[Updater] Versao ${info.version} baixada. Perguntando ao usuario...`
    );

    // Usa a janela focada ou a primeira disponivel
    const win =
      BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

    const dialogOptions: Electron.MessageBoxOptions = {
      type: "info",
      title: "Atualizacao disponivel",
      message: `Uma nova versao do Alpha Print (${info.version}) foi baixada.`,
      detail:
        "Deseja reiniciar o aplicativo agora para instalar a atualizacao?",
      buttons: ["Reiniciar agora", "Depois"],
      defaultId: 0,
      cancelId: 1,
    };

    const dialogPromise = win
      ? dialog.showMessageBox(win, dialogOptions)
      : dialog.showMessageBox(dialogOptions);

    dialogPromise
      .then(({ response }) => {
        if (response === 0) {
          console.log(
            "[Updater] Usuario escolheu reiniciar agora — instalando..."
          );
          // false = nao mostrar splash do instalador, true = reiniciar apos instalar
          autoUpdater.quitAndInstall(false, true);
        } else {
          console.log(
            "[Updater] Usuario escolheu instalar depois — sera instalado ao fechar o app."
          );
          // autoInstallOnAppQuit: true garante instalacao ao fechar
        }
      })
      .catch((err) => {
        console.error("[Updater] Erro ao exibir dialog de update:", err);
      });
  });

  // Verificar com delay de 3s para nao atrasar o boot do app
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[Updater] checkForUpdates falhou:", err.message);
    });
  }, 3000);
}
