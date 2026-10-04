import { ApiBrasil } from "apigratis-sdk-nodejs";
import {
  ApiBrasilCreditsClient,
  ApiBrasilCreditsError,
  InsufficientBalanceError,
  parseBrMoney,
  type CsvCompletaData,
  type DebitosBoletoJobData,
  type GravameData,
} from "@/lib/apibrasil-credits";
import {
  lookupPublicFipeForVehicle,
  normalizeVehicleSummary,
} from "@/lib/public-vehicle-apis";
import { getApiBrasilConfig } from "@/lib/api-provider-settings";
import { optionalServices, type ServiceSelection } from "@/lib/vehicles";
import type { LookupType } from "@/lib/vehicles";

const serviceNames = {
  fipe: "FIPE APIBrasil",
  multas: "Multas",
  roubo: "Roubo / furto",
  leilao: "Leilão",
  recall: "Recall",
  gravame: "Gravame",
  csv: "CSV Completa",
  debitos: "Débitos (boleto)",
  crlv: "Documento CRLV",
  score: "Acerta Essencial",
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
  gravame: EngineSection | null;
  csvCompleta: {
    bin: {
      marcaModelo: string | null;
      chassi: string | null;
      renavam: string | null;
      municipio: string | null;
      uf: string | null;
      situacao: string | null;
      combustivel: string | null;
      cor: string | null;
      anoFabricacao: string | null;
      anoModelo: string | null;
      proprietario: { documento: string | null; nome: string | null } | null;
    } | null;
    restricoes: Array<{ mensagem: string }>;
    renajud: { quantidade: string | null; ocorrencias: Array<{ processo: string | null; orgao: string | null; tribunal: string | null; data: string | null; restricoes: string | null }> };
    renainf: { quantidade: string | null; ocorrencias: Array<{ descricao: string | null; valor: string | null; local: string | null; data: string | null }> };
  } | null;
  debitos: { status: string | null; pdf: string | null; valor: number | null; msg: string | null } | null;
  crlv: { pdf: string | null; uf: string | null; consultaId: string | null } | null;
  score: { score: string | null; probabilidade: string | null; mensagem: string | null; nome: string | null; situacao: string | null; renda: string | null } | null;
  warnings: Array<{ service: string; message: string }>;
  /** Custo real cobrado pela APIBrasil nesta consulta, quando informado. */
  totalCost: number | null;
}

