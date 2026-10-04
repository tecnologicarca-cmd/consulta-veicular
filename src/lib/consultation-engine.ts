import { ApiBrasil } from "apigratis-sdk-nodejs";
import {
  lookupPublicFipeForVehicle,
  normalizeVehicleSummary,
  type PublicPlateResult,
} from "@/lib/public-vehicle-apis";
import { getApiBrasilConfig } from "@/lib/api-provider-settings";
import { optionalServices, type ServiceSelection } from "@/lib/vehicles";
import type { LookupType } from "@/lib/vehicles";

type UnknownRecord = Record<string, unknown>;

const serviceNames = {
  fipe: "FIPE APIBrasil",
  multas: "Multas",
  roubo: "Roubo / furto",
  leilao: "Leilão",
  recall: "Recall",
} as const;

const creditServiceNames = {
  fipe: "tabela-fipe",
  multas: "renainf",
  roubo: "roubo-furto",
  leilao: "leilao",
  recall: "recall",
} as const;

const basicEndpoints = {
  placa: "agregados-basica",
  renavam: "agregados-renavam",
} as const;

export interface EngineSection {
  headline: string | null;
  state: "alert" | "clear" | "unknown";
  items: Array<{ label: string; value: string }>;
}

export interface EngineFine {
  ait: string | null;
  codigo: string | null;
  descricao: string;
  dataHora: string | null;
  local: string | null;
  orgao: string | null;
  status: string | null;
  valorDevido: number | null;
  valor: number | null;
  vencimento: string | null;
}

export interface EngineReport {
  lookupType: LookupType;
  lookupValue: string;
  plate: string | null;
  consultedAt: string;
  durationMs: number;
  services: ServiceSelection;
  sources: string[];
  vehicle: Record<string, unknown>;
  fipe: { valor: string | null; codigoFipe: string | null; modelo: string | null; anoModelo: string | null; combustivel: string | null; mesReferencia: string | null } | null;
  multas: EngineFine[];
  totalMultas: number;
  rouboFurto: EngineSection | null;
  leilao: EngineSection | null;
  recall: EngineSection | null;
  warnings: Array<{ service: string; message: string }>;
}

/**
 * Executa uma consulta completa: dados básicos via APIBrasil (créditos),
 * resolução FIPE gratuita e serviços extras selecionados.
 * Reutilizado pelo painel admin e pelo fluxo de pedidos pagos.
 */
export async function executeConsultation(
  lookupType: LookupType,
  lookupValue: string,
  services: ServiceSelection,
): Promise<EngineReport> {
  const startedAt = Date.now();
  const warnings: EngineReport["warnings"] = [];
  const sources: string[] = [];
  const configured = await getApiBrasilConfig().catch(() => null);

  if (!configured?.bearer) {
    throw new Error("APIBrasil não configurada. Salve o Bearer Token em Configurações.");
  }

  const sdk = new ApiBrasil({
    bearerToken: configured.bearer,
    baseURL: configured.baseUrl,
  });

  const vehicle: Record<string, unknown> = {};
  let plate: string | null = lookupType === "placa" ? lookupValue : null;

  // 1. Dados básicos (agregados-basica para placa / agregados-renavam para renavam)
  try {
    const payload =
      lookupType === "placa" ? { placa: lookupValue } : { renavam: lookupValue };
    const raw = await sdk.consulta.generic(basicEndpoints[lookupType], payload);
    const normalized = normalizeVehicleSummary(raw, plate);
    Object.assign(vehicle, normalized as unknown as UnknownRecord);
    if (normalized.placa) plate = normalized.placa;
    sources.push(lookupType === "placa" ? "APIBrasil · Dados básicos" : "APIBrasil · RENAVAM");
  } catch (error) {
    warnings.push({ service: "Dados básicos", message: message(error) });
  }

  // 2. Tabela FIPE gratuita (Parallelum) a partir de marca/modelo/ano
  let fipe: EngineReport["fipe"] = null;
  if (vehicle.marca || vehicle.modelo) {
    const freeFipe = await lookupPublicFipeForVehicle(vehicle as never);
    fipe = freeFipe.fipe;
    if (freeFipe.source) sources.push(freeFipe.source);
    if (freeFipe.warning && !fipe) {
      warnings.push({ service: "FIPE pública", message: freeFipe.warning });
    }
  }

  // 3. Serviços extras selecionados (cobrados por crédito)
  const selected = optionalServices.filter((service) => services[service]);
  const sections: Record<string, EngineSection | null> = {
    rouboFurto: null,
    leilao: null,
    recall: null,
  };
  const multas: EngineFine[] = [];
  let totalMultas = 0;

  if (selected.length > 0) {
    const payload: UnknownRecord = {};
    if (plate) payload.placa = plate;
    if (vehicle.renavam) payload.renavam = vehicle.renavam;

    const results = await Promise.all(
      selected.map(async (service) => {
        try {
          const value = await sdk.consulta.generic(creditServiceNames[service], payload);
          return { service, value, error: null as string | null };
        } catch (error) {
          return { service, value: null, error: message(error) };
        }
      }),
    );

    for (const result of results) {
      if (result.error) {
        warnings.push({ service: serviceNames[result.service], message: result.error });
        continue;
      }
      sources.push(`APIBrasil · ${serviceNames[result.service]}`);
      switch (result.service) {
        case "fipe":
          fipe = normalizeFipe(result.value) ?? fipe;
          break;
        case "multas":
          for (const fine of normalizeFines(result.value)) {
            multas.push(fine);
            totalMultas += fine.valorDevido ?? fine.valor ?? 0;
          }
          break;
        case "roubo":
          sections.rouboFurto = normalizeSection(result.value, "roubo");
          break;
        case "leilao":
          sections.leilao = normalizeSection(result.value, "leilao");
          break;
        case "recall":
          sections.recall = normalizeSection(result.value, "recall");
          break;
      }
    }
  }

  return {
    lookupType,
    lookupValue,
    plate,
    consultedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    services,
    sources,
    vehicle,
    fipe,
    multas,
    totalMultas: Math.round(totalMultas * 100) / 100,
    rouboFurto: sections.rouboFurto,
    leilao: sections.leilao,
    recall: sections.recall,
    warnings,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Falha na consulta.";
}

function unwrap(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    const record = current as Record<string, unknown> | null;
    if (!record || typeof record !== "object") break;
    const next = record.data ?? record.resultado ?? record.result;
    if (next === undefined || next === current) break;
    current = next;
  }
  return current;
}

