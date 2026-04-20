// ============================================================
// Printing Types (ported from web panel)
// ============================================================

import type { Order } from "./order-types";

/** Largura do papel em colunas de caracteres */
export type PaperWidth = 32 | 48;

/** Tipo de recibo que pode ser impresso */
export type ReceiptType = "delivery" | "mesa" | "balcao" | "retirada" | "cozinha";

/** Tipo de area de impressao (setor fisico do estabelecimento) */
export type PrintAreaType =
  | "caixa"
  | "cozinha"
  | "bar"
  | "expedicao"
  | "geral"
  | "recibo_venda"
  | "comanda_producao";

/** Configuracoes de impressao armazenadas em store_settings */
export interface PrintSettings {
  print_header_enabled: boolean;
  print_header_text: string | null;
  print_footer_text: string | null;
  print_paper_width: PaperWidth;
  print_font_size: number;
  print_show_complement_name?: boolean;
  print_show_option_description?: boolean;
}

/** Perfil da empresa (dados do cabecalho do recibo) */
export interface CompanyProfile {
  name: string;
  cnpj: string | null;
  contact_phone: string;
  address_street: string | null;
  address_number: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
}

/** Dados completos para gerar um recibo */
export interface PrintJobData {
  receiptType: ReceiptType;
  order: Order;
  company: CompanyProfile;
  printSettings: PrintSettings;
  paperWidth: PaperWidth;
  operatorName?: string | null;
}

/** Mapeamento de OrderModality para ReceiptType */
export const MODALITY_TO_RECEIPT: Record<string, ReceiptType> = {
  ENTREGA: "delivery",
  MESA: "mesa",
  BALCAO: "balcao",
  RETIRADA: "retirada",
};

/** Area de impressao do banco (campos relevantes para roteamento) */
export interface PrintAreaConfig {
  id: string;
  name: string;
  area_type: PrintAreaType;
  enabled: boolean;
  copies: number;
  paper_width: PaperWidth;
  print_receipt_types: ReceiptType[];
  modality_printer_overrides?: Partial<Record<ReceiptType, string | null>>;
}
