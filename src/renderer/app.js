// ============================================================
// Alpha Print — Renderer (vanilla JS — keeps the app lightweight)
// v2: Read-only executor mode
// Config comes from portal, app only maps printers and executes
// ============================================================

const api = window.alphaPrint;

// ── DOM Elements ──

const loginScreen = document.getElementById("login-screen");
const mainScreen = document.getElementById("main-screen");
const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("login-btn");
const loginText = document.getElementById("login-text");
const loginLoading = document.getElementById("login-loading");
const loginError = document.getElementById("login-error");
const storeInfo = document.getElementById("store-info");
const printerList = document.getElementById("printer-list");
const appInfoEl = document.getElementById("app-info");
const deviceNameInput = document.getElementById("device-name");
const lastPrintEl = document.getElementById("last-print");
const lastPrintTimeEl = document.getElementById("last-print-time");
const internetDot = document.getElementById("internet-dot");
const internetText = document.getElementById("internet-text");
const serverDot = document.getElementById("server-dot");
const serverText = document.getElementById("server-text");
const reconnectRow = document.getElementById("reconnect-row");
const reconnectBtn = document.getElementById("reconnect-btn");
const recentJobsEl = document.getElementById("recent-jobs");
const toastContainer = document.getElementById("toast-container");

let printers = [];
let deviceNameTimer = null;

// ── Init ──

async function init() {
  const status = await api.getAuthStatus();
  if (status.isLoggedIn) {
    showMainScreen(status);
  } else {
    showLoginScreen();
  }

  // Listen for real-time updates from main process
  api.onPrintersUpdated((newPrinters) => {
    printers = newPrinters;
    renderPrinters();
  });

  api.onPrintEvent((event) => {
    if (event.type === "printed") {
      lastPrintEl.classList.remove("hidden");
      lastPrintTimeEl.textContent = new Date().toLocaleTimeString("pt-BR");
    }
  });

  // Listen for recent jobs updates
  api.onRecentJobsUpdated((jobs) => {
    renderRecentJobs(jobs);
  });

  // Listen for print failure notifications
  api.onPrintFailure((data) => {
    showFailureAlert(data);
  });

  // Listen for connection status changes from main process
  api.onConnectionStatusChanged((status) => {
    updateConnectionStatus(status);
  });
}

// ── Connection Status ──

function updateConnectionStatus(status) {
  // Update internet indicator
  if (internetDot && internetText) {
    internetDot.className = "status-dot";
    switch (status.internet) {
      case "online":
        internetDot.classList.add("green");
        internetText.textContent = "Conectada";
        break;
      case "offline":
        internetDot.classList.add("red");
        internetText.textContent = "Sem conexao";
        break;
      case "checking":
        internetDot.classList.add("checking");
        internetText.textContent = "Verificando...";
        break;
    }
  }

  // Update server indicator
  if (serverDot && serverText) {
    serverDot.className = "status-dot";
    switch (status.server) {
      case "connected":
        serverDot.classList.add("green");
        serverText.textContent = status.serverDetail
          ? `Conectado (${status.serverDetail.toLowerCase()})`
          : "Conectado";
        break;
      case "disconnected":
        serverDot.classList.add("red");
        serverText.textContent = "Desconectado";
        break;
      case "reconnecting":
        serverDot.classList.add("yellow");
        serverText.textContent = status.serverDetail || "Reconectando...";
        break;
    }
  }

  // Mecanismo 4: Mostra/esconde botao de reconexao manual
  if (reconnectRow) {
    if (status.server === "disconnected" || status.server === "reconnecting") {
      reconnectRow.classList.remove("hidden");
    } else {
      reconnectRow.classList.add("hidden");
      // Restaura o botao caso estivesse em estado de "aguardando..."
      if (reconnectBtn) {
        reconnectBtn.disabled = false;
        reconnectBtn.textContent = "Reconectar agora";
      }
    }
  }
}

// ── Reconexao Manual (Mecanismo 4) ──

