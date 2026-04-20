// ============================================================
// Store Data — Fetch & cache store_settings + company_profile
// Needed by order-listener to build receipts autonomously
// ============================================================

import { getSupabase } from "./supabase";
import store from "./store";
import type { PrintSettings, CompanyProfile } from "./printing/types";

let cachedPrintSettings: PrintSettings | null = null;
let cachedCompanyProfile: CompanyProfile | null = null;
let cachedAutoAcceptDelivery = false;
let cachedAutoAcceptTable = false;
let refreshTimer: NodeJS.Timeout | null = null;

const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  print_header_enabled: true,
  print_header_text: null,
  print_footer_text: null,
  print_paper_width: 48,
  print_font_size: 11,
  print_show_complement_name: false,
  print_show_option_description: false,
};

/**
 * Fetch store_settings and company_profile from Supabase.
 * Caches both in memory for fast access by order-listener.
 */
export async function refreshStoreData(): Promise<void> {
  const storeId = store.get("storeId");
  if (!storeId) {
    console.error("[StoreData] No store_id configured");
    return;
  }

  const supabase = getSupabase();

  // Fetch store_settings (print settings + auto_accept flags)
  try {
    const { data: settings, error: settingsError } = await supabase
      .from("store_settings")
      .select(
        "print_header_enabled, print_header_text, print_footer_text, " +
        "print_paper_width, print_font_size, print_show_complement_name, " +
        "print_show_option_description, auto_accept_delivery, auto_accept_table"
      )
      .eq("store_id", storeId)
      .single();

    if (settingsError) {
      console.error("[StoreData] Error fetching store_settings:", settingsError.message);
    } else if (settings) {
      cachedPrintSettings = {
        print_header_enabled: (settings as any).print_header_enabled ?? true,
        print_header_text: (settings as any).print_header_text ?? null,
        print_footer_text: (settings as any).print_footer_text ?? null,
        print_paper_width: (settings as any).print_paper_width ?? 48,
        print_font_size: (settings as any).print_font_size ?? 11,
        print_show_complement_name: (settings as any).print_show_complement_name ?? false,
        print_show_option_description: (settings as any).print_show_option_description ?? false,
      };
      cachedAutoAcceptDelivery = (settings as any).auto_accept_delivery ?? false;
      cachedAutoAcceptTable = (settings as any).auto_accept_table ?? false;
      console.log(
        `[StoreData] Settings loaded: auto_accept_delivery=${cachedAutoAcceptDelivery}, auto_accept_table=${cachedAutoAcceptTable}`
      );
    }
  } catch (err) {
    console.error("[StoreData] Error fetching store_settings:", err);
  }

  // Fetch company_profile (store header info for receipts)
  try {
    const { data: company, error: companyError } = await supabase
      .from("company_profile")
      .select(
        "name, cnpj, contact_phone, address_street, address_number, " +
        "address_neighborhood, address_city, address_state"
      )
      .eq("store_id", storeId)
      .single();

    if (companyError) {
      console.error("[StoreData] Error fetching company_profile:", companyError.message);
    } else if (company) {
      cachedCompanyProfile = company as unknown as CompanyProfile;
      console.log(`[StoreData] Company profile loaded: ${cachedCompanyProfile.name}`);
    }
  } catch (err) {
    console.error("[StoreData] Error fetching company_profile:", err);
  }
}

/**
 * Start periodic refresh of store data (every 5 minutes).
 */
export function startStoreDataRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  refreshTimer = setInterval(refreshStoreData, 5 * 60 * 1000);
}

/**
 * Stop periodic refresh.
 */
export function stopStoreDataRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Get cached print settings.
 */
export function getPrintSettings(): PrintSettings {
  return cachedPrintSettings || DEFAULT_PRINT_SETTINGS;
}

/**
 * Get cached company profile.
 */
export function getCompanyProfile(): CompanyProfile | null {
  return cachedCompanyProfile;
}

/**
 * Check if auto-accept is enabled for a modality.
 */
export function shouldAutoAccept(modality: string): boolean {
  const isDeliveryLike =
    modality === "ENTREGA" ||
    modality === "RETIRADA" ||
    modality === "BALCAO";
  const isTable = modality === "MESA";

  if (isDeliveryLike && cachedAutoAcceptDelivery) return true;
  if (isTable && cachedAutoAcceptTable) return true;
  return false;
}

/**
 * Check if store data has been loaded (both settings and company).
 */
export function isStoreDataReady(): boolean {
  return cachedPrintSettings !== null && cachedCompanyProfile !== null;
}
