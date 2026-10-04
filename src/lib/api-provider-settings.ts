import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  apiProviderSettings,
  defaultApiEndpointPaths,
  defaultApiPayloadMapping,
  type ApiEndpointPaths,
  type ApiPayloadMapping,
} from "@/db/schema";
import { ApiBrasil } from "apigratis-sdk-nodejs";

const SETTINGS_ID = "default";
const OFFICIAL_GATEWAY_HOST = "gateway.apibrasil.io";

export interface ApiBrasilConfig {
  bearer: string;
  device: string;
  baseUrl: string;
  endpoints: ApiEndpointPaths;
  payloadMapping: ApiPayloadMapping;
  stored: boolean;
}

export interface SafeApiBrasilSettings {
  configured: boolean;
  adminConfigured: boolean;
  hasBearer: boolean;
  hasDevice: boolean;
  baseUrl: string;
  endpoints: ApiEndpointPaths;
  payloadMapping: ApiPayloadMapping;
  updatedAt: string | null;
  source: "database" | "environment" | "none";
  accountBalance?: string | null;
  accountMessage?: string | null;
  accountError?: string | null;
}

export class ApiSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiSettingsError";
  }
}

export async function getApiBrasilConfig(): Promise<ApiBrasilConfig> {
  const [row] = await db
    .select()
    .from(apiProviderSettings)
    .where(eq(apiProviderSettings.key, SETTINGS_ID))
    .limit(1);

  const envBearer = (
    process.env.APIBRASIL_BEARER_TOKEN || process.env.APIBRASIL_BEARER || ""
  ).trim();
  const envDevice = (
    process.env.APIBRASIL_DEVICE_TOKEN || process.env.APIBRASIL_DEVICE || ""
  ).trim();
  let bearer = envBearer;
  let device = envDevice;

  if (row?.encryptedBearer) {
    try {
      bearer = decryptSecret(row.encryptedBearer);
    } catch {
      bearer = envBearer;
    }
  }
  if (row?.encryptedDevice) {
    try {
      device = decryptSecret(row.encryptedDevice);
    } catch {
      device = envDevice;
    }
  }

  return {
    bearer,
    device,
    baseUrl: (row?.baseUrl || process.env.APIBRASIL_BASE_URL || "https://gateway.apibrasil.io/api/v2").replace(/\/$/, ""),
    endpoints: { ...defaultApiEndpointPaths, ...(row?.endpoints ?? {}) },
    payloadMapping: { ...defaultApiPayloadMapping, ...(row?.payloadMapping ?? {}) },
    stored: Boolean(row),
  };
}

export async function getSafeApiBrasilSettings(): Promise<SafeApiBrasilSettings> {
  const [row] = await db
    .select()
    .from(apiProviderSettings)
    .where(eq(apiProviderSettings.key, SETTINGS_ID))
    .limit(1);

  const config = await getApiBrasilConfig();
  const hasBearer = Boolean(config.bearer);
  const hasDevice = Boolean(config.device);
  const envConfigured = Boolean(
    (process.env.APIBRASIL_BEARER_TOKEN || process.env.APIBRASIL_BEARER)?.trim(),
  );

  let accountBalance: string | null = null;
  let accountMessage: string | null = null;
  let accountError: string | null = null;

  if (hasBearer) {
    try {
      const sdk = new ApiBrasil({
        bearerToken: config.bearer,
        baseURL: config.baseUrl,
      });
      const bal = await sdk.account.balance();
      accountBalance = bal.balance_available_formatted || (bal.balance ? `R$ ${bal.balance}` : null);
      accountMessage = bal.message || null;
    } catch (e: unknown) {
      accountError = e instanceof Error ? e.message : "Não foi possível verificar o saldo no momento.";
    }
  }

  const envPasswordRequired = Boolean(process.env.ARCA_SETTINGS_PASSWORD?.trim());

  return {
    configured: hasBearer,
    adminConfigured: envPasswordRequired || Boolean(row?.adminPasswordHash),
    hasBearer,
    hasDevice,
    baseUrl: config.baseUrl,
    endpoints: config.endpoints,
    payloadMapping: config.payloadMapping,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    source: row ? "database" : envConfigured ? "environment" : "none",
    accountBalance,
    accountMessage,
    accountError,
  };
}