async function doReconnect() {
  if (!reconnectBtn) return;
  reconnectBtn.disabled = true;
  reconnectBtn.textContent = "Reconectando...";

  try {
    await api.reconnectNow();
  } catch {
    // Ignora — o main process ja trata o erro
  }

  // Restaura o botao apos 3s (o status real chegara via onConnectionStatusChanged)
  setTimeout(() => {
    if (reconnectBtn && reconnectBtn.disabled) {
      reconnectBtn.disabled = false;
      reconnectBtn.textContent = "Reconectar agora";
    }
  }, 3000);
}

// ── Login ──

function showLoginScreen() {
  loginScreen.classList.remove("hidden");
  mainScreen.classList.add("hidden");
  emailInput.focus();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) return;

  loginBtn.disabled = true;
  loginText.classList.add("hidden");
  loginLoading.classList.remove("hidden");
  loginError.classList.add("hidden");

  try {
    const result = await api.login(email, password);

    if (result.success) {
      const status = await api.getAuthStatus();
      showMainScreen(status);
    } else {
      loginError.textContent = result.error || "Falha no login";
      loginError.classList.remove("hidden");
    }
  } catch (err) {
    loginError.textContent = "Erro de conexao. Verifique a internet.";
    loginError.classList.remove("hidden");
  } finally {
    loginBtn.disabled = false;
    loginText.classList.remove("hidden");
    loginLoading.classList.add("hidden");
  }
});

// ── Main Screen ──

async function showMainScreen(status) {
  loginScreen.classList.add("hidden");
  mainScreen.classList.remove("hidden");

  storeInfo.textContent = status.storeName
    ? `${status.storeName} — ${status.email}`
    : status.email;

  // Load device name
  const appInfo = await api.getAppInfo();
  deviceNameInput.value = appInfo.deviceName || "";

  // Set up device name auto-save
  deviceNameInput.addEventListener("input", () => {
    clearTimeout(deviceNameTimer);
    deviceNameTimer = setTimeout(() => {
      api.setDeviceName(deviceNameInput.value.trim());
    }, 800);
  });

  await refreshPrinters();
  await loadAppInfo();
  await loadConnectionStatus();
  await loadRecentJobs();
}

// ── Connection Status (initial load) ──

async function loadConnectionStatus() {
  try {
    const status = await api.getConnectionStatus();
    updateConnectionStatus(status);
  } catch {
    // If the IPC is not available yet, leave default state
  }
}

// ── Printers (read-only list with test button) ──

async function refreshPrinters() {
  printerList.innerHTML = '<p class="loading">Buscando impressoras...</p>';

  try {
    const result = await api.listPrinters();
    printers = result.printers || [];
    renderPrinters();
  } catch (err) {
    printerList.innerHTML = '<p class="loading">Erro ao buscar impressoras</p>';
  }
}

function renderPrinters() {
  if (printers.length === 0) {
    printerList.innerHTML = '<p class="loading">Nenhuma impressora encontrada</p>';
    return;
  }

  printerList.innerHTML = "";

  for (const name of printers) {
    const item = document.createElement("div");
    item.className = "printer-item read-only";
    item.innerHTML = `
      <div class="printer-icon">&#x1F5A8;</div>
      <span class="name">${escapeHtml(name)}</span>
      <button class="btn-test" onclick="testPrinter('${escapeAttr(name)}')" title="Testar impressora">Testar</button>
    `;
    printerList.appendChild(item);
  }
}

async function testPrinter(name) {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = "...";

  try {
    const result = await api.testPrint(name);
    if (result.success) {
      btn.textContent = "OK!";
      btn.classList.add("success");
      setTimeout(() => {
        btn.textContent = "Testar";
        btn.disabled = false;
        btn.classList.remove("success");
      }, 2000);
    } else {
      btn.textContent = "Falhou";
      btn.classList.add("error");
      setTimeout(() => {
        btn.textContent = "Testar";
        btn.disabled = false;
        btn.classList.remove("error");
      }, 2000);
      alert("Erro: " + (result.error || "Falha desconhecida"));
    }
  } catch (err) {
    btn.textContent = "Testar";
    btn.disabled = false;
    alert("Erro ao testar: " + err.message);
  }
}

