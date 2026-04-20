// ============================================================
// Print Security — LGPD compliance (ported from web panel)
// Only maskCPF is needed for receipt templates
// ============================================================

/**
 * Mask CPF to show only last 6 digits (LGPD compliance).
 * Input: "12345678901" or "123.456.789-01"
 * Output: "*****678901" (last 6 visible, first 5 masked)
 */
export function maskCPF(cpf: string | null | undefined): string | null {
  if (!cpf) return null;

  const clean = cpf.replace(/\D/g, "");
  if (clean.length !== 11) return null;

  // Show last 6, mask first 5
  const masked = "*".repeat(5) + clean.slice(5);
  return masked;
}