function first(...values: unknown[]): unknown {
  return values.find((value) => value !== null && value !== undefined && value !== "");
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const result = String(value).trim();
  return result ? result.slice(0, 240) : null;
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  let normalized = value.replace(/[^0-9,.-]/g, "");
  if (normalized.includes(",")) normalized = normalized.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFipe(value: unknown): EngineReport["fipe"] {
  const source = unwrap(value) as Record<string, unknown>;
  if (!source || typeof source !== "object") return null;
  const row = (source.dados as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined;
  const candidate = row ?? source;
  const valor = text(first(candidate.valor, candidate.texto_valor, candidate.price));
  const codigoFipe = text(first(candidate.codigo_fipe, candidate.codigoFipe));
  const modelo = text(first(candidate.texto_modelo, candidate.modelo));
  if (!valor && !codigoFipe && !modelo) return null;
  return {
    valor,
    codigoFipe,
    modelo,
    anoModelo: text(first(candidate.ano_modelo, candidate.anoModelo)),
    combustivel: text(first(candidate.combustivel, candidate.fuel)),
    mesReferencia: text(first(candidate.mes_referencia, candidate.mesReferencia)),
  };
}

function findArray(value: unknown, depth = 0): unknown[] {
  if (Array.isArray(value)) return value;
  if (depth > 4) return [];
  const source = value as Record<string, unknown> | null;
  if (!source || typeof source !== "object") return [];
  for (const key of ["multas", "items", "itens", "results", "resultado", "data", "dados"]) {
    if (Array.isArray(source[key])) return source[key] as unknown[];
    if (source[key] && typeof source[key] === "object") {
      const nested = findArray(source[key], depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
}

function normalizeFines(value: unknown): EngineFine[] {
  return findArray(unwrap(value))
    .slice(0, 100)
    .map((item) => {
      const source = item as Record<string, unknown>;
      return {
        ait: text(first(source.ait, source.auto_infracao)),
        codigo: text(first(source.codigo, source.codigo_infracao)),
        descricao: text(first(source.descricao, source.descricao_infracao)) ?? "Infração",
        dataHora: text(first(source.data_hora, source.data)),
        local: text(first(source.local, source.endereco)),
        orgao: text(first(source.orgao, source.orgao_autuador)),
        status: text(first(source.status, source.situacao)),
        valor: parseAmount(first(source.valor, source.valor_original)),
        valorDevido: parseAmount(first(source.valor_devido, source.valor)),
        vencimento: text(first(source.vencimento, source.data_vencimento)),
      };
    });
}

function normalizeSection(value: unknown, kind: "roubo" | "leilao" | "recall"): EngineSection {
  const unwrapped = unwrap(value);
  const source = (Array.isArray(unwrapped) ? unwrapped[0] : unwrapped) as Record<string, unknown>;
  const items: EngineSection["items"] = [];
  for (const [key, raw] of Object.entries(source ?? {})) {
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") continue;
    const valueText = String(raw).trim();
    if (!valueText) continue;
    items.push({ label: prettyLabel(key), value: valueText.slice(0, 220) });
    if (items.length >= 12) break;
  }
  const headline = text(first(source.mensagem, source.message, source.descricao, source.msg, source.status));
  return { headline, state: inferState(source, headline, kind), items };
}

function inferState(
  source: Record<string, unknown>,
  headline: string | null,
  kind: "roubo" | "leilao" | "recall",
): EngineSection["state"] {
  const flags = /roubo|furto|leil|recall|restri|registro|apont|ocorr|encontr|possui|pendente/i;
  for (const [key, raw] of Object.entries(source ?? {})) {
    if (!flags.test(key)) continue;
    if (raw === true || raw === 1) return "alert";
    if (raw === false || raw === 0) return "clear";
  }
  const normalized = (headline ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/nada consta|sem (registro|ocorrencia|apontamento)|nao (ha|possui)/.test(normalized)) return "clear";
  const risk =
    kind === "roubo" ? /roubo|furto/ : kind === "leilao" ? /leilao|sinistro/ : /recall|campanha/;
  return risk.test(normalized) ? "alert" : "unknown";
}

function prettyLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}
