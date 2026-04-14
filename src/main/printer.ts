// ============================================================
// Printer — Impressao ESC/POS nativa no Windows
// Usa PowerShell + Win32 API (WritePrinter) para enviar raw data
// ============================================================

import { exec } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

/** Full path to powershell.exe — avoids PATH issues in packaged Electron */
const PS_PATH = join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);

/**
 * List all printers available on the system (Windows).
 * Returns array of printer names.
 */
export async function listPrinters(): Promise<string[]> {
  // Try PowerShell first, fallback to WMIC
  const printers = await listPrintersPS();
  if (printers.length > 0) return printers;
  return listPrintersWMIC();
}

async function listPrintersPS(): Promise<string[]> {
  return new Promise((resolve) => {
    exec(
      `"${PS_PATH}" -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"`,
      { timeout: 10000 },
      (error: Error | null, stdout: string) => {
        if (error) {
          console.error("[Printer] PowerShell Get-Printer error:", error.message);
          resolve([]);
          return;
        }

        const printers = stdout
          .split("\n")
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0);

        console.log("[Printer] PowerShell found:", printers.length, "printers");
        resolve(printers);
      }
    );
  });
}

async function listPrintersWMIC(): Promise<string[]> {
  return new Promise((resolve) => {
    exec(
      "wmic printer get name",
      { timeout: 10000 },
      (error: Error | null, stdout: string) => {
        if (error) {
          console.error("[Printer] WMIC error:", error.message);
          resolve([]);
          return;
        }

        const printers = stdout
          .split("\n")
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0 && line !== "Name");

        console.log("[Printer] WMIC found:", printers.length, "printers");
        resolve(printers);
      }
    );
  });
}

/**
 * Get the default printer name (Windows).
 */
