import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { vehicleConsultations } from "@/db/schema";
import {
  isValidPlate,
  isValidRenavam,
  normalizePlate,
  normalizeRenavam,
  optionalServices,
  type ConsultationReport,
  type ConsultationSource,
  type ConsultationStatus,
  type FineSummary,
  type LookupType,
  type OptionalService,
  type ProviderSection,
  type ReportWarning,
  type ServiceSelection,
  type VehicleSummary,
} from "@/lib/vehicles";
import {
  getPublicPlateApiUrl,
  lookupPublicFipe,
  lookupPublicFipeForVehicle,
  lookupPublicPlate,
  normalizeVehicleSummary,
  type PublicPlateResult,
} from "@/lib/public-vehicle-apis";
import { getApiBrasilConfig } from "@/lib/api-provider-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "arca_visitor";
const REQUEST_WINDOW_MS = 60_000;
const REQUEST_LIMIT = 25;
const MAX_IDENTIFIERS = 10;
const requestWindows = new Map<string, { count: number; startsAt: number }>();
const serviceNames: Record<OptionalService, string> = {
  fipe: "FIPE APIBrasil",
  multas: "Multas",
  roubo: "Roubo / furto",
  leilao: "Leilão",
  recall: "Recall",
};

const creditServiceNames: Record<OptionalService, string> = {
  fipe: "tabela-fipe",
  multas: "renainf",
  roubo: "roubo-furto",
  leilao: "leilao",
  recall: "recall",
};

import { ApiBrasil } from "apigratis-sdk-nodejs";

type Credentials = {
  bearer: string;
  device?: string;
  baseUrl: string;
  payloadMapping: { placaField: string; renavamField: string; renavamTypeField: string; renavamTypeValue: string };
};
type UnknownRecord = Record<string, unknown>;
type NormalizedIdentifier = { type: LookupType; value: string };

export async function POST(request: Request) {
  const startedAt = Date.now();
  const input = asRecord(await request.json().catch(() => null));
  const lookupType: LookupType = input.lookupType === "renavam" ? "renavam" : "placa";
  const identifiers = normalizeIdentifiers(input, lookupType);

  if (identifiers.length === 0 || identifiers.length > MAX_IDENTIFIERS) {
    return NextResponse.json(
      { ok: false, error: `Informe de 1 a ${MAX_IDENTIFIERS} identificadores válidos, um por linha.` },
      { status: 400 },
    );
  }
  if (!consumeRequest(request)) {
    return NextResponse.json(
      { ok: false, error: "Muitas consultas em sequência. Aguarde um minuto e tente novamente." },
      { status: 429 },
    );
  }

  const services = normalizeServices(input.servicos);
  const { visitorId, isNew } = await getVisitor();
  const configured = await getApiBrasilConfig().catch(() => null);
  const credentials: Credentials | null = configured?.bearer
    ? {
        bearer: configured.bearer,
        device: configured.device || undefined,
        baseUrl: configured.baseUrl,
        payloadMapping: configured.payloadMapping,
      }
    : null;
  const endpointPaths = configured?.endpoints;

  try {
    const reports = await Promise.all(
      identifiers.map((identifier) =>
        consultOne(identifier, services, credentials, endpointPaths, startedAt),
      ),
    );
    await Promise.all(
      reports.map((report) => saveHistory({
        visitorId,
        lookupType: report.lookupType,
        searchValue: report.lookupValue,
        plate: report.lookupType === "placa" ? report.lookupValue : null,
        services,
        status: report.mode === "unavailable"
          ? "unavailable"
          : report.warnings.length > 0
            ? "partial"
            : "success",
        source: report.mode,
        durationMs: report.durationMs,
      })),
    );
    const response = NextResponse.json({ ok: true, data: { reports } });
    attachVisitorCookie(response, visitorId, isNew);
    return response;
  } catch {
    const response = NextResponse.json(
      { ok: false, error: "Não foi possível concluir a consulta. Confira a configuração e tente novamente." },
      { status: 502 },
    );
    attachVisitorCookie(response, visitorId, isNew);
    return response;
  }
}