async function getSettingsAdminPasswordHash(): Promise<string | null> {
  const [row] = await db
    .select({ passwordHash: apiProviderSettings.adminPasswordHash })
    .from(apiProviderSettings)
    .where(eq(apiProviderSettings.key, SETTINGS_ID))
    .limit(1);
  return row?.passwordHash ?? null;
}

export async function initializeSettingsAdminPassword(password: unknown): Promise<void> {
  if (process.env.ARCA_SETTINGS_PASSWORD?.trim()) return;
  if (typeof password !== "string" || password.length < 12 || password.length > 256) {
    throw new ApiSettingsError("Crie uma senha administrativa com pelo menos 12 caracteres.");
  }

  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  const encodedHash = `scrypt:${salt}:${digest}`;
  const [existing] = await db
    .select({ key: apiProviderSettings.key, passwordHash: apiProviderSettings.adminPasswordHash })
    .from(apiProviderSettings)
    .where(eq(apiProviderSettings.key, SETTINGS_ID))
    .limit(1);

  if (existing?.passwordHash) {
    throw new ApiSettingsError("A senha mestra já foi definida; informe a senha existente.");
  }
  if (existing) {
    await db.update(apiProviderSettings)
      .set({ adminPasswordHash: encodedHash, updatedAt: new Date() })
      .where(and(eq(apiProviderSettings.key, SETTINGS_ID), isNull(apiProviderSettings.adminPasswordHash)));
  } else {
    await db.insert(apiProviderSettings).values({
      key: SETTINGS_ID,
      encryptedBearer: null,
      encryptedDevice: null,
      adminPasswordHash: encodedHash,
      baseUrl: "https://gateway.apibrasil.io/api/v2",
      endpoints: defaultApiEndpointPaths,
      payloadMapping: defaultApiPayloadMapping,
    }).onConflictDoNothing();
  }

  const savedHash = await getSettingsAdminPasswordHash();
  if (!savedHash || !timingSafeTextEqual(savedHash, encodedHash)) {
    throw new ApiSettingsError("A senha mestra já foi inicializada em outro acesso. Recarregue a página e informe-a.");
  }
}

export async function verifySettingsAdminPassword(password: unknown): Promise<boolean> {
  if (typeof password !== "string" || !password) return false;
  const environmentPassword = process.env.ARCA_SETTINGS_PASSWORD?.trim();
  if (environmentPassword) return timingSafeTextEqual(password, environmentPassword);

  const encodedHash = await getSettingsAdminPasswordHash();
  if (!encodedHash) return false;
  const [algorithm, salt, hash] = encodedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function timingSafeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function saveApiBrasilSettings(input: unknown): Promise<SafeApiBrasilSettings> {
  const values = asRecord(input);
  const [previous] = await db
    .select()
    .from(apiProviderSettings)
    .where(eq(apiProviderSettings.key, SETTINGS_ID))
    .limit(1);

  const current = await getApiBrasilConfig();
  const bearerInput = typeof values.bearerToken === "string" ? values.bearerToken.trim() : "";
  const deviceInput = typeof values.deviceToken === "string" ? values.deviceToken.trim() : "";

  if (bearerInput && bearerInput.length > 8_000) throw new ApiSettingsError("Bearer Token muito longo.");
  if (deviceInput && deviceInput.length > 8_000) throw new ApiSettingsError("Device Token muito longo.");

  const baseUrl = validateBaseUrl(
    typeof values.baseUrl === "string" && values.baseUrl.trim()
      ? values.baseUrl.trim()
      : current.baseUrl,
  );
  const endpoints = validateEndpoints(values.endpoints, current.endpoints);
  const payloadMapping = validatePayloadMapping(values.payloadMapping, current.payloadMapping);

  const encryptedBearer = bearerInput
    ? encryptSecret(bearerInput)
    : previous?.encryptedBearer ?? (current.bearer ? encryptSecret(current.bearer) : null);
  const encryptedDevice = deviceInput
    ? encryptSecret(deviceInput)
    : previous?.encryptedDevice ?? (current.device ? encryptSecret(current.device) : null);
  const now = new Date();

  await db
    .insert(apiProviderSettings)
    .values({
      key: SETTINGS_ID,
      encryptedBearer,
      encryptedDevice,
      baseUrl,
      endpoints,
      payloadMapping,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: apiProviderSettings.key,
      set: { encryptedBearer, encryptedDevice, baseUrl, endpoints, payloadMapping, updatedAt: now },
    });

  return getSafeApiBrasilSettings();
}

export async function clearSavedApiBrasilSettings(): Promise<void> {
  const [row] = await db
    .select()
    .from(apiProviderSettings)
    .where(eq(apiProviderSettings.key, SETTINGS_ID))
    .limit(1);

  if (!row) return;
  await db
    .update(apiProviderSettings)
    .set({ encryptedBearer: null, encryptedDevice: null, updatedAt: new Date() })
    .where(eq(apiProviderSettings.key, SETTINGS_ID));
}

function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiSettingsError("Informe uma URL válida para o gateway APIBrasil.");
  }
  if (url.protocol !== "https:" || url.hostname !== OFFICIAL_GATEWAY_HOST) {
    throw new ApiSettingsError(
      `Por segurança, o gateway deve usar HTTPS em ${OFFICIAL_GATEWAY_HOST}.`,
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ApiSettingsError("O gateway não pode incluir usuário, senha, parâmetros ou fragmentos na URL.");
  }
  return url.toString().replace(/\/$/, "");
}