// ── App Info ──

async function loadAppInfo() {
  try {
    const info = await api.getAppInfo();
    appInfoEl.innerHTML = `
      <div class="info-row">
        <span class="label">Versao</span>
        <span class="value">v${info.version}</span>
      </div>
      <div class="info-row">
        <span class="label">Computador</span>
        <span class="value">${escapeHtml(info.deviceName || "Sem nome")}</span>
      </div>
      <div class="info-row">
        <span class="label">Iniciar com Windows</span>
        <span class="value">Sim (automatico)</span>
      </div>
    `;
  } catch {
    appInfoEl.innerHTML = "";
  }
}

// ── Recent Jobs ──

async function loadRecentJobs() {
  try {
    const jobs = await api.getRecentJobs();
    renderRecentJobs(jobs);
  } catch {
    // Ignore — will update when jobs arrive
  }
}

function renderRecentJobs(jobs) {
  if (!recentJobsEl) return;

  if (!jobs || jobs.length === 0) {
    recentJobsEl.innerHTML = '<p class="loading">Nenhuma impressao recente</p>';
    return;
  }

  // Show only the last 3 jobs
  const displayJobs = jobs.slice(0, 3);

  recentJobsEl.innerHTML = "";

  for (const job of displayJobs) {
    const item = document.createElement("div");
    const isSuccess = job.status === "printed";
    item.className = `recent-job-item ${job.status}`;

    const time = new Date(job.timestamp).toLocaleTimeString("pt-BR");

    const iconSvg = isSuccess
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;

    const statusTitle = isSuccess ? "Impresso com sucesso" : "Falha na impressao";

    let errorHtml = "";
    if (job.error) {
      errorHtml = `<div class="rj-error">${escapeHtml(job.error)}</div>`;
    }

    const clockSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

    item.innerHTML = `
      <div class="rj-icon-box ${isSuccess ? "success" : "error"}">${iconSvg}</div>
      <div class="rj-info">
        <span class="rj-title">${statusTitle}</span>
        ${errorHtml}
      </div>
      <div class="rj-time-group">
        ${clockSvg}
        <span class="rj-time">${time}</span>
      </div>
    `;
    recentJobsEl.appendChild(item);
  }
}

// ── Toast Notifications (persistent until dismissed) ──

function showFailureAlert(data) {
  if (!toastContainer) return;

  const message = data.error
    ? `${data.printerName || "Impressora"}: ${data.error}`
    : `Erro ao imprimir em ${data.printerName || "impressora desconhecida"}`;

  const toast = document.createElement("div");
  toast.className = "toast-item";
  toast.innerHTML = `
    <span class="toast-icon">&#x26A0;</span>
    <div class="toast-text">
      <strong>Falha na impressao!</strong>
      <span>${escapeHtml(message)}</span>
    </div>
    <button class="toast-dismiss">&#x2715;</button>
  `;

  // Dismiss on X click — with slide-out animation
  const dismissBtn = toast.querySelector(".toast-dismiss");
  dismissBtn.addEventListener("click", () => {
    toast.classList.add("removing");
    toast.addEventListener("animationend", () => toast.remove());
  });

  toastContainer.appendChild(toast);
}

function dismissFailureAlert() {
  // Legacy compat — dismiss all toasts
  if (!toastContainer) return;
  const toasts = toastContainer.querySelectorAll(".toast-item");
  toasts.forEach((t) => {
    t.classList.add("removing");
    t.addEventListener("animationend", () => t.remove());
  });
}

// ── Logout ──

async function doLogout() {
  if (!confirm("Deseja realmente desconectar? A impressao automatica sera interrompida.")) {
    return;
  }

  await api.logout();
  showLoginScreen();
  passwordInput.value = "";
}

// ── Helpers ──

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

// Make functions available globally for onclick handlers
window.refreshPrinters = refreshPrinters;
window.testPrinter = testPrinter;
window.doLogout = doLogout;
window.dismissFailureAlert = dismissFailureAlert;
window.doReconnect = doReconnect;

// ── Start ──
init();
