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
const areasList = document.getElementById("areas-list");
const appInfoEl = document.getElementById("app-info");
const deviceNameInput = document.getElementById("device-name");
const lastPrintEl = document.getElementById("last-print");
const lastPrintTimeEl = document.getElementById("last-print-time");
const internetDot = document.getElementById("internet-dot");
const internetText = document.getElementById("internet-text");
const serverDot = document.getElementById("server-dot");
const serverText = document.getElementById("server-text");

let printers = [];
let areas = [];
let mappings = {};
let deviceNameTimer = null;

// ── Area type labels ──
const AREA_TYPE_LABELS = {
  caixa: "Caixa",
  cozinha: "Cozinha",
  bar: "Bar",
  expedicao: "Expedicao",
  geral: "Geral",
};

// ── Init ──

async function init() {
  const status = await api.getAuthStatus();
  if (status.isLoggedIn) {
    showMainScreen(status);
  } else {
    showLoginScreen();
  }

  // Listen for real-time updates from main process
  api.onAreasUpdated((newAreas) => {
    areas = newAreas;
    renderAreas();
  });

  api.onPrintersUpdated((newPrinters) => {
    printers = newPrinters;
    renderPrinters();
    renderAreas(); // Re-render areas to update dropdowns
  });

  api.onPrintEvent((event) => {
    if (event.type === "printed") {
      lastPrintEl.classList.remove("hidden");
      lastPrintTimeEl.textContent = new Date().toLocaleTimeString("pt-BR");
    }
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
  await refreshAreas();
  await loadAppInfo();
  await loadConnectionStatus();
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

// ── Areas (from portal, read-only — mapping is done on the portal) ──

async function refreshAreas() {
  areasList.innerHTML = '<p class="loading">Carregando areas do portal...</p>';

  try {
    const result = await api.getAreas();
    areas = result.areas || [];
    mappings = result.mappings || {};
    renderAreas();
  } catch (err) {
    areasList.innerHTML = '<p class="loading">Erro ao carregar areas</p>';
  }
}

function renderAreas() {
  if (areas.length === 0) {
    areasList.innerHTML = `
      <div class="empty-state">
        <p>Nenhuma area de impressao configurada.</p>
        <p class="hint">Configure as areas no portal (Configuracoes > Impressao).</p>
      </div>
    `;
    return;
  }

  areasList.innerHTML = "";

  for (const area of areas) {
    if (!area.enabled) continue;

    const mapping = mappings[area.id];
    const mappedPrinter = mapping ? mapping.printerName : "";

    const card = document.createElement("div");
    card.className = "area-card";

    let mappingHtml;
    if (mappedPrinter) {
      mappingHtml = `
        <div class="area-mapping read-only">
          <span class="mapping-label">Impressora:</span>
          <span class="mapping-value">${escapeHtml(mappedPrinter)}</span>
          <span class="mapping-status active"></span>
        </div>
      `;
    } else {
      mappingHtml = `
        <div class="area-mapping read-only no-printer">
          <span class="mapping-label">Nenhuma impressora mapeada</span>
          <span class="mapping-hint">Configure no portal</span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="area-header">
        <div class="area-info">
          <span class="area-name">${escapeHtml(area.name)}</span>
          <span class="area-type">${AREA_TYPE_LABELS[area.area_type] || area.area_type}</span>
        </div>
        <div class="area-meta">
          <span class="area-detail">${area.copies} copia${area.copies > 1 ? "s" : ""}</span>
          <span class="area-detail">${area.paper_width === 48 ? "80mm" : "58mm"}</span>
        </div>
      </div>
      ${mappingHtml}
    `;
    areasList.appendChild(card);
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
        <span class="label">ID do dispositivo</span>
        <span class="value">${(info.deviceId || "").slice(0, 8)}...</span>
      </div>
      <div class="info-row">
        <span class="label">Iniciar com Windows</span>
        <span class="value">
          <label class="toggle">
            <input type="checkbox" id="auto-start-toggle" ${info.autoStartEnabled ? "checked" : ""} onchange="toggleAutoStart(this.checked)" />
            <span class="toggle-label">${info.autoStartEnabled ? "Sim" : "Nao"}</span>
          </label>
        </span>
      </div>
    `;
  } catch {
    appInfoEl.innerHTML = "";
  }
}

async function toggleAutoStart(enabled) {
  try {
    await api.toggleAutoStart(enabled);
    const label = document.querySelector("#auto-start-toggle + .toggle-label");
    if (label) label.textContent = enabled ? "Sim" : "Nao";
  } catch (err) {
    console.error("Failed to toggle auto-start:", err);
  }
}

window.toggleAutoStart = toggleAutoStart;

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

// ── Start ──
init();