function validatePayloadMapping(value: unknown, fallback: ApiPayloadMapping): ApiPayloadMapping {
  const input = asRecord(value);
  const readField = (key: keyof ApiPayloadMapping): string => {
    const candidate = typeof input[key] === "string" ? (input[key] as string).trim() : fallback[key];
    if (candidate.length > 64 || (candidate && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(candidate))) {
      throw new ApiSettingsError(`Nome de campo inválido em ${key}. Use letras, números e sublinhado.`);
    }
    return candidate;
  };
  const mapping: ApiPayloadMapping = {
    placaField: readField("placaField"),
    renavamField: readField("renavamField"),
    renavamTypeField: readField("renavamTypeField"),
    renavamTypeValue: typeof input.renavamTypeValue === "string" ? input.renavamTypeValue.trim().slice(0, 80) : fallback.renavamTypeValue,
  };
  if (!mapping.placaField || !mapping.renavamField) {
    throw new ApiSettingsError("Os campos da placa e do RENAVAM não podem ficar vazios.");
  }
  if (mapping.renavamTypeField && (mapping.renavamTypeField === mapping.renavamField || mapping.renavamTypeField === mapping.placaField)) {
    throw new ApiSettingsError("O campo extra tipo deve ser diferente dos campos placa e RENAVAM.");
  }
  return mapping;
}

function validateEndpoints(value: unknown, fallback: ApiEndpointPaths): ApiEndpointPaths {
  const input = asRecord(value);
  const result = {} as ApiEndpointPaths;
  for (const key of Object.keys(defaultApiEndpointPaths) as Array<keyof ApiEndpointPaths>) {
    const candidate = typeof input[key] === "string" ? (input[key] as string).trim() : fallback[key];
    if (
      candidate.length > 180 ||
      !candidate.startsWith("/") ||
      !/^\/[a-zA-Z0-9/_-]+$/.test(candidate) ||
      candidate.includes("..")
    ) {
      throw new ApiSettingsError(`Endpoint inválido em ${key}. Use um caminho relativo seguro, como ${defaultApiEndpointPaths[key]}.`);
    }
    result[key] = candidate;
  }
  return result;
}

function encryptionKey(): Buffer {
  const master = process.env.APIBRASIL_SETTINGS_ENCRYPTION_KEY?.trim() || process.env.DATABASE_URL;
  if (!master) {
    throw new ApiSettingsError(
      "Configure DATABASE_URL ou APIBRASIL_SETTINGS_ENCRYPTION_KEY no servidor para criptografar os tokens.",
    );
  }
  return createHash("sha256").update(`arca-apibrasil-settings-v1:${master}`).digest();
}

function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptSecret(value: string): string {
  const [version, ivHex, tagHex, encryptedHex] = value.split(":");
  if (version !== "v1" || !ivHex || !tagHex || !encryptedHex) throw new Error("Formato de token cifrado inválido.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
