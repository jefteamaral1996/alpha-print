// ============================================================
// ESC/POS Command Builder (ported from web panel)
// Gera array de bytes para impressoras termicas
// Referencia: Epson ESC/POS Application Programming Guide
// ============================================================

import type { PaperWidth } from "./types";

// -- ESC/POS Command Constants --

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// -- Character encoding map (Latin-1 supplement -> CP858/CP437) --

const ACCENT_MAP: Record<string, number> = {
  // Lowercase accented
  "\u00e1": 0xa0, "\u00e0": 0x85, "\u00e2": 0x83, "\u00e3": 0xc6, "\u00e4": 0x84,
  "\u00e9": 0x82, "\u00e8": 0x8a, "\u00ea": 0x88, "\u00eb": 0x89,
  "\u00ed": 0xa1, "\u00ec": 0x8d, "\u00ee": 0x8c, "\u00ef": 0x8b,
  "\u00f3": 0xa2, "\u00f2": 0x95, "\u00f4": 0x93, "\u00f5": 0xe4, "\u00f6": 0x94,
  "\u00fa": 0xa3, "\u00f9": 0x97, "\u00fb": 0x96, "\u00fc": 0x81,
  "\u00e7": 0x87, "\u00f1": 0xa4,
  // Uppercase accented
  "\u00c1": 0xb5, "\u00c0": 0xb7, "\u00c2": 0xb6, "\u00c3": 0xc7, "\u00c4": 0x8e,
  "\u00c9": 0x90, "\u00c8": 0xd4, "\u00ca": 0xd2, "\u00cb": 0xd3,
  "\u00cd": 0xd6, "\u00cc": 0xde, "\u00ce": 0xd7, "\u00cf": 0xd8,
  "\u00d3": 0xe0, "\u00d2": 0xe3, "\u00d4": 0xe2, "\u00d5": 0xe5, "\u00d6": 0x99,
  "\u00da": 0xe9, "\u00d9": 0xeb, "\u00db": 0xea, "\u00dc": 0x9a,
  "\u00c7": 0x80, "\u00d1": 0xa5,
  // Symbols
  "\u00b0": 0xf8, "\u00b2": 0xfd, "\u00a7": 0x15,
  "\u00a1": 0xad, "\u00bf": 0xa8,
  "\u00bd": 0xab, "\u00bc": 0xac,
  "\u00ab": 0xae, "\u00bb": 0xaf,
};

/**
 * Converte string UTF-8 para bytes CP437/CP858 compativel com impressoras termicas.
 * Caracteres sem mapeamento sao substituidos por '?'.
 */
function encodeText(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) {
      // ASCII printable -- pass through
      bytes.push(code);
    } else if (ACCENT_MAP[char] !== undefined) {
      bytes.push(ACCENT_MAP[char]);
    } else if (code === 0x0a) {
      bytes.push(LF);
    } else {
      // Fallback for unmapped chars
      bytes.push(0x3f); // '?'
    }
  }
  return bytes;
}

// -- Builder Class --

export class EscPosBuilder {
  private buffer: number[] = [];
  private width: number;

  constructor(paperWidth: PaperWidth = 48) {
    this.width = paperWidth;
    this.initialize();
  }

  /** ESC @ -- Initialize printer (reset to defaults) */
  private initialize(): this {
    this.buffer.push(ESC, 0x40);
    // Select code page CP858 (ESC t 19) -- supports accented chars
    this.buffer.push(ESC, 0x74, 19);
    return this;
  }

  /** ESC a 0 -- Left align */
  alignLeft(): this {
    this.buffer.push(ESC, 0x61, 0);
    return this;
  }

  /** ESC a 1 -- Center align */
  alignCenter(): this {
    this.buffer.push(ESC, 0x61, 1);
    return this;
  }

  /** ESC a 2 -- Right align */
  alignRight(): this {
    this.buffer.push(ESC, 0x61, 2);
    return this;
  }

