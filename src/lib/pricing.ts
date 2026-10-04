import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { businessSettings } from "@/db/schema";
import { encryptSecret, safeDecrypt } from "@/lib/crypto";
import { optionalServices } from "@/lib/vehicles";
import type { ServiceSelection } from "@/lib/vehicles";

const SETTINGS_ID = "default";

/** Custo base em centavos por serviço APIBrasil (valores do catálogo real). */
export const SERVICE_COST_CENTS: Record<string, number> = {
  basic: 2, // agregados-simples
  fipe: 6, // tabela-fipe
  multas: 345, // renainf
  roubo: 386, // roubo-furto
  leilao: 2112, // leilao-v2
  recall: 62, // recall
  gravame: 271, // gravame
  csv: 400, // csv-renainf-renajud-bin-proprietario
  debitos: 1200, // consultar-debitos-boleto
  crlv: 1400, // documento-crlv-pa
  score: 34, // acerta-essencial-positivo
};

export interface PriceBreakdown {
  costCents: number;
  markupCents: number;
  fixedFeeCents: number;
  totalCents: number;
  markupPercent: number;
  appliedMinimum: boolean;
}

export interface ResolvedBusinessSettings {
  key: string;
  markupPercent: string;
  fixedFeeCents: number;
  minimumChargeCents: number;
  freeLookupEnabled: boolean;
  pixProvider: string;
  pixKeyType: string;
  pixKey: string;
  mpAccessToken: string;
  mpWebhookSecret: string;
  merchantName: string;
  merchantCity: string;
  updatedAt: Date;
}

export async function getBusinessSettingsRow() {
  try {
    const [row] = await db
      .select()
      .from(businessSettings)
      .where(eq(businessSettings.key, SETTINGS_ID))
      .limit(1);
    return row ?? null;
  } catch {
    // Banco indisponível: retorna null e a UI mostra estado "não configurado"
    return null;
  }
}

export async function getBusinessSettings(): Promise<ResolvedBusinessSettings | null> {
  const row = await getBusinessSettingsRow();
  if (!row) return null;
  return {
    key: row.key,
    markupPercent: row.markupPercent,
    fixedFeeCents: row.fixedFeeCents,
    minimumChargeCents: row.minimumChargeCents,
    freeLookupEnabled: row.freeLookupEnabled,
    pixProvider: row.pixProvider,
    pixKeyType: row.pixKeyType,
    pixKey: row.pixKey,
    mpAccessToken: safeDecrypt(row.mpAccessToken),
    mpWebhookSecret: safeDecrypt(row.mpWebhookSecret),
    merchantName: row.merchantName,
    merchantCity: row.merchantCity,
    updatedAt: row.updatedAt,
  };
}

export async function saveBusinessSettings(input: {
  markupPercent?: unknown;
  fixedFeeCents?: unknown;
  minimumChargeCents?: unknown;
  freeLookupEnabled?: unknown;
  pixProvider?: unknown;
  pixKeyType?: unknown;
  pixKey?: unknown;
  mpAccessToken?: unknown;
  mpWebhookSecret?: unknown;
  merchantName?: unknown;
  merchantCity?: unknown;
}) {
  const row = await getBusinessSettingsRow();

  const markupPercent = clampNumber(input.markupPercent, row?.markupPercent ?? "40", 0, 900);
  const fixedFeeCents = clampInt(input.fixedFeeCents, row?.fixedFeeCents ?? 0, 0, 100_000);
  const minimumChargeCents = clampInt(
    input.minimumChargeCents,
    row?.minimumChargeCents ?? 199,
    0,
    100_000,
  );
  const freeLookupEnabled =
    typeof input.freeLookupEnabled === "boolean"
      ? input.freeLookupEnabled
      : row?.freeLookupEnabled ?? true;
  const pixProvider = str(input.pixProvider, row?.pixProvider ?? "manual", 32);
  const pixKeyType = (
    ["cpf", "cnpj", "email", "phone", "random"].includes(String(input.pixKeyType))
      ? input.pixKeyType
      : row?.pixKeyType ?? "random"
  ) as "cpf" | "cnpj" | "email" | "phone" | "random";
  const pixKey = str(input.pixKey, row?.pixKey ?? "", 160);
  const merchantName = str(input.merchantName, row?.merchantName ?? "ARCA CONSULTAS", 120);
  const merchantCity = str(input.merchantCity, row?.merchantCity ?? "SAO PAULO", 80);

  // Token do Mercado Pago: só substitui se um novo valor for enviado.
  const mpTokenInput = typeof input.mpAccessToken === "string" ? input.mpAccessToken.trim() : "";
  if (mpTokenInput && mpTokenInput.length > 4_000) {
    throw new Error("Access Token do Mercado Pago muito longo.");
  }
  const mpAccessToken = mpTokenInput ? encryptSecret(mpTokenInput) : row?.mpAccessToken ?? null;

  const mpSecretInput = typeof input.mpWebhookSecret === "string" ? input.mpWebhookSecret.trim() : "";
  if (mpSecretInput && mpSecretInput.length > 400) {
    throw new Error("Segredo do webhook muito longo.");
  }
  const mpWebhookSecret = mpSecretInput ? encryptSecret(mpSecretInput) : row?.mpWebhookSecret ?? null;

  const now = new Date();
  await db
    .insert(businessSettings)
    .values({
      key: SETTINGS_ID,
      markupPercent,
      fixedFeeCents,
      minimumChargeCents,
      freeLookupEnabled,
      pixProvider,
      pixKeyType,
      pixKey,
      mpAccessToken,
      mpWebhookSecret,
      merchantName,
      merchantCity,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: businessSettings.key,
      set: {
        markupPercent,
        fixedFeeCents,
        minimumChargeCents,
        freeLookupEnabled,
        pixProvider,
        pixKeyType,
        pixKey,
        mpAccessToken,
        mpWebhookSecret,
        merchantName,
        merchantCity,
        updatedAt: now,
      },
    });

  return getBusinessSettings();
}

/** Calcula o preço final cobrado do cliente com base no custo APIBrasil + markup. */
export async function calculatePrice(services: ServiceSelection): Promise<PriceBreakdown> {
  const settings = await getBusinessSettingsRow();
  const markupPercent = Number(settings?.markupPercent ?? "40");
  const fixedFeeCents = settings?.fixedFeeCents ?? 0;
  const minimumChargeCents = settings?.minimumChargeCents ?? 199;

  let costCents = 0;
  for (const service of optionalServices) {
    if (services[service]) costCents += SERVICE_COST_CENTS[service] ?? 0;
  }

  const markupCents = Math.round((costCents * markupPercent) / 100);
  let totalCents = costCents + markupCents + fixedFeeCents;
  const appliedMinimum = totalCents < minimumChargeCents;
  if (appliedMinimum) totalCents = minimumChargeCents;

  return {
    costCents,
    markupCents,
    fixedFeeCents,
    totalCents,
    markupPercent,
    appliedMinimum,
  };
}

function clampNumber(value: unknown, fallback: string, min: number, max: number): string {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return String(Math.min(max, Math.max(min, parsed)));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.trunc(parsed);
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function str(value: unknown, fallback: string, max: number): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}
