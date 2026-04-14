// ============================================================
// Alpha Print — Renderer (vanilla JS — keeps the app lightweight)
// Communicates with main process via window.alphaPrint (preload)
// ============================================================

const api = window.alphaPrint;

// ── DOM Elements ──

const loginScreen = document.getElementById("login-screen");
const configScreen = document.getElementById("config-screen");
const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("login-btn");
const loginText = document.getElementById("login-text");
const loginLoading = document.getElementById("login-loading");
const loginError = document.getElementById("login-error");
const storeInfo = document.getElementById("store-info");
const printerList = document.getElementById("printer-list");
const testBtn = document.getElementById("test-btn");
const appInfoEl = document.getElementById("app-info");

let selectedPrinter = "";
let printers = [];

// ── Init ──

async function init() {
  const status = await api.getAuthStatus();
  if (status.isLoggedIn) {
    showConfigScreen(status);
  } else {
    showLoginScreen();
  }
}

// ── Login ──

function showLoginScreen() {
  loginScreen.classList.remove("hidden");
  configScreen.classList.add("hidden");
  emailInput.focus();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) return;

  // Show loading
  loginBtn.disabled = true;
  loginText.classList.add("hidden");
  loginLoading.classList.remove("hidden");
  loginError.classList.add("hidden");

  try {
    const result = await api.login(email, password);

    if (result.success) {
      const status = await api.getAuthStatus();
      showConfigScreen(status);
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

// ── Config Screen ──

async function showConfigScreen(status) {
  loginScreen.classList.add("hidden");
  configScreen.classList.remove("hidden");

  storeInfo.textContent = status.storeName
    ? `${status.storeName} - ${status.email}`
    : status.email;

  await refreshPrinters();
  await loadAppInfo();
}

// ── Printers ──

async function refreshPrinters() {
  printerList.innerHTML = '<p class="loading">Buscando impressoras...</p>';
  testBtn.disabled = true;

  try {
    const result = await api.listPrinters();
    printers = result.printers || [];
    selectedPrinter = result.selected || "";

    if (printers.length === 0) {
      printerList.innerHTML = '<p class="loading">Nenhuma impressora encontrada</p>';
      return;
    }

    printerList.innerHTML = "";

    for (const name of printers) {
      const isSelected = name === selectedPrinter;
      const isDefault = name === result.defaultPrinter;

      const item = document.createElement("div");
      item.className = `printer-item${isSelected ? " selected" : ""}`;
      item.innerHTML = `
        <div class="radio"></div>
        <span class="name">${escapeHtml(name)}</span>
        ${isDefault ? '<span class="badge">Padrao</span>' : ""}
      `;
      item.addEventListener("click", () => selectPrinter(name));
      printerList.appendChild(item);
    }

    testBtn.disabled = !selectedPrinter;
  } catch (err) {
    printerList.innerHTML = '<p class="loading">Erro ao buscar impressoras</p>';
  }
}

async function selectPrinter(name) {
  selectedPrinter = name;
  await api.selectPrinter(name);

  // Update UI
  const items = printerList.querySelectorAll(".printer-item");
  items.forEach((item, i) => {
    if (printers[i] === name) {
      item.classList.add("selected");
    } else {
      item.classList.remove("selected");
    }
  });

  testBtn.disabled = false;
}

async function testPrint() {
  if (!selectedPrinter) return;

  testBtn.disabled = true;
  testBtn.textContent = "Imprimindo...";

  try {
    const result = await api.testPrint(selectedPrinter);
    if (result.success) {
      testBtn.textContent = "Teste enviado!";
      setTimeout(() => {
        testBtn.textContent = "Imprimir teste";
        testBtn.disabled = false;
      }, 2000);
    } else {
      testBtn.textContent = "Falhou";
      setTimeout(() => {
        testBtn.textContent = "Imprimir teste";
        testBtn.disabled = false;
      }, 2000);
      alert("Erro: " + (result.error || "Falha desconhecida"));
    }
  } catch (err) {
    testBtn.textContent = "Imprimir teste";
    testBtn.disabled = false;
    alert("Erro ao imprimir: " + err.message);
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

// Make functions available globally for onclick handlers
window.refreshPrinters = refreshPrinters;
window.testPrint = testPrint;
window.doLogout = doLogout;

// ── Start ──
init();