  /** ESC E n -- Bold on/off */
  bold(on = true): this {
    this.buffer.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  /** ESC - n -- Underline on/off (1 = single, 2 = double, 0 = off) */
  underline(on = true): this {
    this.buffer.push(ESC, 0x2d, on ? 1 : 0);
    return this;
  }

  /** ESC G n -- Double-strike on/off. */
  doubleStrike(on = true): this {
    this.buffer.push(ESC, 0x47, on ? 1 : 0);
    return this;
  }

  /** ESC ! n -- Select print mode (double-width, double-height) */
  doubleSize(on = true): this {
    this.buffer.push(ESC, 0x21, on ? 0x30 : 0x00);
    return this;
  }

  /** ESC ! n -- Double width only */
  doubleWidth(on = true): this {
    this.buffer.push(ESC, 0x21, on ? 0x20 : 0x00);
    return this;
  }

  /** ESC ! n -- Double height only (sem alterar largura) */
  doubleHeight(on = true): this {
    this.buffer.push(ESC, 0x21, on ? 0x10 : 0x00);
    return this;
  }

  /** Add text (encoded to CP437/CP858) */
  text(str: string): this {
    this.buffer.push(...encodeText(str));
    return this;
  }

  /** Imprime o texto duas vezes na mesma linha (overprint) para simular negrito mais espesso. */
  overprintLn(str: string): this {
    this.text(str).buffer.push(0x0d); // CR -- volta cursor sem LF
    this.text(str).newLine();         // segunda passagem + LF
    return this;
  }

  /** Add text followed by newline */
  textLn(str: string): this {
    return this.text(str).newLine();
  }

  /** Add n newlines (default 1) */
  newLine(n = 1): this {
    for (let i = 0; i < n; i++) {
      this.buffer.push(LF);
    }
    return this;
  }

  /** Separator line (default: dashes) */
  separator(char = "-"): this {
    this.alignLeft();
    this.textLn(char.repeat(this.width));
    return this;
  }

  /** Double separator (=) */
  doubleSeparator(): this {
    return this.separator("=");
  }

  /**
   * Two-column layout: left-aligned text + right-aligned text.
   */
  columns(left: string, right: string): this {
    const gap = this.width - left.length - right.length;
    if (gap < 1) {
      const maxLeft = this.width - right.length - 1;
      this.textLn(left.slice(0, maxLeft) + " " + right);
    } else {
      this.textLn(left + " ".repeat(gap) + right);
    }
    return this;
  }

  /**
   * Three-column layout: quantity | description | value
   */
  threeColumns(qty: string, desc: string, value: string): this {
    const qtyWidth = qty.length + 1;
    const valueWidth = value.length;
    const descWidth = Math.max(1, this.width - qtyWidth - valueWidth - 1);

    let descTruncated = desc;
    if (desc.length > descWidth) {
      descTruncated = desc.slice(0, Math.max(0, descWidth - 1)) + ".";
    }
    descTruncated = descTruncated.slice(0, descWidth);

    const gap = this.width - qtyWidth - descTruncated.length - valueWidth;
    this.textLn(
      qty + " " + descTruncated + " ".repeat(Math.max(gap, 1)) + value
    );
    return this;
  }

  /**
   * Indented text (for complements, options, notes)
   */
  indented(prefix: string, text: string): this {
    const indent = prefix.length;

    const words = text.split(" ");
    let line = prefix;
    for (const word of words) {
      if (line.length + word.length + 1 > this.width && line.length > indent) {
        this.textLn(line);
        line = " ".repeat(indent) + word;
      } else {
        line += (line.length === indent ? "" : " ") + word;
      }
    }
    if (line.trim()) this.textLn(line);
    return this;
  }

  /** Word-wrap text to fit paper width */
  wrappedText(text: string): this {
    const words = text.split(" ");
    let line = "";
    for (const word of words) {
      if (line.length + word.length + 1 > this.width && line.length > 0) {
        this.textLn(line);
        line = word;
      } else {
        line += (line.length > 0 ? " " : "") + word;
      }
    }
    if (line) this.textLn(line);
    return this;
  }

  /** GS V 66 1 -- Partial cut (leaves small connection) */
  cut(): this {
    this.buffer.push(GS, 0x56, 66, 1);
    return this;
  }

  /** Build final Uint8Array */
  build(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  /** Build as base64 string (for Alpha Print raw printing) */
  buildBase64(): string {
    const bytes = this.build();
    return Buffer.from(bytes).toString("base64");
  }

  /** Get current paper width */
  getWidth(): number {
    return this.width;
  }
}
