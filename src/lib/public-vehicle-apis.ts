import { getAlternatePlateFormat, normalizePlate, type FipeSummary, type VehicleSummary } from "@/lib/vehicles";

type RecordValue = Record<string, unknown>;
type FipeKind = "cars" | "motorcycles" | "trucks";

const FIPE_API_BASE = "https://fipe.parallelum.com.br/api/v2";
const fetchCache = new Map<string, { expiresAt: number; value: unknown }>();

export interface PublicPlateResult {
  vehicle: VehicleSummary;
  reportedFipe: FipeSummary | null;
  fipeCode: string | null;
  fipeKind: FipeKind;
}

export interface PublicFipeResult {
  fipe: FipeSummary | null;
  source: string | null;
  warning: string | null;
}

export class PublicLookupError extends Error {
  retryWithAlternateFormat: boolean;

  constructor(message: string, retryWithAlternateFormat = false) {
    super(message);
    this.name = "PublicLookupError";
    this.retryWithAlternateFormat = retryWithAlternateFormat;
  }
}

export function getPublicPlateApiUrl(): string | null {
  if (process.env.DISABLE_PUBLIC_PLATE_API === "true") return null;
  return process.env.PUBLIC_PLATE_API_URL?.trim() || null;
}

export async function lookupPublicPlate(plate: string): Promise<PublicPlateResult> {
  const canonicalPlate = normalizePlate(plate);
  const cached = fetchCache.get(canonicalPlate);
  if (cached && cached.expiresAt > Date.now()) return cached.value as PublicPlateResult;

  const endpoint = getPublicPlateApiUrl();
  if (!endpoint) {
    throw new PublicLookupError(
      "Nenhum provedor público de placa configurado neste servidor. Use a APIBrasil ou configure PUBLIC_PLATE_API_URL.",
    );
  }

  const candidates = [canonicalPlate, getAlternatePlateFormat(canonicalPlate)].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
  );
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const result = await requestPublicPlate(endpoint, candidate);
      fetchCache.set(canonicalPlate, { expiresAt: Date.now() + 5 * 60_000, value: result });
      if (fetchCache.size > 400) {
        for (const [key, item] of fetchCache) {
          if (item.expiresAt <= Date.now()) fetchCache.delete(key);
        }
      }
      return result;
    } catch (error) {
      lastError = error;
      if (!(error instanceof PublicLookupError) || !error.retryWithAlternateFormat) break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new PublicLookupError("A API pública não encontrou dados para a placa.");
}