/**
 * Executa uma consulta completa: dados básicos, resolução FIPE gratuita e os
 * serviços extras selecionados. Reutilizado pelo painel admin e pelo fluxo de
 * pedidos pagos.
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

  const credits = new ApiBrasilCreditsClient({
    bearerToken: configured.bearer,
    baseUrl: configured.baseUrl,
  });
  const legacy = new ApiBrasil({ bearerToken: configured.bearer, baseURL: configured.baseUrl });

  const vehicle: Record<string, unknown> = {};
  let plate: string | null = lookupType === "placa" ? lookupValue : null;
  let totalCost: number | null = null;

  // 1. Dados básicos — agregados-basica (placa) / agregados-renavam (renavam)
  try {
    const payload =
      lookupType === "placa" ? { placa: lookupValue } : { renavam: lookupValue };
    const raw = await legacy.consulta.generic(
      lookupType === "placa" ? "agregados-basica" : "agregados-renavam",
      payload,
    );
    const normalized = normalizeVehicleSummary(raw, plate);
    Object.assign(vehicle, normalized as unknown as Record<string, unknown>);
    if (normalized.placa) plate = normalized.placa;
    sources.push(lookupType === "placa" ? "APIBrasil · Dados básicos" : "APIBrasil · RENAVAM");
    totalCost = addCost(totalCost, parseBrMoney(asRecord(raw).tax));
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

  const selected = optionalServices.filter((service) => services[service]);
  const sections: Record<string, EngineSection | null> = {
    rouboFurto: null,
    leilao: null,
    recall: null,
    gravame: null,
  };
  const multas: EngineFine[] = [];
  let totalMultas = 0;
  let csvCompleta: EngineReport["csvCompleta"] = null;
  let debitos: EngineReport["debitos"] = null;
  let crlv: EngineReport["crlv"] = null;
  let score: EngineReport["score"] = null;

  // 3. Serviços legados por crédito (endpoint genérico)
  const legacyJobs: Array<"fipe" | "multas" | "roubo" | "leilao" | "recall"> = [];
  if (services.fipe) legacyJobs.push("fipe");
  if (services.multas) legacyJobs.push("multas");
  if (services.roubo) legacyJobs.push("roubo");
  if (services.leilao) legacyJobs.push("leilao");
  if (services.recall) legacyJobs.push("recall");

  if (legacyJobs.length > 0) {
    const payload: Record<string, unknown> = {};
    if (plate) payload.placa = plate;
    if (vehicle.renavam) payload.renavam = vehicle.renavam;
    if (lookupType === "renavam") payload.renavam = lookupValue;

    const legacyTypes: Record<string, string> = {
      fipe: "tabela-fipe",
      multas: "renainf",
      roubo: "roubo-furto",
      leilao: "leilao",
      recall: "recall",
    };

    const results = await Promise.all(
      legacyJobs.map(async (service) => {
        try {
          const value = await legacy.consulta.generic(legacyTypes[service], payload);
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
      totalCost = addCost(totalCost, parseBrMoney(asRecord(result.value).tax));
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

  // 4. Novos serviços de créditos, com o cliente dedicado
  if (services.gravame && plate) {
    try {
      const result = await credits.gravame({ placa: plate });
      sources.push("APIBrasil · Gravame");
      totalCost = addCost(totalCost, result.totalCost);
      sections.gravame = normalizeGravame(result.data);
    } catch (error) {
      warnings.push({ service: serviceNames.gravame, message: message(error) });
    }
  }

  if (services.csv && plate) {
    try {
      const result = await credits.csvCompleta({ placa: plate });
      sources.push("APIBrasil · CSV Completa");
      totalCost = addCost(totalCost, result.totalCost);
      csvCompleta = normalizeCsvCompleta(result.data);
      const renainf = csvCompleta?.renainf;
      for (const ocorrencia of renainf?.ocorrencias ?? []) {
        const fine: EngineFine = {
          ait: null,
          codigo: null,
          descricao: ocorrencia.descricao ?? "Infração",
          dataHora: ocorrencia.data ?? null,
          local: ocorrencia.local ?? null,
          orgao: null,
          status: null,
          valor: null,
          valorDevido: null,
          vencimento: null,
        };
        const valor = parseBrMoney(ocorrencia.valor);
        fine.valor = valor;
        fine.valorDevido = valor;
        multas.push(fine);
        if (valor) totalMultas += valor;
      }
    } catch (error) {
      warnings.push({ service: serviceNames.csv, message: message(error) });
    }
  }

  if (services.debitos && plate) {
    try {
      const started = await credits.debitosBoleto({ placa: plate });
      totalCost = addCost(totalCost, started.totalCost);
      const jobId = started.data?.["job-id"];
      if (jobId) {
        const job = await credits.debitosBoletoJob({ jobId });
        totalCost = addCost(totalCost, job.totalCost);
        debitos = normalizeDebitos(job.data);
        sources.push("APIBrasil · Débitos (boleto)");
      } else {
        warnings.push({ service: serviceNames.debitos, message: "A APIBrasil não retornou o identificador do processamento." });
      }
    } catch (error) {
      warnings.push({ service: serviceNames.debitos, message: message(error) });
    }
  }

  if (services.crlv && plate && vehicle.renavam) {
    try {
      const proprietario = asRecord(vehicle.proprietario) as { documento?: unknown };
      const cpf = text(proprietario.documento) ?? digits(vehicle.cpf);
      if (cpf) {
        const result = await credits.crlvPa({ placa: plate, renavam: String(vehicle.renavam), cpf });
        sources.push("APIBrasil · Documento CRLV");
        totalCost = addCost(totalCost, result.totalCost);
        crlv = { pdf: text(result.data?.pdf), uf: text(result.data?.uf), consultaId: text(result.data?.consulta_id) };
      } else {
        warnings.push({
          service: serviceNames.crlv,
          message: "Documento CRLV exige o CPF do proprietário, que não foi retornado pela consulta básica.",
        });
      }
    } catch (error) {
      warnings.push({ service: serviceNames.crlv, message: message(error) });
    }
  }

  if (services.score) {
    const cpf = digits(inputCpf(lookupType, lookupValue, vehicle));
    if (cpf) {
      try {
        const result = await credits.acertaEssencial({ cpf });
        sources.push("APIBrasil · Acerta Essencial");
        totalCost = addCost(totalCost, result.totalCost);
        score = normalizeAcerta(result.data);
      } catch (error) {
        warnings.push({ service: serviceNames.score, message: message(error) });
      }
    } else {
      warnings.push({
        service: serviceNames.score,
        message: "Informe um CPF válido para consultar o score.",
      });
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
    gravame: sections.gravame,
    csvCompleta,
    debitos,
    crlv,
    score,
    warnings,
    totalCost,
  };
}

/* =====================================================================
   NORMALIZADORES DOS NOVOS SERVIÇOS
   ===================================================================== */

function normalizeGravame(data: GravameData): EngineSection {
  const items = [
    { label: "Situação do veículo", value: text(data.statusdoveiculo) },
    { label: "Descrição", value: text(data.descricaostatus) },
    { label: "Financeira", value: text(data.financeiranome) },
    { label: "Documento da financeira", value: text(data.documentofinanceira) },
    { label: "Financiado", value: text(data.nomefinanciado) },
    { label: "Contrato", value: text(data.numerocontrato) },
    { label: "Data do gravame", value: text(data.datagravame) },
    { label: "UF do gravame", value: text(data.ufgravame) },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));

  const ultimo = data.historico?.[0];
  if (ultimo?.status) items.push({ label: "Último registro", value: ultimo.status });

  const semGravame = /NAO EXISTE|SEM GRAVAME|NAO POSSUI/.test(
    `${text(data.statusdoveiculo) ?? ""} ${text(data.descricaostatus) ?? ""}`.toUpperCase(),
  );
  const state: EngineSection["state"] = semGravame
    ? "clear"
    : Boolean(data.financeiranome || data.numerocontrato)
      ? "alert"
      : "unknown";

  return { headline: text(data.descricaostatus), state, items };
}

