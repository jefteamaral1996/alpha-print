// ============================================================
// Order Types & Constants (ported from web panel)
// Only types/constants used by receipt-templates.ts
// ============================================================

export type OrderStatus =
  | "CRIADO"
  | "PENDENTE"
  | "PAGAMENTO_PENDENTE"
  | "AGUARDANDO_PAGAMENTO"
  | "EM_PREPARO"
  | "PRONTO"
  | "AGUARDANDO_ENTREGA"
  | "EM_ENTREGA"
  | "ESPERANDO_RETIRADA"
  | "AGENDADO"
  | "CONCLUIDO"
  | "CANCELANDO"
  | "CANCELAMENTO_SOLICITADO"
  | "CANCELADO"
  | "MESA_ABERTA"
  | "MESA_FECHAMENTO_SOLICITADO"
  | "MESA_CONCLUIDA";

export type PaymentStatus = "PENDENTE" | "PAGO";
export type PaymentMethod = "PIX" | "CARTAO" | "DINHEIRO" | "OUTRO" | "PIX_ONLINE" | "CARTAO_ONLINE";
export type OrderModality = "ENTREGA" | "RETIRADA" | "BALCAO" | "MESA";
export type OrderChannel = "admin" | "digital_menu" | "whatsapp" | "portal" | "ifood" | "IFOOD";

export const MODALITY_LABELS: Record<OrderModality, string> = {
  ENTREGA: "Delivery",
  RETIRADA: "Retirada",
  BALCAO: "Consumo no local",
  MESA: "Mesa",
};

export const CHANNEL_LABELS: Record<string, string> = {
  admin: "Portal",
  digital_menu: "Site",
  whatsapp: "WhatsApp",
  portal: "Portal",
  ifood: "iFood",
  IFOOD: "iFood",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: "Pix",
  CARTAO: "Cartao",
  DINHEIRO: "Dinheiro",
  OUTRO: "Outro",
  PIX_ONLINE: "Pix Online",
  CARTAO_ONLINE: "Cartao Online",
};

export interface Customer {
  id: string;
  store_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  total_orders?: number;
}

export interface OrderItemComplement {
  id: string;
  store_id: string;
  order_item_id: string;
  complement_id: string | null;
  option_id?: string | null;
  name_snapshot: string;
  description_snapshot?: string | null;
  price: number;
  quantity: number;
  created_at: string;
}

export interface OrderItemOption {
  id: string;
  store_id: string;
  order_item_id: string;
  option_group_id: string | null;
  option_item_id: string | null;
  group_name_snapshot: string;
  item_name_snapshot: string;
  price_delta: number;
  created_at: string;
}

export interface OrderItem {
  id: string;
  store_id: string;
  order_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  order_item_complements?: OrderItemComplement[];
  order_item_options?: OrderItemOption[];
}

export interface OrderPayment {
  id: string;
  store_id: string;
  order_id: string;
  method: string;
  label: string | null;
  amount: number;
  observation: string | null;
  created_at: string;
}

export interface OrderDelivery {
  id: string;
  store_id: string;
  order_id: string;
  address_id: string | null;
  address_snapshot: {
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    reference?: string;
    lat?: number;
    lng?: number;
  } | null;
  estimated_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  store_id: string;
  order_number: number;
  customer_id: string;
  modality: OrderModality;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  subtotal: number;
  delivery_fee: number;
  discount: number;
  additional_fee: number;
  additional_fee_mode: string;
  total: number;
  cashback_earned: number;
  cashback_used: number;
  sla_minutes: number;
  notes: string | null;
  channel: OrderChannel;
  tab_id: string | null;
  cash_session_id: string | null;
  arrived_at: string;
  status_changed_at: string;
  concluded_at: string | null;
  canceled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: string | null;
  scheduled_for: string | null;
  delivery_estimate_start: string | null;
  delivery_estimate_end: string | null;
  change_for: number | null;
  cpf_invoice: string | null;
  payment_label: string | null;
  origin_code: string | null;
  // iFood-specific fields
  ifood_pickup_code: string | null;
  ifood_delivered_by: string | null;
  external_id: string | null;
  external_display_id: string | null;
  // Relations (populated by Supabase join)
  customer?: Customer;
  order_items?: OrderItem[];
  order_delivery?: OrderDelivery[];
  order_payments?: OrderPayment[];
  tab?: { table_id: string | null; tables: { name: string } | null } | null;
}