async function requestPublicPlate(endpoint: string, plate: string): Promise<PublicPlateResult> {
  const hasPlatePlaceholder = /\{placa\}|:placa/i.test(endpoint);
  let url: URL;
  try {
    url = new URL(endpoint.replace(/\{placa\}|:placa/gi, encodeURIComponent(plate)));
  } catch {
    throw new PublicLookupError("O endereço da fonte pública de placa não está configurado corretamente.");
  }
  if (url.protocol !== "https:") {
    throw new PublicLookupError("A fonte pública de placa deve usar HTTPS.");
  }

  const configuredMethod = (process.env.PUBLIC_PLATE_API_METHOD || "POST").trim().toUpperCase();
  const method = hasPlatePlaceholder ? "GET" : configuredMethod;
  if (method !== "GET" && method !== "POST") {
    throw new PublicLookupError("PUBLIC_PLATE_API_METHOD deve ser GET ou POST.");
  }
  if (method === "GET" && !hasPlatePlaceholder && !url.searchParams.has("placa")) {
    url.searchParams.set("placa", plate);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      ...(method === "POST" ? { body: JSON.stringify({ placa: plate }) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new PublicLookupError("A API pública de placa não respondeu a tempo.");
    }
    throw new PublicLookupError("Não foi possível acessar a API pública de placa.");
  }

  const raw = await response.text().catch(() => "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    if (response.status === 404 || response.status === 422) {
      throw new PublicLookupError("Placa não encontrada neste formato.", true);
    }
    if (response.status === 429) {
      throw new PublicLookupError("Limite da API pública atingido. Aguarde e tente novamente.");
    }
    throw new PublicLookupError("A API pública retornou uma resposta inválida.");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new PublicLookupError("A fonte configurada exige uma credencial ou recusou a requisição.");
    }
    if (response.status === 404 || response.status === 422) {
      throw new PublicLookupError("Placa não encontrada neste formato.", true);
    }
    if (response.status === 429) {
      throw new PublicLookupError("Limite da API pública atingido. Aguarde e tente novamente.");
    }
    throw new PublicLookupError(`A API pública respondeu HTTP ${response.status}.`);
  }

  const root = asRecord(unwrap(parsed));
  if (root.success === false || root.status === "error" || root.erro) {
    throw new PublicLookupError("A API pública não encontrou a placa informada.", true);
  }

  const vehicleSource = findVehicle(root);
  const vehicle = normalizePublicVehicle(vehicleSource, plate);
  if (!vehicle.marcaModelo && !vehicle.marca && !vehicle.modelo && !vehicle.anoModelo) {
    throw new PublicLookupError("A API respondeu sem dados de veículo.", true);
  }

  const fipeCandidates = collectFipeCandidates(root);
  const reportedFipe = fipeCandidates
    .map(normalizeFipeCandidate)
    .filter((candidate): candidate is FipeSummary => candidate !== null)
    .sort((left, right) => fipeScore(right) - fipeScore(left))[0] ?? null;
  const fipeCode =
    reportedFipe?.codigoFipe ??
    fipeCandidates
      .map((item) => asRecord(item))
      .map((item) => text(first(item.codigo_fipe, item.codigoFipe, item.codeFipe, item.codigo)))
      .find((item): item is string => item !== null) ??
    null;

  return {
    vehicle,
    reportedFipe,
    fipeCode,
    fipeKind: guessFipeKind(root, vehicle),
  };
}

/**
 * Intelligent free FIPE resolver:
 * Uses brand, model, and year returned by APIBrasil (or public plate)
 * to automatically fetch the official market valuation from the free Parallelum FIPE v2 API.
 * This completely avoids paid FIPE requests to APIBrasil!
 */
export async function lookupPublicFipeForVehicle(vehicle: VehicleSummary): Promise<PublicFipeResult> {
  const brandName = vehicle.marca || "";
  const modelName = vehicle.modelo || vehicle.marcaModelo || "";
  const year = vehicle.anoModelo || vehicle.anoFabricacao || "";
  const kind = guessFipeKind({}, vehicle);

  try {
    const fipe = await resolveFipeSmart(kind, brandName, modelName, year, vehicle.combustivel);
    if (fipe) {
      return {
        fipe,
        source: "Tabela FIPE oficial (gratuita via inteligência de Marca/Modelo/Ano)",
        warning: null,
      };
    }
  } catch {
    // Graceful fallback
  }

  return {
    fipe: null,
    source: null,
    warning: brandName || modelName
      ? "Não foi possível localizar o modelo exato na referência FIPE atual gratuita."
      : "Dados insuficientes de fabricante/modelo para consultar a FIPE gratuita.",
  };
}

export async function lookupPublicFipe(lookup: PublicPlateResult): Promise<PublicFipeResult> {
  const { vehicle, reportedFipe, fipeCode, fipeKind } = lookup;
  try {
    if (fipeCode) {
      const direct = await queryFipeByCode(fipeKind, fipeCode, vehicle.anoModelo, firstText(reportedFipe?.combustivel, vehicle.combustivel));
      if (direct) {
        return {
          fipe: direct,
          source: "Tabela FIPE oficial (gratuita via código FIPE)",
          warning: null,
        };
      }
    }
  } catch {
    // Continue
  }

  // Next try smart vehicle resolver
  const smart = await lookupPublicFipeForVehicle(vehicle);
  if (smart.fipe) return smart;

  if (reportedFipe) {
    return {
      fipe: reportedFipe,
      source: "Referência FIPE retornada no cadastro do veículo",
      warning: "Verifique o mês de referência antes de utilizar este valor.",
    };
  }

  return {
    fipe: null,
    source: null,
    warning: "Referência FIPE não localizada automaticamente.",
  };
}