function normalizeCsvCompleta(data: CsvCompletaData): EngineReport["csvCompleta"] {
  const veicular = data?.veicular;
  if (!veicular) return null;
  const bin = veicular.bin_nacional;
  const proprietario = bin?.proprietario
    ? { documento: text(bin.proprietario.documento), nome: text(bin.proprietario.nome) }
    : null;

  return {
    bin: bin
      ? {
          marcaModelo: text(bin.marca_modelo),
          chassi: text(bin.chassi),
          renavam: text(bin.renavam),
          municipio: text(bin.municipio),
          uf: text(bin.uf),
          situacao: text(bin.situacao),
          combustivel: text(bin.combustivel),
          cor: text(bin.cor_veiculo),
          anoFabricacao: text(bin.ano_fabricacao),
          anoModelo: text(bin.ano_modelo),
          proprietario,
        }
      : null,
    restricoes: (bin?.restricoes?.mensagens_restricoes ?? [])
      .map((item) => ({ mensagem: text(item.mensagem) ?? "" }))
      .filter((item) => item.mensagem),
    renajud: {
      quantidade: text(veicular.renajud?.quantidade_ocorrencias),
      ocorrencias: (veicular.renajud?.ocorrencias ?? []).map((item) => ({
        processo: text(item.processo),
        orgao: text(item.orgao_judiciario),
        tribunal: text(item.tribunal),
        data: text(item.data),
        restricoes: text(item.restricoes),
      })),
    },
    renainf: {
      quantidade: text(veicular.renainf?.qtd_ocorrencias),
      ocorrencias: (veicular.renainf?.ocorrencias ?? []).map((item) => ({
        descricao: text(first(item.descricao, item.descricao_infracao, item.infracao)),
        valor: text(first(item.valor, item.valor_devido)),
        local: text(first(item.local, item.endereco)),
        data: text(first(item.data, item.data_hora)),
      })),
    },
  };
}

function normalizeDebitos(data: DebitosBoletoJobData): EngineReport["debitos"] {
  const dados = data?.resultado?.dados;
  return {
    status: text(data?.status),
    pdf: text(dados?.pdf),
    valor: typeof data?.resultado?.consulta?.valor === "number" ? data.resultado.consulta.valor : null,
    msg: text(data?.resultado?.msg),
  };
}

function normalizeAcerta(data: EngineAcertaData): EngineReport["score"] {
  const primeiro = data?.dados?.[0];
  const consulta = primeiro?.acertaEssencialPositivo?.consultaCredito;
  if (!consulta) return null;
  return {
    score: text(consulta.score?.score),
    probabilidade: text(consulta.score?.probabilidade),
    mensagem: text(consulta.score?.mensagem),
    nome: text(consulta.dadosCadastrais?.nome),
    situacao: text(consulta.dadosCadastrais?.situacao),
    renda: text(consulta.dadosCadastrais?.rendaPresumida),
  };
}

type EngineAcertaData = {
  dados?: Array<{
    acertaEssencialPositivo?: {
      consultaCredito?: {
        score?: { score?: string; probabilidade?: string; mensagem?: string };
        dadosCadastrais?: {
          nome?: string;
          situacao?: string;
          rendaPresumida?: string;
          cpf?: string;
        };
      };
    };
  }>;
};

function inputCpf(
  lookupType: LookupType,
  lookupValue: string,
  vehicle: Record<string, unknown>,
): string {
  if (lookupType === "renavam") {
    const proprietario = asRecord(vehicle.proprietario) as { documento?: unknown };
    const digitsOnly = digits(proprietario.documento);
    if (digitsOnly) return digitsOnly;
  }
  return digits(lookupValue);
}

/* =====================================================================
   HELPERS
   ===================================================================== */

function addCost(current: number | null, addition: number | null): number | null {
  if (addition === null) return current;
  return Math.round(((current ?? 0) + addition) * 1000) / 1000;
}

function message(error: unknown): string {
  if (error instanceof InsufficientBalanceError) {
    return "Saldo insuficiente na APIBrasil. Recarregue para continuar.";
  }
  if (error instanceof ApiBrasilCreditsError) return error.message;
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

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeFipe(value: unknown): EngineReport["fipe"] {
  const source = asRecord(unwrap(value));
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
        valor: parseBrMoney(first(source.valor, source.valor_original)),
        valorDevido: parseBrMoney(first(source.valor_devido, source.valor)),
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
