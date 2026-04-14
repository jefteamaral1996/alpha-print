// ============================================================
// Printer — Impressao ESC/POS nativa no Windows
// Usa PowerShell para enviar dados raw direto para a impressora
// ============================================================

import { exec } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

/**
 * List all printers available on the system (Windows).
 * Returns array of printer names.
 */
export async function listPrinters(): Promise<string[]> {
  return new Promise((resolve) => {
    exec(
      'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"',
      { timeout: 10000 },
      (error, stdout) => {
        if (error) {
          console.error("[Printer] Error listing printers:", error.message);
          resolve([]);
          return;
        }

        const printers = stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

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
      'powershell -NoProfile -Command "(Get-CimInstance -ClassName Win32_Printer | Where-Object {$_.Default -eq $true}).Name"',
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
 * Strategy: Write binary data to temp file, then use PowerShell to send
 * to the printer's raw port. This works with thermal receipt printers
 * that accept ESC/POS commands directly.
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

async function sendToPrinter(
  printerName: string,
  data: Buffer
): Promise<void> {
  // Write raw data to temp file
  const tempFile = join(tmpdir(), `alpha-print-${randomUUID()}.bin`);
  writeFileSync(tempFile, data);

  return new Promise((resolve, reject) => {
    // Use PowerShell's Out-Printer with raw data
    // Method: Copy binary file directly to printer share
    // This sends raw ESC/POS bytes without any driver processing
    const escapedPrinter = printerName.replace(/'/g, "''");
    const escapedFile = tempFile.replace(/\\/g, "\\\\");

    // Use COPY /B to send raw data to the printer
    // This bypasses the printer driver and sends ESC/POS directly
    const cmd = `powershell -NoProfile -Command "` +
      `$printer = Get-Printer -Name '${escapedPrinter}' -ErrorAction Stop; ` +
      `$port = (Get-PrinterPort -Name $printer.PortName).Name; ` +
      `Copy-Item -Path '${escapedFile}' -Destination ('\\\\\\\\localhost\\\\' + '${escapedPrinter}') -Force -ErrorAction Stop` +
      `"`;

    exec(cmd, { timeout: 15000 }, (error) => {
      // Clean up temp file
      try {
        unlinkSync(tempFile);
      } catch {
        // Ignore cleanup errors
      }

      if (error) {
        // Fallback: try direct raw printing via .NET
        const fallbackCmd = `powershell -NoProfile -Command "` +
          `Add-Type -AssemblyName System.Drawing; ` +
          `$bytes = [System.IO.File]::ReadAllBytes('${escapedFile}'); ` +
          `$doc = New-Object System.Drawing.Printing.PrintDocument; ` +
          `$doc.PrinterSettings.PrinterName = '${escapedPrinter}'; ` +
          `# Raw print via shared printer` +
          `"`;

        // Simpler fallback: use net use + copy /b
        const simpleFallback =
          `cmd /c "copy /b "${tempFile}" "\\\\localhost\\${printerName}""`;

        exec(simpleFallback, { timeout: 15000 }, (err2) => {
          try {
            unlinkSync(tempFile);
          } catch {
            // Ignore
          }
          if (err2) {
            reject(
              new Error(
                `Falha ao imprimir em "${printerName}": ${error.message}`
              )
            );
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  });
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