async function resolveFipeSmart(
  kind: FipeKind,
  brandInput: string,
  modelInput: string,
  yearInput: string,
  fuelInput: string | null,
): Promise<FipeSummary | null> {
  if (!brandInput && !modelInput) return null;

  const brandNorm = normalize(brandInput)
    .replace(/^vw\b/, "volkswagen")
    .replace(/^gm\b/, "chevrolet");
  const modelClean = normalize(modelInput)
    .replace(/^(vw|volkswagen|fiat|ford|gm|chevrolet|toyota|honda|renault|hyundai|jeep|nissan|peugeot|citroen|mitsubishi)\s+/, "");
  const modelWords = modelClean.split(" ").filter((w) => w.length >= 2);
  const primaryModel = modelWords[0] || "";
  const yearStr = String(yearInput || "").slice(0, 4);

  const brands = toArray(await fipeGet(`${kind}/brands`, 24 * 60 * 60)).map(asRecord);
  const brand = brands.find((b) => {
    const n = normalize(String(b.name || ""));
    return (
      n.includes(brandNorm) ||
      brandNorm.includes(n) ||
      (brandNorm.includes("volkswagen") && n.includes("volkswagen")) ||
      (brandNorm.includes("chevrolet") && n.includes("chevrolet"))
    );
  });
  if (!brand) return null;

  const brandCode = String(brand.code ?? brand.id);
  const models = toArray(await fipeGet(`${kind}/brands/${brandCode}/models`, 24 * 60 * 60)).map(asRecord);

  // Score candidate models
  type ScoredModel = RecordValue & { score: number; code?: unknown; name?: unknown; id?: unknown };
  const scored: ScoredModel[] = models
    .map((m) => {
      const mn = normalize(String(m.name || ""));
      let score = 0;
      if (primaryModel && mn.includes(primaryModel)) score += 60;
      for (const w of modelWords) {
        if (mn.includes(w)) score += 8;
      }
      return { ...m, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  // Check top 8 candidate models for the matching year
  const expectedFuel = normalize(fuelInput ?? "");
  for (const cand of scored.slice(0, 8)) {
    const candCode = String(cand.code ?? cand.id);
    const years = toArray(await fipeGet(`${kind}/brands/${brandCode}/models/${candCode}/years`, 24 * 60 * 60)).map(asRecord);

    let matchYear = years.find((y) => yearStr && String(y.code || "").startsWith(yearStr));
    if (matchYear && expectedFuel) {
      const fuelMatch = years.find(
        (y) =>
          String(y.code || "").startsWith(yearStr) &&
          normalize(String(y.name || "")).includes(expectedFuel),
      );
      if (fuelMatch) matchYear = fuelMatch;
    }

    if (matchYear) {
      const yearCode = String(matchYear.code ?? matchYear.id);
      const detail = asRecord(unwrap(await fipeGet(`${kind}/brands/${brandCode}/models/${candCode}/years/${encodeURIComponent(yearCode)}`, 12 * 60 * 60)));
      const parsed = normalizeFipeCandidate(detail);
      if (parsed?.valor) {
        return {
          ...parsed,
          marca: String(brand.name || parsed.marca || brandInput),
          modelo: String(cand.name || parsed.modelo || modelInput),
        };
      }
    }
  }

  return null;
}

async function queryFipeByCode(
  kind: FipeKind,
  code: string,
  modelYear: string | null,
  fuel: string | null,
): Promise<FipeSummary | null> {
  const years = await fipeGet(`${kind}/${encodeURIComponent(code)}/years`, 24 * 60 * 60);
  const options = toArray(years).map(asRecord).filter((item) => Object.keys(item).length > 0);
  const year = selectYear(options, modelYear, fuel);
  if (!year) return null;
  const yearCode = text(first(year.code, year.id));
  if (!yearCode) return null;
  const detail = await fipeGet(`${kind}/${encodeURIComponent(code)}/years/${encodeURIComponent(yearCode)}`, 12 * 60 * 60);
  const parsed = normalizeFipeCandidate(unwrap(detail));
  return parsed ? { ...parsed, codigoFipe: parsed.codigoFipe ?? code } : null;
}

async function fipeGet(path: string, revalidateSeconds: number): Promise<unknown> {
  const url = `${FIPE_API_BASE}/${path}`;
  const cached = fetchCache.get(`fipe:${url}`);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    next: { revalidate: revalidateSeconds },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("A API FIPE pública não respondeu.");
  const body: unknown = await response.json();
  fetchCache.set(`fipe:${url}`, { expiresAt: Date.now() + revalidateSeconds * 1_000, value: body });
  return body;
}

export function normalizeVehicleSummary(value: unknown, fallbackPlate: string | null): VehicleSummary {
  return normalizePublicVehicle(findVehicle(asRecord(unwrap(value))), fallbackPlate);
}

function findVehicle(root: RecordValue): RecordValue {
  const firstLevel = asRecord(first(root.veiculo, root.vehicle, root.veiculoEncontrado, root.dadosVeiculo));
  const outerData = asRecord(root.data);
  const nested = Object.keys(firstLevel).length ? firstLevel : asRecord(first(outerData.veiculo, outerData.vehicle, outerData.dadosVeiculo));
  const extra = asRecord(first(nested.extra, root.extra, outerData.extra));
  return { ...extra, ...nested, ...outerData, ...root };
}

function normalizePublicVehicle(source: RecordValue, fallbackPlate: string | null): VehicleSummary {
  const brand = text(first(source.fabricante, source.marca, source.MARCA, source.brand, source.texto_marca));
  const model = text(first(source.modelo, source.MODELO, source.model, source.SUBMODELO, source.submodelo));
  const yearMade = text(first(source.ano_fabricacao, source.anoFabricacao, source.ano_fab, source.ano));
  const yearModel = text(first(source.ano_modelo, source.anoModelo, source.modelYear, source.yearModel, source.ano_modelo_veiculo, source.ano));
  return {
    placa: text(first(source.placa, source.PLACA, source.placa_modelo_novo, source.placaModeloNovo)) ?? fallbackPlate,
    renavam: digits(first(source.renavam, source.RENAVAM)),
    chassi: text(first(source.chassi, source.CHASSI, source.numero_chassi)),
    motor: text(first(source.numero_motor, source.numeroMotor, source.motor, source.n_motor, source.motorNumber)),
    marca: brand,
    modelo: model,
    marcaModelo: text(first(source.modelo_bruto, source.marcaModelo, source.marca_modelo, source.marca_modelo_veiculo, source.modelo_completo, [brand, model].filter(Boolean).join(" "))),
    anoFabricacao: yearMade,
    anoModelo: yearModel,
    cor: text(first(source.cor, source.color, source.cor_veiculo)),
    combustivel: text(first(source.combustivel, source.tipo_combustivel, source.fuel, source.fuelType)),
    especie: text(first(source.especie, source.s_especie, source.species)),
    tipo: text(first(source.tipo_veiculo, source.tipo, source.tipoVeiculo, source.vehicleType)),
    categoria: text(first(source.categoria, source.category)),
    municipio: text(first(source.cidade, source.municipio, source.city)),
    uf: text(first(source.uf_jurisdicao, source.uf, source.uf_faturado, source.estado, source.state)),
    situacao: text(first(source.situacao, source.situacao_veiculo, source.status)),
    potencia: text(first(source.potencia, source.power)),
    cilindradas: text(first(source.cilindradas, source.cilindrada, source.engineSize)),
    passageiros: text(first(source.quantidade_lugares, source.passageiros, source.quantidade_passageiros, source.quantidade_passageiro, source.passengerCapacity)),
  };
}

function collectFipeCandidates(root: RecordValue): unknown[] {
  const candidates: unknown[] = [];
  const inspect = (value: unknown, depth: number) => {
    if (depth > 4 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 30)) inspect(item, depth + 1);
      return;
    }
    const source = asRecord(value);
    if (Object.keys(source).length === 0) return;
    if (first(source.codigo_fipe, source.codigoFipe, source.codeFipe, source.price, source.valor, source.texto_valor)) {
      candidates.push(source);
      return;
    }
    for (const key of ["fipe", "fipes", "dados", "items", "resultado", "result", "data", "veiculos"]) {
      if (source[key] !== undefined) inspect(source[key], depth + 1);
    }
  };
  inspect(first(root.fipe, root.fipes, root.tabelaFipe, root.fipeDados), 0);
  return candidates;
}

function normalizeFipeCandidate(value: unknown): FipeSummary | null {
  const source = asRecord(unwrap(value));
  if (Object.keys(source).length === 0) return null;
  const price = first(source.valor, source.price, source.preco, source.valor_fipe, source.texto_valor, source.value);
  const code = text(first(source.codigo_fipe, source.codigoFipe, source.codeFipe, source.codigo, source.fipeCode));
  const model = text(first(source.texto_modelo, source.modelo, source.model, source.textoModelo, source.name));
  if (!price && !code && !model) return null;
  return {
    valor: text(price),
    codigoFipe: code,
    marca: text(first(source.texto_marca, source.marca, source.brand)),
    modelo: model,
    anoModelo: text(first(source.ano_modelo, source.anoModelo, source.modelYear, source.year)),
    combustivel: text(first(source.combustivel, source.fuel)),
    mesReferencia: text(first(source.mes_referencia, source.mesReferencia, source.referenceMonth, source.referencia)),
  };
}

function fipeScore(value: FipeSummary): number {
  return Number(value.valor !== null) * 100 + Number(value.codigoFipe !== null) * 30 + Number(value.modelo !== null) * 10;
}

function selectYear(options: RecordValue[], modelYear: string | null, fuel: string | null): RecordValue | null {
  if (options.length === 0) return null;
  const year = modelYear?.match(/\d{4}/)?.[0] ?? null;
  if (!year) return options.length === 1 ? options[0] : null;

  let pool = options.filter((option) => {
    const identity = `${String(option.code ?? "")} ${String(option.id ?? "")} ${String(option.name ?? "")} ${String(option.nome ?? "")}`;
    return new RegExp(`(?:^|\\D)${year}(?:\\D|$)`).test(identity);
  });
  if (pool.length === 0) return null;

  const expectedFuel = normalize(fuel ?? "");
  if (expectedFuel) {
    const byFuel = pool.filter((option) =>
      fuelMatches(expectedFuel, `${String(option.name ?? "")} ${String(option.nome ?? "")} ${String(option.fuel ?? "")}`),
    );
    if (byFuel.length > 0) pool = byFuel;
  }
  return pool[0] ?? null;
}

function fuelMatches(expected: string, candidateValue: string): boolean {
  const candidate = normalize(candidateValue);
  if (candidate.includes(expected)) return true;
  const expectedIsFlex = /flex/.test(expected) || (/alcool|etanol/.test(expected) && /gasolina/.test(expected));
  return expectedIsFlex && /flex|alcool.*gasolina|etanol.*gasolina/.test(candidate);
}

function guessFipeKind(root: RecordValue, vehicle: VehicleSummary): FipeKind {
  const kind = normalize(String(first(root.tipo, root.tipo_veiculo, root.tipoModelo, root.vehicleType, vehicle.tipo, vehicle.especie) ?? ""));
  if (/moto|motocic|scooter|ciclomotor/.test(kind)) return "motorcycles";
  if (/caminh|onibus|micro.?onibus|trator|reboque/.test(kind)) return "trucks";
  return "cars";
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const source = asRecord(value);
  for (const key of ["data", "brands", "models", "years", "items", "marcas", "modelos", "anos"]) {
    if (Array.isArray(source[key])) return source[key] as unknown[];
  }
  return [];
}

function unwrap(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    const source = asRecord(current);
    const nested = source.data ?? source.resultado ?? source.result;
    if (nested === undefined || nested === current) break;
    current = nested;
  }
  return current;
}

function asRecord(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
}

function first(...values: unknown[]): unknown {
  return values.find((value) => value !== null && value !== undefined && value !== "");
}

function firstText(...values: Array<string | null | undefined>): string | null {
  return values.find((value): value is string => Boolean(value?.trim())) ?? null;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) return null;
  const result = String(value).trim();
  return result ? result.slice(0, 240) : null;
}

function digits(value: unknown): string | null {
  const result = String(value ?? "").replace(/\D/g, "");
  return result || null;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
