// ============================================================
// Receipt Templates — 5 layouts ESC/POS (ported from web panel)
// ============================================================

import { EscPosBuilder } from "./escpos-builder";
import type { PrintJobData } from "./types";
import type { Order, OrderItem } from "./order-types";
import { MODALITY_LABELS, PAYMENT_METHOD_LABELS, CHANNEL_LABELS } from "./order-types";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { maskCPF } from "./print-security";

// -- Helpers --

function formatCurrency(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

function formatCurrencyFromDecimal(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

/** Formato Saipos: sem "R$", virgula decimal -- ex: "67,50" */
function formatValueSaipos(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return "0,00";
  return value.toFixed(2).replace(".", ",");
}

function formatCNPJ(cnpj: string | null | undefined): string {
  if (!cnpj) return "";
  const clean = cnpj.replace(/\D/g, "");
  if (clean.length !== 14) return cnpj;
  return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-${clean.slice(12)}`;
}

function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const clean = phone.replace(/\D/g, "");
  if (clean.length === 11) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
  }
  if (clean.length === 10) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  }
  return phone;
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return format(d, "dd/MMM - HH:mm", { locale: ptBR });
  } catch {
    return "";
  }
}

function getModalityLabel(order: Order): string {
  const label = MODALITY_LABELS[order.modality] || order.modality;
  return label.toUpperCase();
}

// -- Shared sections --

function addStoreHeader(b: EscPosBuilder, data: PrintJobData): void {
  const { company, printSettings } = data;

  if (!printSettings.print_header_enabled) return;

  b.alignLeft();

  if (printSettings.print_header_text) {
    b.textLn(printSettings.print_header_text);
  } else {
    b.textLn(company.name);
  }

  if (company.cnpj) {
    b.textLn(`CNPJ: ${formatCNPJ(company.cnpj)}`);
  }

  const parts: string[] = [];
  if (company.address_street) parts.push(company.address_street);
  if (company.address_number) parts.push(company.address_number);
  if (company.address_neighborhood) parts.push(` - ${company.address_neighborhood}`);
  if (parts.length > 0) {
    b.textLn(parts.join(", ").replace(", -", " -"));
  }
  if (company.address_city && company.address_state) {
    b.textLn(`${company.address_city} - ${company.address_state}`);
  }
}

function addModalityBanner(b: EscPosBuilder, label: string): void {
  b.separator();
  b.alignCenter();
  b.bold(true).doubleSize(true);
  b.textLn(label);
  b.doubleSize(false).bold(false);
}

function addReceiptModalityBanner(b: EscPosBuilder, label: string, orderNumber: number | string): void {
  b.separator();
  b.alignCenter();
  b.bold(true).doubleSize(true);
  b.textLn(`#${orderNumber}  |  ${label}`);
  b.doubleSize(false).bold(false);
  b.newLine();
}

function addKitchenOrderInfo(b: EscPosBuilder, order: Order): void {
  const isIfood = order.channel === "ifood" || order.channel === "IFOOD";

  const hasIfoodData =
    isIfood &&
    (order.external_display_id ||
      order.origin_code ||
      order.delivery_estimate_end ||
      order.ifood_delivered_by ||
      order.ifood_pickup_code);

  if (hasIfoodData) {
    b.separator();
  }

  if (order.external_display_id) {
    b.textLn(`ID do pedido: ${order.external_display_id}`);
  }

  if (order.origin_code) {
    b.textLn(`Localizador: ${order.origin_code}`);
  }

  if (order.delivery_estimate_end) {
    try {
      const eta = format(new Date(order.delivery_estimate_end), "HH:mm", { locale: ptBR });
      b.textLn(`Entrega para as ${eta}`);
    } catch { /* ignore */ }
  }

  if (order.ifood_delivered_by) {
    const deliveryByLabel =
      order.ifood_delivered_by === "MERCHANT"
        ? "Entrega pelo restaurante"
        : "Entrega pelo " + (CHANNEL_LABELS[order.channel] || "app");
    b.textLn(deliveryByLabel);
  }

  if (order.ifood_pickup_code) {
    b.bold(true).textLn(`Codigo retirada: ${order.ifood_pickup_code}`).bold(false);
  }

  if (hasIfoodData) {
    b.separator();
  }

  if (order.scheduled_for) {
    try {
      const schedTime = format(new Date(order.scheduled_for), "dd/MMM HH:mm", { locale: ptBR });
      b.textLn(`Agendado: ${schedTime}`);
    } catch { /* ignore */ }
  }
}

function addKitchenModalityBanner(b: EscPosBuilder, label: string, orderNumber: number | string): void {
  b.separator();
  b.alignCenter();
  b.bold(true).doubleSize(true);
  b.textLn(`#${orderNumber}  |  ${label}`);
  b.doubleSize(false).bold(false);
  b.newLine();
}

function addReceiptOrderInfo(b: EscPosBuilder, order: Order): void {
  const isIfood = order.channel === "ifood" || order.channel === "IFOOD";

  const hasIfoodData =
    isIfood &&
    (order.external_display_id ||
      order.origin_code ||
      order.delivery_estimate_end ||
      order.ifood_delivered_by ||
      order.ifood_pickup_code);

  if (hasIfoodData) {
    b.separator();
  }

  if (order.external_display_id) {
    b.textLn(`ID do pedido: ${order.external_display_id}`);
  }

  if (order.origin_code) {
    b.textLn(`Localizador: ${order.origin_code}`);
  }

  if (order.delivery_estimate_end) {
    try {
      const eta = format(new Date(order.delivery_estimate_end), "HH:mm", { locale: ptBR });
      b.textLn(`Entrega para as ${eta}`);
    } catch { /* ignore */ }
  }

  if (order.ifood_delivered_by) {
    const deliveryByLabel =
      order.ifood_delivered_by === "MERCHANT"
        ? "Entrega pelo restaurante"
        : "Entrega pelo " + (CHANNEL_LABELS[order.channel] || "app");
    b.textLn(deliveryByLabel);
  }

  if (order.ifood_pickup_code) {
    b.bold(true).textLn(`Codigo retirada: ${order.ifood_pickup_code}`).bold(false);
  }

  if (hasIfoodData) {
    b.separator();
  }

  if (order.scheduled_for) {
    try {
      const schedTime = format(new Date(order.scheduled_for), "dd/MMM HH:mm", { locale: ptBR });
      b.textLn(`Agendado: ${schedTime}`);
    } catch { /* ignore */ }
  }
}

function addCompletionForecast(b: EscPosBuilder, order: Order): void {
  if (!order.sla_minutes || !order.arrived_at) return;
  try {
    const arrivedAt = new Date(order.arrived_at);
    if (isNaN(arrivedAt.getTime())) return;
    const deadlineAt = new Date(arrivedAt.getTime() + order.sla_minutes * 60000);
    b.alignRight();
    b.bold(true).textLn(`Previsao: ${format(deadlineAt, "HH:mm", { locale: ptBR })}`).bold(false);
    b.alignLeft();
  } catch { /* ignore */ }
}

function addOrderInfo(b: EscPosBuilder, order: Order, skipOrderNumber = false, skipChannel = false, skipDateTime = false): void {
  if (!skipDateTime) {
    b.alignRight();
    b.textLn(formatDateTime(order.arrived_at || order.created_at));
    b.alignLeft();
  }
  if (!skipOrderNumber) {
    b.text("Pedido: ").bold(true).textLn(`#${order.order_number}`).bold(false);
  }

  if (order.external_display_id) {
    b.textLn(`ID do pedido: ${order.external_display_id}`);
  }

  if (!skipChannel && order.channel && order.channel !== "admin") {
    const channelLabel = CHANNEL_LABELS[order.channel] || order.channel;
    b.textLn(`Canal: ${channelLabel}`);
  }

  if (order.origin_code) {
    b.textLn(`Localizador: ${order.origin_code}`);
  }

  if (order.delivery_estimate_end) {
    try {
      const eta = format(new Date(order.delivery_estimate_end), "HH:mm", { locale: ptBR });
      b.textLn(`Entrega para as ${eta}`);
    } catch { /* ignore */ }
  }

  if (order.ifood_delivered_by) {
    const deliveryByLabel = order.ifood_delivered_by === "MERCHANT"
      ? "Entrega pelo restaurante"
      : "Entrega pelo " + (CHANNEL_LABELS[order.channel] || "app");
    b.textLn(deliveryByLabel);
  }

  if (order.scheduled_for) {
    try {
      const schedTime = format(new Date(order.scheduled_for), "dd/MMM HH:mm", { locale: ptBR });
      b.textLn(`Agendado: ${schedTime}`);
    } catch { /* ignore */ }
  }

  if (order.ifood_pickup_code) {
    b.bold(true).textLn(`Codigo retirada: ${order.ifood_pickup_code}`).bold(false);
  }
}

function addCustomerInfo(b: EscPosBuilder, order: Order, showLabel = false): void {
  if (order.customer?.name) {
    b.textLn(showLabel ? `Cliente: ${order.customer.name}` : order.customer.name);
  }
  if (order.customer?.phone) {
    b.textLn(`Telefone: ${formatPhone(order.customer.phone)}`);
  }
  const totalOrders = (order.customer as any)?.total_orders as number | undefined;
  if (totalOrders && totalOrders > 0) {
    b.textLn(`${totalOrders} pedido${totalOrders === 1 ? "" : "s"} na loja`);
  }
  b.newLine();
}

function addDeliveryAddress(b: EscPosBuilder, order: Order): void {
  const raw = (order as any).order_delivery;
  const delivery = Array.isArray(raw) ? raw[0] : raw;
  if (!delivery?.address_snapshot) return;

  b.separator();

  const addr = delivery.address_snapshot;
  const streetParts = [addr.street, addr.number].filter(Boolean).join(", ");
  const complementPart = addr.complement ? `, ${addr.complement}` : "";
  if (streetParts) b.textLn(`${streetParts}${complementPart}`);
  if (addr.neighborhood) b.textLn(`- ${addr.neighborhood}`);
  if (addr.reference) {
    b.textLn(`Ref: ${addr.reference}`);
  }

  b.separator();
}

function addDeliveryAddressReceipt(b: EscPosBuilder, order: Order): void {
  const raw = (order as any).order_delivery;
  const delivery = Array.isArray(raw) ? raw[0] : raw;
  if (!delivery?.address_snapshot) return;

  b.separator();

  const addr = delivery.address_snapshot;
  const streetParts = [addr.street, addr.number].filter(Boolean).join(", ");
  if (streetParts) b.textLn(`Endereco: ${streetParts}`);
  if (addr.complement) b.textLn(`Complemento: ${addr.complement}`);
  if (addr.neighborhood) b.textLn(`Bairro: ${addr.neighborhood}`);
  if (addr.reference) b.textLn(`Referencia: ${addr.reference}`);

  b.separator();
}

function addDeliveryAddressKitchen(b: EscPosBuilder, order: Order): void {
  const raw = (order as any).order_delivery;
  const delivery = Array.isArray(raw) ? raw[0] : raw;
  if (!delivery?.address_snapshot) return;

  const addr = delivery.address_snapshot;
  const streetParts = [addr.street, addr.number].filter(Boolean).join(", ");
  if (streetParts) b.textLn(`Endereco: ${streetParts}`);
  if (addr.complement) b.textLn(`Complemento: ${addr.complement}`);
  if (addr.neighborhood) b.textLn(`Bairro: ${addr.neighborhood}`);
  if (addr.reference) b.textLn(`Referencia: ${addr.reference}`);
}

function addNotes(b: EscPosBuilder, order: Order): void {
  if (!order.notes) return;
  b.separator();
  b.bold(true);
  b.textLn(`Obs: ${order.notes}`);
  b.bold(false);
}

function addItemsHeader(b: EscPosBuilder): void {
  b.separator();
  b.bold(true).textLn("ITENS").bold(false);
  b.separator();
}

function addItemsWithValues(
  b: EscPosBuilder,
  items: OrderItem[],
  showComplementName = false,
  showOptionDescription = false
): void {
  if (!items || !Array.isArray(items) || items.length === 0) {
    b.textLn("Nenhum item");
    return;
  }

  for (let idx = 0; idx < items.length; idx++) {
    try {
      const item = items[idx];
      if (!item || !item.product_name_snapshot) {
        continue;
      }

      const qty = `${item.quantity ?? 1}`;
      const value = formatValueSaipos(item.total_price);
      b.bold(true).doubleStrike(true).doubleHeight(true);
      b.threeColumns(qty, item.product_name_snapshot, value);
      b.doubleHeight(false).doubleStrike(false).bold(false);

      if (item.order_item_complements && item.order_item_complements.length > 0) {
        if (showComplementName) {
          const seenGroups = new Set<string>();
          const groups: string[] = [];
          for (const comp of item.order_item_complements) {
            if (!comp?.name_snapshot) continue;
            const groupName = comp.name_snapshot.includes(": ")
              ? comp.name_snapshot.split(": ")[0]
              : "";
            if (groupName && !seenGroups.has(groupName)) {
              seenGroups.add(groupName);
              groups.push(groupName);
            }
          }
          if (groups.length > 0) {
            for (const groupName of groups) {
              b.indented("  ", `${groupName}:`);
              for (const comp of item.order_item_complements) {
                if (!comp?.name_snapshot) continue;
                const compGroup = comp.name_snapshot.includes(": ")
                  ? comp.name_snapshot.split(": ")[0]
                  : "";
                if (compGroup === groupName) {
                  const optName = comp.name_snapshot.split(": ").slice(1).join(": ");
                  const compQty = `${comp.quantity || 1}x `;
                  b.indented("    ", `${compQty}${optName}`);
                  if (showOptionDescription && comp.description_snapshot) {
                    b.indented("       ", `- ${comp.description_snapshot}`);
                  }
                }
              }
            }
          } else {
            for (const comp of item.order_item_complements) {
              if (!comp?.name_snapshot) continue;
              const compQty = `${comp.quantity || 1}x `;
              b.indented("  ", `${compQty}${comp.name_snapshot}`);
              if (showOptionDescription && comp.description_snapshot) {
                b.indented("     ", `- ${comp.description_snapshot}`);
              }
            }
          }
        } else {
          for (const comp of item.order_item_complements) {
            if (!comp?.name_snapshot) continue;
            const compQty = `${comp.quantity || 1}x `;
            const displayName = comp.name_snapshot.includes(": ")
              ? comp.name_snapshot.split(": ").slice(1).join(": ")
              : comp.name_snapshot;
            b.indented("  ", `${compQty}${displayName}`);
            if (showOptionDescription && comp.description_snapshot) {
              b.indented("     ", `- ${comp.description_snapshot}`);
            }
          }
        }
      }

      if (item.order_item_options && item.order_item_options.length > 0) {
        for (const opt of item.order_item_options) {
          if (!opt?.item_name_snapshot) continue;
          const optPrice = (opt.price_delta ?? 0) > 0 ? ` +${formatValueSaipos(opt.price_delta)}` : "";
          b.indented("  ", `${opt.group_name_snapshot ?? ""}: ${opt.item_name_snapshot}${optPrice}`);
        }
      }

      if (item.notes) {
        b.bold(true);
        b.indented("  * ", `OBS: ${item.notes}`);
        b.bold(false);
      }

      if (idx < items.length - 1) {
        b.newLine();
      }
    } catch (err) {
      console.error(`[Receipt] Erro ao processar item ${idx}:`, err);
    }
  }
}

function addItemsWithoutValues(b: EscPosBuilder, items: OrderItem[], showComplementName = false, showOptionDescription = false): void {
  if (!items || !Array.isArray(items) || items.length === 0) {
    b.separator();
    b.bold(true).textLn("ITENS").bold(false);
    b.separator();
    b.textLn("Nenhum item");
    return;
  }

  b.separator();
  b.bold(true).textLn("ITENS").bold(false);
  b.separator();

  for (let idx = 0; idx < items.length; idx++) {
    try {
      const item = items[idx];
      if (!item || !item.product_name_snapshot) {
        continue;
      }

      b.bold(true).doubleStrike(true).doubleHeight(true).textLn(`${item.quantity ?? 1}  ${item.product_name_snapshot}`).doubleHeight(false).doubleStrike(false).bold(false);

      const hasComplements = Array.isArray(item.order_item_complements) && item.order_item_complements.length > 0;
      const hasOptions = Array.isArray(item.order_item_options) && item.order_item_options.length > 0;

      if (showComplementName) {
        if (hasComplements) {
          const seenGroups = new Set<string>();
          const groups: string[] = [];
          for (const comp of item.order_item_complements!) {
            if (!comp?.name_snapshot) continue;
            const groupName = comp.name_snapshot.includes(": ")
              ? comp.name_snapshot.split(": ")[0]
              : "";
            if (groupName && !seenGroups.has(groupName)) {
              seenGroups.add(groupName);
              groups.push(groupName);
            }
          }
          if (groups.length > 0) {
            for (const groupName of groups) {
              b.indented("  ", `${groupName}:`);
              for (const comp of item.order_item_complements!) {
                if (!comp?.name_snapshot) continue;
                const compGroup = comp.name_snapshot.includes(": ")
                  ? comp.name_snapshot.split(": ")[0]
                  : "";
                if (compGroup === groupName) {
                  const optName = comp.name_snapshot.split(": ").slice(1).join(": ");
                  b.indented("    ", `${comp.quantity ?? 1}x ${optName}`);
                  if (showOptionDescription && comp.description_snapshot) {
                    b.indented("       ", `- ${comp.description_snapshot}`);
                  }
                }
              }
            }
          } else {
            for (const comp of item.order_item_complements!) {
              if (comp?.name_snapshot) {
                b.indented("  ", `${comp.quantity ?? 1}x ${comp.name_snapshot}`);
                if (showOptionDescription && comp.description_snapshot) {
                  b.indented("     ", `- ${comp.description_snapshot}`);
                }
              }
            }
          }
        }
      } else {
        if (hasOptions) {
          for (const opt of item.order_item_options!) {
            if (opt && opt.item_name_snapshot) {
              b.indented("  ", opt.item_name_snapshot);
            }
          }
        }
        if (hasComplements) {
          for (const comp of item.order_item_complements!) {
            if (comp && comp.name_snapshot) {
              const displayName = comp.name_snapshot.includes(": ")
                ? comp.name_snapshot.split(": ").slice(1).join(": ")
                : comp.name_snapshot;
              b.indented("  ", `${comp.quantity ?? 1}x ${displayName}`);
              if (showOptionDescription && comp.description_snapshot) {
                b.indented("     ", `- ${comp.description_snapshot}`);
              }
            }
          }
        }
      }

      if (item.notes) {
        b.bold(true);
        b.indented("  * ", `OBS: ${item.notes}`);
        b.bold(false);
      }

      if (idx < items.length - 1) {
        b.newLine();
      }
    } catch (err) {
      console.error(`[Receipt] Erro ao processar item ${idx}:`, err);
    }
  }
}

function addTotals(b: EscPosBuilder, order: Order, paperWidth: number = 48): void {
  b.separator();

  const totalItems = order.order_items?.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
  b.columns("Quantidade de itens:", `${totalItems}`);

  b.separator();

  b.columns("Subtotal", formatValueSaipos(order.subtotal));

  if ((order.delivery_fee ?? 0) > 0) {
    b.columns("Taxa de entrega(+)", formatValueSaipos(order.delivery_fee));
  }

  if ((order.discount ?? 0) > 0) {
    b.columns("Desconto(-)", formatValueSaipos(order.discount));
  }

  if ((order.cashback_used ?? 0) > 0) {
    b.columns("Cashback(-)", formatValueSaipos(order.cashback_used));
  }

  if ((order.additional_fee ?? 0) > 0) {
    b.columns("Taxa adicional(+)", formatValueSaipos(order.additional_fee));
  }

  b.separator();
  b.bold(true);
  const totalLabel = "TOTAL";
  const totalValue = formatValueSaipos(order.total);
  const totalGap = Math.max(1, paperWidth - totalLabel.length - totalValue.length);
  b.textLn(totalLabel + " ".repeat(totalGap) + totalValue);
  b.bold(false);
}

function addPayment(b: EscPosBuilder, order: Order): void {
  b.separator();
  b.bold(true).textLn("PAGAMENTOS").bold(false);
  b.separator();

  const hasPayments = Array.isArray(order.order_payments) && order.order_payments.length > 0;
  const totalPago = hasPayments
    ? order.order_payments!.reduce((sum, p) => sum + (p.amount ?? 0), 0)
    : 0;
  const totalPedido = order.total ?? 0;
  const faltaPagar = Math.max(0, totalPedido - totalPago);

  if (hasPayments) {
    b.bold(true);
    b.columns("Total", formatValueSaipos(totalPedido));
    b.bold(false);

    b.columns("Pago", formatValueSaipos(totalPago));

    if (faltaPagar > 0) {
      b.bold(true);
      b.columns("Falta pagar", formatValueSaipos(faltaPagar));
      b.bold(false);
    }

    b.separator();
    b.textLn("PAGAMENTOS ADICIONADOS");
    for (const pay of order.order_payments!) {
      const methodLabel =
        PAYMENT_METHOD_LABELS[pay.method as keyof typeof PAYMENT_METHOD_LABELS] ||
        pay.label ||
        pay.method;
      const extra =
        pay.observation
          ? ` — ${pay.observation}`
          : pay.label && pay.label !== pay.method && pay.label !== methodLabel
          ? ` — ${pay.label}`
          : "";
      b.textLn(`${methodLabel}${extra} — Pago: ${formatValueSaipos(pay.amount)}`);
    }
  } else {
    const methodLabel =
      PAYMENT_METHOD_LABELS[order.payment_method as keyof typeof PAYMENT_METHOD_LABELS] ||
      order.payment_method;
    b.bold(true).textLn(`Pendente — ${methodLabel}`).bold(false);
  }

  if (order.change_for && order.change_for > 0) {
    const isPaid = order.payment_status === "PAGO";
    const changeForLabel = isPaid ? "- Recebeu:" : "- Receber:";
    b.columns(changeForLabel, formatValueSaipos(order.change_for));
    const troco = order.change_for - totalPedido;
    if (troco > 0) {
      b.columns("- Troco:", formatValueSaipos(troco));
    }
  }

  if (order.payment_label?.toLowerCase().includes("fiado")) {
    b.newLine();
    b.bold(true).textLn("** VENDA FIADO **").bold(false);
  }

  if (order.cpf_invoice) {
    const maskedCPF = maskCPF(order.cpf_invoice);
    if (maskedCPF) {
      b.textLn(`CPF: ${maskedCPF}`);
    }
  }
}

function addOperatorInfo(b: EscPosBuilder, order: Order, _operatorName?: string | null): void {
  b.separator();

  if (order.channel) {
    const channelLabel = CHANNEL_LABELS[order.channel] || order.channel;
    b.textLn(`Canal: ${channelLabel}`);
  }
}

function addSignatureLine(b: EscPosBuilder): void {
  b.newLine(2);
  b.alignCenter();
  b.textLn("_".repeat(30));
  b.textLn("Assinatura do cliente");
  b.alignLeft();
}

function addFooter(b: EscPosBuilder, data: PrintJobData, order: Order): void {
  addOperatorInfo(b, order, data.operatorName);

  if (data.printSettings.print_footer_text) {
    b.separator();
    b.alignCenter();
    b.bold(true);
    b.wrappedText(data.printSettings.print_footer_text);
    b.bold(false);
    b.alignLeft();
  }

  addSignatureLine(b);
}

function addKitchenFooter(b: EscPosBuilder, data: PrintJobData, order: Order): void {
  b.separator();

  if (order.channel) {
    const channelLabel = CHANNEL_LABELS[order.channel] || order.channel;
    b.textLn(`Canal: ${channelLabel}`);
  }

  const printedAt = format(new Date(), "dd/MMM/yyyy HH:mm", { locale: ptBR });
  b.textLn(`Impresso: ${printedAt}`);

  if (data.printSettings.print_footer_text) {
    b.separator();
    b.alignCenter();
    b.bold(true);
    b.wrappedText(data.printSettings.print_footer_text);
    b.bold(false);
    b.alignLeft();
  }
}

function addCutAndFeed(b: EscPosBuilder): void {
  b.newLine(3);
  b.cut();
}

// -- Template: Delivery --

export function buildDeliveryReceipt(data: PrintJobData): string {
  const b = new EscPosBuilder(data.paperWidth);
  const { order } = data;

  addStoreHeader(b, data);
  addReceiptModalityBanner(b, "DELIVERY", order.order_number);
  addReceiptOrderInfo(b, order);
  b.alignRight();
  b.textLn(formatDateTime(order.arrived_at || order.created_at));
  b.alignLeft();
  addCompletionForecast(b, order);
  addCustomerInfo(b, order, true);
  addDeliveryAddressKitchen(b, order);
  addNotes(b, order);
  addItemsHeader(b);
  addItemsWithValues(
    b,
    order.order_items ?? [],
    data.printSettings.print_show_complement_name ?? false,
    data.printSettings.print_show_option_description ?? false
  );
  addTotals(b, order, data.paperWidth);
  addPayment(b, order);
  addFooter(b, data, order);
  addCutAndFeed(b);

  return b.buildBase64();
}

// -- Template: Mesa --

export function buildTableReceipt(data: PrintJobData): string {
  const b = new EscPosBuilder(data.paperWidth);
  const { order } = data;

  addStoreHeader(b, data);

  const tableName = order.tab?.tables?.name ?? "Mesa";
  addReceiptModalityBanner(b, tableName.toUpperCase(), order.order_number);

  addReceiptOrderInfo(b, order);
  b.alignRight();
  b.textLn(formatDateTime(order.arrived_at || order.created_at));
  b.alignLeft();
  addCompletionForecast(b, order);
  addCustomerInfo(b, order, true);
  addNotes(b, order);
  addItemsHeader(b);
  addItemsWithValues(
    b,
    order.order_items ?? [],
    data.printSettings.print_show_complement_name ?? false,
    data.printSettings.print_show_option_description ?? false
  );
  addTotals(b, order, data.paperWidth);
  addPayment(b, order);
  addFooter(b, data, order);
  addCutAndFeed(b);

  return b.buildBase64();
}

// -- Template: Balcao (Consumo no local) --

export function buildDineInReceipt(data: PrintJobData): string {
  const b = new EscPosBuilder(data.paperWidth);
  const { order } = data;

  addStoreHeader(b, data);
  addReceiptModalityBanner(b, "CONSUMO", order.order_number);
  addReceiptOrderInfo(b, order);
  b.alignRight();
  b.textLn(formatDateTime(order.arrived_at || order.created_at));
  b.alignLeft();
  addCompletionForecast(b, order);
  addCustomerInfo(b, order, true);
  addNotes(b, order);
  addItemsHeader(b);
  addItemsWithValues(
    b,
    order.order_items ?? [],
    data.printSettings.print_show_complement_name ?? false,
    data.printSettings.print_show_option_description ?? false
  );
  addTotals(b, order, data.paperWidth);
  addPayment(b, order);
  addFooter(b, data, order);
  addCutAndFeed(b);

  return b.buildBase64();
}

// -- Template: Retirada --

export function buildTakeoutReceipt(data: PrintJobData): string {
  const b = new EscPosBuilder(data.paperWidth);
  const { order } = data;

  addStoreHeader(b, data);
  addReceiptModalityBanner(b, "RETIRADA", order.order_number);
  addReceiptOrderInfo(b, order);
  b.alignRight();
  b.textLn(formatDateTime(order.arrived_at || order.created_at));
  b.alignLeft();
  addCompletionForecast(b, order);
  addCustomerInfo(b, order, true);
  addNotes(b, order);
  addItemsHeader(b);
  addItemsWithValues(
    b,
    order.order_items ?? [],
    data.printSettings.print_show_complement_name ?? false,
    data.printSettings.print_show_option_description ?? false
  );
  addTotals(b, order, data.paperWidth);
  addPayment(b, order);
  addFooter(b, data, order);
  addCutAndFeed(b);

  return b.buildBase64();
}

// -- Template: Comanda de Cozinha --

export function buildKitchenReceipt(data: PrintJobData): string {
  try {
    const b = new EscPosBuilder(data.paperWidth);
    const { order } = data;

    if (!order) {
      throw new Error("[Kitchen] Pedido nao definido em PrintJobData");
    }

    addStoreHeader(b, data);
    addKitchenModalityBanner(b, getModalityLabel(order), order.order_number);
    addKitchenOrderInfo(b, order);

    b.alignRight();
    b.textLn(formatDateTime(order.arrived_at || order.created_at));
    b.alignLeft();
    addCompletionForecast(b, order);
    addCustomerInfo(b, order, true);
    addDeliveryAddressKitchen(b, order);
    addNotes(b, order);

    addItemsWithoutValues(
      b,
      order.order_items ?? [],
      data.printSettings.print_show_complement_name ?? false,
      data.printSettings.print_show_option_description ?? false
    );

    const totalQty = (order.order_items ?? []).reduce((sum, i) => sum + (i.quantity ?? 1), 0);
    b.separator();
    b.columns("Quantidade de itens:", `${totalQty}`);

    addKitchenFooter(b, data, order);
    addCutAndFeed(b);

    return b.buildBase64();
  } catch (err) {
    console.error("[Kitchen Receipt Error]", err);
    const b = new EscPosBuilder(data.paperWidth);
    b.textLn("ERRO AO GERAR COMANDA");
    b.textLn(`Pedido: #${data.order?.order_number || "?"}`);
    b.textLn("Verifique logs para detalhes");
    b.newLine(2);
    b.cut();
    return b.buildBase64();
  }
}

// -- Template Router --

const TEMPLATE_MAP: Record<string, (data: PrintJobData) => string> = {
  delivery: buildDeliveryReceipt,
  mesa: buildTableReceipt,
  balcao: buildDineInReceipt,
  retirada: buildTakeoutReceipt,
  cozinha: buildKitchenReceipt,
};

/**
 * Gera recibo ESC/POS base64 para o tipo especificado.
 */
export function buildReceipt(data: PrintJobData): string {
  const builder = TEMPLATE_MAP[data.receiptType];
  if (!builder) {
    throw new Error(`Template de recibo desconhecido: ${data.receiptType}`);
  }
  return builder(data);
}