async function consultOne(
  identifier: NormalizedIdentifier,
  services: ServiceSelection,
  credentials: Credentials | null,
  endpoints: Awaited<ReturnType<typeof getApiBrasilConfig>>["endpoints"] | undefined,
  startedAt: number,
): Promise<ConsultationReport> {
  const warnings: ReportWarning[] = [];
  const sources: string[] = [];
  const plateInput = identifier.type === "placa" ? identifier.value : null;
  let vehicle = emptyVehicle(plateInput);
  let publicPlate: PublicPlateResult | null = null;
  let fipe: ConsultationReport["fipe"] = null;
  let multas: FineSummary[] = [];
  let totalMultas = 0;
  let rouboFurto: ProviderSection | null = null;
  let leilao: ProviderSection | null = null;
  let recall: ProviderSection | null = null;

  if (credentials) {
    let apiBrasilSuccess = false;

    // 1. If device token is configured, try device endpoint first (e.g. /vehicles/dados)
    if (credentials.device && endpoints) {
      try {
        const mapping = credentials.payloadMapping;
        const field = identifier.type === "placa" ? mapping.placaField : mapping.renavamField;
        const basicPayload: UnknownRecord = { [field]: identifier.value };
        if (identifier.type === "renavam" && mapping.renavamTypeField) {
          basicPayload[mapping.renavamTypeField] = mapping.renavamTypeValue || "renavam";
        }
        const basicEndpoint = identifier.type === "placa" ? endpoints.dados : endpoints.renavam;
        const data = await providerRequest(basicEndpoint, basicPayload, credentials);
        vehicle = mergeVehicles(vehicle, normalizeVehicleSummary(data, plateInput));
        sources.push(identifier.type === "placa" ? "APIBrasil · Dados básicos (Device)" : "APIBrasil · Dados RENAVAM (Device)");
        apiBrasilSuccess = true;
      } catch (deviceError) {
        // Fall back to credit-based query
      }
    }

    // 2. If only Bearer Token or if device endpoint failed, use official SDK's credit-based consulta
    if (!apiBrasilSuccess && credentials.bearer) {
      try {
        const sdk = new ApiBrasil({
          bearerToken: credentials.bearer,
          baseURL: credentials.baseUrl,
        });

        let data: unknown = null;
        if (identifier.type === "placa") {
          // Try agregados-basica first, then agregados-simples
          try {
            data = await sdk.consulta.generic("agregados-basica", { placa: identifier.value });
          } catch {
            data = await sdk.consulta.generic("agregados-simples", { placa: identifier.value });
          }
          sources.push("APIBrasil · Dados básicos por Placa (Créditos)");
        } else {
          // RENAVAM credit lookup
          try {
            data = await sdk.consulta.generic("agregados-renavam", { renavam: identifier.value });
          } catch {
            data = await sdk.consulta.generic("agregados-renavam-v2", { renavam: identifier.value });
          }
          sources.push("APIBrasil · Dados básicos por RENAVAM (Créditos)");
        }

        vehicle = mergeVehicles(vehicle, normalizeVehicleSummary(data, plateInput));
        apiBrasilSuccess = true;
      } catch (creditError) {
        warnings.push({
          service: "APIBrasil",
          message: friendlyErrorMessage(creditError),
        });
      }
    }
  }

  if (identifier.type === "placa" && !sources.some((source) => source.startsWith("APIBrasil · Dados básicos")) && getPublicPlateApiUrl()) {
    try {
      publicPlate = await lookupPublicPlate(identifier.value);
      vehicle = mergeVehicles(vehicle, publicPlate.vehicle);
      sources.push("Provedor público de dados por placa");
    } catch (error) {
      warnings.push({ service: "Dados públicos por placa", message: errorMessage(error) });
    }
  }

  if (publicPlate) {
    const freeFipe = await lookupPublicFipe(publicPlate);
    fipe = freeFipe.fipe;
    if (freeFipe.source) sources.push(freeFipe.source);
    if (freeFipe.warning) warnings.push({ service: "FIPE pública", message: freeFipe.warning });
  } else if (vehicle.marca || vehicle.modelo) {
    const freeFipe = await lookupPublicFipeForVehicle(vehicle);
    fipe = freeFipe.fipe;
    if (freeFipe.source) sources.push(freeFipe.source);
    if (freeFipe.warning && freeFipe.fipe === null) {
      warnings.push({ service: "FIPE pública", message: freeFipe.warning });
    }
  }

  const selectedPaid = optionalServices.filter((service) => services[service]);
  if (selectedPaid.length > 0 && !credentials) {
    for (const service of selectedPaid) {
      warnings.push({
        service: serviceNames[service],
        message: "Credenciais APIBrasil ausentes. Configure Bearer e Device Token na aba Configurações.",
      });
    }
  } else if (selectedPaid.length > 0 && credentials && endpoints) {
    const results = await Promise.all(selectedPaid.map(async (service) => {
      try {
        const payload: UnknownRecord = {};
        const plate = vehicle.placa || plateInput;
        if (plate) payload.placa = plate;
        if (vehicle.renavam) {
          payload.renavam = vehicle.renavam;
          payload[credentials.payloadMapping.renavamField] = vehicle.renavam;
        }
        if (identifier.type === "renavam") {
          payload.renavam = identifier.value;
          payload[credentials.payloadMapping.renavamField] = identifier.value;
          if (credentials.payloadMapping.renavamTypeField) payload[credentials.payloadMapping.renavamTypeField] = credentials.payloadMapping.renavamTypeValue || "renavam";
        }
        if (identifier.type === "placa" && !payload.placa) payload.placa = identifier.value;

        let value: unknown = null;
        let queryError: unknown = null;

        // Try device endpoint if deviceToken is present
        if (credentials.device && endpoints) {
          try {
            value = await providerRequest(endpoints[service], payload, credentials);
          } catch (e) {
            queryError = e;
          }
        }

        // Fall back to credit-based endpoint via official SDK
        if (!value && credentials.bearer) {
          try {
            const sdk = new ApiBrasil({
              bearerToken: credentials.bearer,
              baseURL: credentials.baseUrl,
            });
            value = await sdk.consulta.generic(creditServiceNames[service], payload);
            queryError = null;
          } catch (sdkErr) {
            queryError = sdkErr;
          }
        }

        if (value) {
          return { service, value, error: null as string | null };
        }
        return { service, value: null, error: errorMessage(queryError) };
      } catch (error) {
        return { service, value: null, error: errorMessage(error) };
      }
    }));

    for (const result of results) {
      if (result.error) {
        warnings.push({ service: serviceNames[result.service], message: result.error });
        continue;
      }
      sources.push(`APIBrasil · ${serviceNames[result.service]}`);
      switch (result.service) {
        case "fipe":
          fipe = normalizeFipeResult(result.value) ?? fipe;
          break;
        case "multas":
          multas = normalizeFines(result.value);
          totalMultas = multas.reduce((sum, fine) => sum + (fine.valorDevido ?? fine.valor ?? 0), 0);
          break;
        case "roubo":
          rouboFurto = normalizeSection(result.value, "roubo");
          break;
        case "leilao":
          leilao = normalizeSection(result.value, "leilao");
          break;
        case "recall":
          recall = normalizeSection(result.value, "recall");
          break;
      }
    }
  }

  const mode: ConsultationSource = sources.some((source) => source.startsWith("APIBrasil ·"))
    ? sources.some((source) => source.startsWith("Provedor público")) ? "mixed" : "apibrasil"
    : sources.some((source) => source.startsWith("Provedor público") || source.startsWith("API FIPE pública") || source.startsWith("Tabela FIPE oficial"))
      ? "public"
      : "unavailable";

  return {
    mode,
    lookupType: identifier.type,
    lookupValue: identifier.value,
    plate: vehicle.placa || plateInput,
    consultedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    services,
    sources,
    vehicle,
    fipe,
    multas,
    totalMultas: Math.round(totalMultas * 100) / 100,
    rouboFurto,
    leilao,
    recall,
    warnings,
    ...(mode === "unavailable"
      ? { demoNotice: identifier.type === "renavam"
          ? "Nenhuma credencial APIBrasil foi configurada para pesquisar por RENAVAM. Abra Configurações, salve os tokens e tente novamente."
          : "Nenhuma fonte de placa respondeu. Configure os tokens APIBrasil na aba Configurações; a FIPE pública funciona independentemente por marca/modelo/ano." }
      : {}),
  };
}