export async function getDefaultPrinter(): Promise<string> {
  return new Promise((resolve) => {
    exec(
      `"${PS_PATH}" -NoProfile -Command "(Get-CimInstance -ClassName Win32_Printer | Where-Object {$_.Default -eq $true}).Name"`,
      { timeout: 10000 },
      (error, stdout) => {
        if (error) {
          resolve("");
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

/**
 * Print raw ESC/POS data to a specific printer.
 *
 * Strategy: Write binary data to temp file, then use PowerShell
 * with Win32 API (OpenPrinter/WritePrinter) to send raw bytes
 * directly to the printer, bypassing the driver. This is the
 * correct way to print ESC/POS on Windows.
 *
 * @param printerName Exact name of the Windows printer
 * @param base64Data ESC/POS data encoded as base64
 * @param copies Number of copies to print (default 1)
 */
export async function printRaw(
  printerName: string,
  base64Data: string,
  copies = 1
): Promise<void> {
  const buffer = Buffer.from(base64Data, "base64");

  for (let i = 0; i < copies; i++) {
    await sendToPrinter(printerName, buffer);
  }
}

/**
 * Build a PowerShell script file that uses Win32 API (winspool.drv)
 * to send raw bytes to a printer. Writes the script as a .ps1 file
 * because inline PowerShell with C# Add-Type is too complex for
 * command-line escaping.
 */
function buildRawPrintScript(printerName: string, dataFilePath: string): string {
  const escapedPrinter = printerName.replace(/'/g, "''");
  const escapedFile = dataFilePath.replace(/\\/g, "\\\\");

  return `$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinter {
    [StructLayout(LayoutKind.Sequential)]
    public struct DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Ansi)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr hPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOA pDocInfo);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    public static void SendRaw(string printerName, byte[] data) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("Nao foi possivel abrir a impressora: " + printerName + " (erro " + Marshal.GetLastWin32Error() + ")");

        var di = new DOCINFOA {
            pDocName = "Alpha Print RAW",
            pDataType = "RAW"
        };

        try {
            if (!StartDocPrinter(hPrinter, 1, ref di))
                throw new Exception("StartDocPrinter falhou (erro " + Marshal.GetLastWin32Error() + ")");
            if (!StartPagePrinter(hPrinter))
                throw new Exception("StartPagePrinter falhou (erro " + Marshal.GetLastWin32Error() + ")");

            IntPtr pBytes = Marshal.AllocCoTaskMem(data.Length);
            Marshal.Copy(data, 0, pBytes, data.Length);
            int written;
            bool ok = WritePrinter(hPrinter, pBytes, data.Length, out written);
            Marshal.FreeCoTaskMem(pBytes);

            if (!ok)
                throw new Exception("WritePrinter falhou (erro " + Marshal.GetLastWin32Error() + ")");

            EndPagePrinter(hPrinter);
            EndDocPrinter(hPrinter);
        } finally {
            ClosePrinter(hPrinter);
        }
    }
}
'@

$bytes = [System.IO.File]::ReadAllBytes('${escapedFile}')
[RawPrinter]::SendRaw('${escapedPrinter}', $bytes)
Write-Host 'OK'
`;
}

async function sendToPrinter(
  printerName: string,
  data: Buffer
): Promise<void> {
  // Write raw data to temp file
  const jobId = randomUUID();
  const tempFile = join(tmpdir(), `alpha-print-${jobId}.bin`);
  const scriptFile = join(tmpdir(), `alpha-print-${jobId}.ps1`);

  writeFileSync(tempFile, data);

  return new Promise((resolve, reject) => {
    // Write the PowerShell script to a temp .ps1 file
    // (avoids complex escaping issues with inline commands)
    const script = buildRawPrintScript(printerName, tempFile);
    writeFileSync(scriptFile, script, "utf-8");

    // Primary method: Win32 API WritePrinter via PowerShell script
    const cmd = `"${PS_PATH}" -NoProfile -ExecutionPolicy Bypass -File "${scriptFile}"`;

    console.log("[Printer] Sending to:", printerName, "via Win32 API");
    exec(cmd, { timeout: 30000 }, (error: Error | null, stdout: string, stderr: string) => {
      if (!error) {
        // Success — clean up and resolve
        cleanupTemp(tempFile);
        cleanupTemp(scriptFile);
        resolve();
        return;
      }

      console.error("[Printer] Win32 raw print failed:", error.message);
      console.log("[Printer] Trying shared printer fallback...");

      // Fallback: try via shared printer path (\\localhost\PRINTER)
      // This works if the printer is shared on the network
      const shareName = printerName.replace(/"/g, "");
      const fallbackCmd =
        `cmd /c copy /b "${tempFile}" "\\\\localhost\\${shareName}"`;

      exec(fallbackCmd, { timeout: 15000 }, (err2) => {
        cleanupTemp(tempFile);
        cleanupTemp(scriptFile);

        if (err2) {
          reject(
            new Error(
              `Falha ao imprimir em "${printerName}". ` +
              `Verifique se a impressora esta ligada e conectada. ` +
              `Erro: ${error.message}`
            )
          );
        } else {
          resolve();
        }
      });
    });
  });
}

function cleanupTemp(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Send a test print to verify printer works.
 */
export async function printTest(printerName: string): Promise<void> {
  // Simple ESC/POS test: initialize, print text, cut
  const ESC = 0x1b;
  const GS = 0x1d;

  const commands: number[] = [
    ESC, 0x40,           // Initialize
    ESC, 0x74, 19,       // Code page CP858
    ESC, 0x61, 1,        // Center align
    ESC, 0x45, 1,        // Bold on
    ESC, 0x21, 0x30,     // Double size
  ];

  // "TESTE"
  for (const c of "TESTE") commands.push(c.charCodeAt(0));
  commands.push(0x0a); // LF

  commands.push(ESC, 0x21, 0x00);  // Normal size
  commands.push(ESC, 0x45, 0);     // Bold off

  // Separator
  for (let i = 0; i < 48; i++) commands.push(0x2d);
  commands.push(0x0a);

  // "Alpha Print v1.0"
  const msg = "Alpha Print v1.0";
  for (const c of msg) commands.push(c.charCodeAt(0));
  commands.push(0x0a);

  // "Impressao funcionando!"
  const msg2 = "Impressao funcionando!";
  for (const c of msg2) commands.push(c.charCodeAt(0));
  commands.push(0x0a, 0x0a, 0x0a);

  // Cut
  commands.push(GS, 0x56, 66, 1);

  const buffer = Buffer.from(commands);
  const base64 = buffer.toString("base64");
  await printRaw(printerName, base64);
}