async function providerRequest(
  endpoint: string,
  payload: UnknownRecord,
  credentials: Credentials,
): Promise<unknown> {
  const base = credentials.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${credentials.bearer}`,
  };
  if (credentials.device?.trim()) {
    headers["DeviceToken"] = credentials.device.trim();
  }

  let response: Response;
  try {
    response = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(18_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("A APIBrasil demorou para responder.");
    throw new Error("Não foi possível conectar ao gateway APIBrasil.");
  }
  const raw = await response.text().catch(() => "");
  let parsed: unknown = null;
  if (raw) {
    try { parsed = JSON.parse(raw) as unknown; }
    catch { if (response.ok) throw new Error("A APIBrasil retornou JSON inválido."); }
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("APIBrasil recusou Bearer/Device Token. Revise as credenciais em Configurações.");
    if (response.status === 429) throw new Error("Limite/credits APIBrasil atingido.");
    if (response.status === 404) throw new Error("Endpoint ou registro não encontrado; revise os caminhos de API em Configurações.");
    throw new Error(`APIBrasil respondeu HTTP ${response.status}. Revise endpoint e payload.`);
  }
  const record = asRecord(parsed);
  if (record.success === false || record.status === "error" || record.erro) {
    throw new Error(text(first(record.message, record.mensagem, record.error, record.erro)) ?? "APIBrasil não encontrou registro ou recusou o payload.");
  }
  return unwrapPayload(parsed);
}

function getCredentialsNotUsed(): void {}

function normalizeIdentifiers(input: UnknownRecord, type: LookupType): NormalizedIdentifier[] {
  const source = Array.isArray(input.identificadores)
    ? input.identificadores
    : [input.valor ?? input.identificador ?? input.placa ?? input.renavam];
  const values = source.flatMap((value) => typeof value === "string" ? value.split(/[\n,;]+/) : []);
  const normalized = values.map((value) => type === "renavam"
    ? { type, value: normalizeRenavam(value) }
    : { type, value: normalizePlate(value) }).filter((item) => item.value.length > 0);
  const seen = new Set<string>();
  return normalized.filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return type === "renavam" ? isValidRenavam(item.value) : isValidPlate(item.value);
  });
}

function normalizeServices(value: unknown): ServiceSelection {
  const input = asRecord(value);
  return Object.fromEntries(optionalServices.map((service) => [service, input[service] === true])) as ServiceSelection;
}

function emptyVehicle(plate: string | null): VehicleSummary {
  return {
    placa: plate,
    renavam: null,
    chassi: null,
    motor: null,
    marca: null,
    modelo: null,
    marcaModelo: null,
    anoFabricacao: null,
    anoModelo: null,
    cor: null,
    combustivel: null,
    especie: null,
    tipo: null,
    categoria: null,
    municipio: null,
    uf: null,
    situacao: null,
    potencia: null,
    cilindradas: null,
    passageiros: null,
  };
}

function mergeVehicles(base: VehicleSummary, enriched: VehicleSummary): VehicleSummary {
  const result = { ...base };
  for (const key of Object.keys(result) as Array<keyof VehicleSummary>) {
    if (enriched[key] !== null && enriched[key] !== "") result[key] = enriched[key] as never;
  }
  return result;
}

function normalizeFipeResult(value: unknown): ConsultationReport["fipe"] {
  const source = asRecord(unwrapPayload(value));
  if (!Object.keys(source).length) return null;
  const fipe = asRecord(first(source.fipe, source.fipes, source.data));
  const row = Array.isArray(fipe.dados) ? asRecord(fipe.dados[0]) : fipe;
  const candidate = Object.keys(row).length ? row : source;
  const valor = text(first(candidate.valor, candidate.price, candidate.preco, candidate.valor_fipe, candidate.texto_valor));
  const modelo = text(first(candidate.texto_modelo, candidate.modelo, candidate.model));
  const code = text(first(candidate.codigo_fipe, candidate.codigoFipe, candidate.codeFipe, candidate.codigo));
  if (!valor && !code && !modelo) return null;
  return {
    valor,
    codigoFipe: code,
    marca: text(first(candidate.texto_marca, candidate.marca, candidate.brand)),
    modelo,
    anoModelo: text(first(candidate.ano_modelo, candidate.anoModelo, candidate.modelYear)),
    combustivel: text(first(candidate.combustivel, candidate.fuel)),
    mesReferencia: text(first(candidate.mes_referencia, candidate.mesReferencia, candidate.referenceMonth)),
  };
}

function normalizeFines(value: unknown): FineSummary[] {
  const rows = findArray(unwrapPayload(value));
  return rows.slice(0, 100).map((item) => {
    const source = asRecord(item);
    return {
      ait: text(first(source.ait, source.auto_infracao, source.autoInfracao)),
      codigo: text(first(source.codigo, source.codigo_infracao, source.codigoInfracao)),
      descricao: text(first(source.descricao, source.descricao_infracao, source.infracao)) ?? "Infração",
      dataHora: text(first(source.data_hora, source.dataHora, source.data)),
      local: text(first(source.local, source.endereco)),
      municipio: text(first(source.municipio, source.cidade)),
      orgao: text(first(source.orgao, source.orgao_autuador)),
      pontos: text(source.pontos),
      status: text(first(source.status, source.situacao)),
      valor: parseAmount(first(source.valor, source.valor_original)),
      valorDevido: parseAmount(first(source.valor_devido, source.valorDevido, source.valor)),
      vencimento: text(first(source.vencimento, source.data_vencimento)),
    };
  });
}

function normalizeSection(value: unknown, kind: "roubo" | "leilao" | "recall"): ProviderSection {
  const source = asRecord(Array.isArray(unwrapPayload(value)) ? (unwrapPayload(value) as unknown[])[0] : unwrapPayload(value));
  const sensitiveKey = /token|senha|authorization|bearer|cpf|cnpj|propriet|\bnome\b|endereco|renavam|chassi/i;
  const items: ProviderSection["items"] = [];
  for (const [key, raw] of Object.entries(source)) {
    if (sensitiveKey.test(key) || /^(data|dados|success|request|response)$/i.test(key) || raw === null || raw === undefined) continue;
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") continue;
    const valueText = String(raw).trim();
    if (!valueText) continue;
    items.push({ label: prettyLabel(key), value: valueText.slice(0, 220) });
    if (items.length >= 12) break;
  }
  const headline = text(first(source.mensagem, source.message, source.descricao, source.resultado, source.status, source.situacao));
  return { headline, state: inferSectionState(source, headline, kind), items };
}

function inferSectionState(source: UnknownRecord, headline: string | null, kind: "roubo" | "leilao" | "recall"): ProviderSection["state"] {
  const normalizedHeadline = (headline ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const clear = /nada consta|sem (registro|ocorrencia|apontamento|historico)|nao (ha|possui|foram encontrados)|nenhum(a)? (registro|ocorrencia|recall)/;
  if (clear.test(normalizedHeadline)) return "clear";
  const keys = Object.keys(source).filter((key) => /roubo|furto|leil|recall|restri|registro|apont|ocorr|encontr|possui|pendente/i.test(key));
  if (keys.some((key) => source[key] === true || source[key] === 1)) return "alert";
  const riskPattern = kind === "roubo" ? /roubo|furto|recuperado|restricao policial/ : kind === "leilao" ? /leilao|sinistro/ : /recall|campanha pendente/;
  return riskPattern.test(normalizedHeadline) ? "alert" : "unknown";
}

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}
function unwrapPayload(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    const record = asRecord(current);
    const next = record.data ?? record.resultado ?? record.result;
    if (next === undefined || next === current) break;
    current = next;
  }
  return current;
}
function findArray(value: unknown, depth = 0): unknown[] {
  if (Array.isArray(value)) return value;
  if (depth > 4) return [];
  const source = asRecord(value);
  for (const key of ["multas", "items", "itens", "results", "resultado", "data", "dados"]) {
    if (Array.isArray(source[key])) return source[key] as unknown[];
    if (source[key] && typeof source[key] === "object") {
      const nested = findArray(source[key], depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
}
function first(...values: unknown[]): unknown { return values.find((value) => value !== null && value !== undefined && value !== ""); }
function text(value: unknown): string | null {
  if (value === null || value === undefined || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 240) : null;
}
function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  let parsed = value.replace(/[^0-9,.-]/g, "");
  if (parsed.includes(",")) parsed = parsed.replace(/\./g, "").replace(",", ".");
  const result = Number(parsed);
  return Number.isFinite(result) ? result : null;
}
function prettyLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (item) => item.toUpperCase());
}
function consumeRequest(request: Request): boolean {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  const previous = requestWindows.get(address);
  if (!previous || now - previous.startsAt > REQUEST_WINDOW_MS) {
    requestWindows.set(address, { count: 1, startsAt: now });
    if (requestWindows.size > 2_000) for (const [key, value] of requestWindows) if (now - value.startsAt > REQUEST_WINDOW_MS) requestWindows.delete(key);
    return true;
  }
  if (previous.count >= REQUEST_LIMIT) return false;
  previous.count += 1;
  return true;
}
async function getVisitor(): Promise<{ visitorId: string; isNew: boolean }> {
  const jar = await cookies();
  const existing = jar.get(COOKIE_NAME)?.value;
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return { visitorId: existing, isNew: false };
  return { visitorId: randomUUID(), isNew: true };
}
function attachVisitorCookie(response: NextResponse, visitorId: string, isNew: boolean): void {
  if (!isNew) return;
  response.cookies.set(COOKIE_NAME, visitorId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180 });
}
async function saveHistory(input: {
  visitorId: string; lookupType: LookupType; searchValue: string; plate: string | null;
  services: ServiceSelection; status: ConsultationStatus; source: ConsultationSource; durationMs: number;
}): Promise<void> {
  try {
    await db.insert(vehicleConsultations).values({
      visitorId: input.visitorId,
      plate: input.plate,
      searchType: input.lookupType,
      searchValue: input.searchValue,
      services: input.services,
      status: input.status,
      source: input.source,
      durationMs: Math.min(input.durationMs, 2_147_483_647),
    });
  } catch {
    // A failed history write must not erase the provider response.
  }
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "A fonte consultada não respondeu.";
}

function friendlyErrorMessage(error: unknown): string {
  const msg = errorMessage(error);
  if (
    msg.includes("não está disponível para esse endpoint") ||
    msg.includes("Plano ativo não encontrado")
  ) {
    return "Sua conta APIBrasil está autenticada, mas o serviço de consulta veicular ainda não foi ativado no painel da APIBrasil. Acesse app.apibrasil.io -> Minhas APIs -> Ative a 'API Placa Dados' (ou contrate a consulta correspondente) e informe também o DeviceToken se aplicável.";
  }
  return msg;
}
