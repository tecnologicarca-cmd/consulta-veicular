import "server-only";

/**
 * Cliente para os endpoints de CRÉDITOS da APIBrasil.
 *
 * Esta API contraria o comportamento REST comum em pontos que já custaram
 * integrações. O cliente trata cada um deles explicitamente:
 *
 * 1. O erro chega no CORPO com HTTP 200 — a validação é em duas etapas:
 *    status HTTP primeiro, depois o campo `error` do corpo. Os dois precisam passar.
 * 2. `balance`, `tax` e `extra_charges.total` são STRING em formato brasileiro,
 *    e o formato varia entre APIs ("154,380", "0.19", "4.971,310"). Usar
 *    `parseFloat` ou `Number` direto perde os centavos ou devolve NaN em silêncio.
 *    Por isso existe `parseBrMoney`.
 * 3. Cada chamada custa dinheiro — retry cego multiplica a conta. Este cliente
 *    repete APENAS tempo esgotado e 5xx, com recuo exponencial e teto. Nunca 4xx.
 * 4. HTTP 402 é saldo insuficiente e exige ação humana: vira `InsufficientBalanceError`,
 *    um erro terminal separado dos demais.
 * 5. `extra_charges` é cobrado à parte do preço base e vem somado em `totalCost`.
 */

const DEFAULT_BASE_URL = "https://gateway.apibrasil.io/api/v2";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 600;

/* =====================================================================
   CONVERSOR MONETÁRIO
   ===================================================================== */

/**
 * Converte valores monetários em texto para número, aceitando vírgula e ponto
 * como separador decimal em qualquer combinação.
 *
 *   "154,380"   → 154.38     (vírgula decimal)
 *   "497,84"    → 497.84     (vírgula decimal)
 *   "0,000"     → 0          (três casas decimais)
 *   "0.19"      → 0.19       (ponto decimal)
 *   "4.971,310" → 4971.31    (ponto milhar + vírgula decimal)
 *   "1,234,567.89" → 1234567.89 (vírgula milhar + ponto decimal)
 */
export function parseBrMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const cleaned = value.replace(/[R$\s\u00a0]/g, "");
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized: string;
  if (hasComma && hasDot) {
    // O último separador é o decimal; o outro é de milhar.
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  } else {
    normalized = cleaned;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/* =====================================================================
   ERROS
   ===================================================================== */

export type ApiBrasilErrorCode =
  | "AUTHENTICATION"
  | "INSUFFICIENT_BALANCE"
  | "RATE_LIMIT"
  | "VALIDATION"
  | "NOT_FOUND"
  | "PROVIDER_ERROR"
  | "NETWORK"
  | "TIMEOUT"
  | "SERVER";

export interface ApiBrasilErrorDetails {
  status: number;
  code: ApiBrasilErrorCode;
  balance: number | null;
  tax: number | null;
  apiLimitFor: string | null;
  homolog: boolean;
}

/** Erro próprio da API. Carrega `message` e o status — nunca uma string solta. */
export class ApiBrasilCreditsError extends Error {
  readonly status: number;
  readonly code: ApiBrasilErrorCode;
  readonly balance: number | null;
  readonly tax: number | null;
  readonly apiLimitFor: string | null;
  readonly homolog: boolean;

  constructor(message: string, details: ApiBrasilErrorDetails) {
    super(message);
    this.name = "ApiBrasilCreditsError";
    this.status = details.status;
    this.code = details.code;
    this.balance = details.balance;
    this.tax = details.tax;
    this.apiLimitFor = details.apiLimitFor;
    this.homolog = details.homolog;
  }
}

/** HTTP 402: saldo insuficiente. Erro terminal — repetir não resolve. */
export class InsufficientBalanceError extends ApiBrasilCreditsError {
  constructor(message: string, details: ApiBrasilErrorDetails) {
    super(message, { ...details, status: 402, code: "INSUFFICIENT_BALANCE" });
    this.name = "InsufficientBalanceError";
  }
}

/* =====================================================================
   ENVELOPE E RESULTADO
   ===================================================================== */

export interface CreditsEnvelope<TData> {
  status_code: number;
  error: boolean;
  message: string;
  balance?: string | null;
  balance_before?: string | null;
  tax?: string | null;
  valor_consulta?: number | null;
  api_limit_for?: string | null;
  homolog?: boolean;
  data?: TData;
  response?: TData;
  extra_charges?: {
    total?: string | null;
    items?: Array<{ descricao?: string; valor?: string | null }>;
  } | null;
}

export interface CreditsResult<TData> {
  data: TData;
  message: string;
  /** Saldo restante após a consulta, já convertido para número. */
  balance: number | null;
  /** O que esta consulta custou, já convertido para número. */
  tax: number | null;
  /** Custo total: base + extra_charges, já convertido. */
  totalCost: number | null;
  apiLimitFor: string | null;
  homolog: boolean;
}

/* =====================================================================
   TIPOS DE REQUISIÇÃO
   ===================================================================== */

export interface CsvCompletaRequest {
  placa: string;
}

export interface GravameRequest {
  placa: string;
}

export interface CrlvPaRequest {
  placa: string;
  renavam: string;
  cpf: string;
}

export interface DebitosBoletoRequest {
  placa: string;
  renavam?: string;
}

export interface DebitosBoletoJobRequest {
  jobId: string;
}

export interface AcertaEssencialRequest {
  cpf: string;
}

/* =====================================================================
   TIPOS DE RESPOSTA
   ===================================================================== */

export interface CsvStatusRetorno {
  codigo: string;
  descricao: string;
}

export interface CsvBinProprietario {
  documento: string;
  nome: string;
}

export interface CsvBinRestricoes {
  existe_restricao_geral: string;
  existe_restricao_renajud: string;
  existe_restricao_roubo_furto: string;
  mensagens_restricoes: Array<{ mensagem: string }>;
  veiculo_baixado: string;
}

export interface CsvBinNacional {
  alerta_informativo: string;
  ano_fabricacao: string;
  ano_modelo: string;
  caixa_cambio: string;
  capacidade_carga: string;
  categoria_veiculo: string;
  chassi: string;
  cilindrada: string;
  cmt: string;
  combustivel: string;
  cor_veiculo: string;
  especie_veiculo: string;
  logo_fabricante: { imagem_url: string };
  marca_modelo: string;
  municipio: string;
  numero_motor: string;
  placa: string;
  potencia_veiculo: string;
  procedencia: string;
  proprietario: CsvBinProprietario | null;
  quantidade_passageiros: string;
  renavam: string;
  restricoes: CsvBinRestricoes;
  situacao: string;
  status_retorno: CsvStatusRetorno;
  tipo_veiculo: string;
  uf: string;
}

export interface CsvOcorrenciaBase {
  status_retorno: CsvStatusRetorno;
}

export interface CsvRenajudOcorrencia {
  codigo_judicial: string;
  data: string;
  marca_modelo: string;
  orgao_judiciario: string;
  placa: string;
  processo: string;
  renavam: string;
  restricoes: string;
  tribunal: string;
}

export interface CsvCompletaData {
  veicular: {
    bin_nacional: CsvBinNacional;
    comunicado_venda: CsvOcorrenciaBase & {
      ocorrencias: unknown[];
      quantidade_ocorrencias: string;
    };
    csv: {
      mensagem_observacao: string;
      ocorrencias: unknown[];
      quantidade_ocorrencia: string;
      status_retorno: CsvStatusRetorno;
    };
    recall: {
      ano_fabricacao: string;
      ano_modelo: string;
      chassi: string;
      marca_modelo: string;
      placa: string;
      quantidade_ocorrencias: string;
      status_retorno: CsvStatusRetorno;
    };
    renainf: {
      ocorrencias: Array<Record<string, unknown>>;
      qtd_ocorrencias: string;
      status_retorno: CsvStatusRetorno;
    };
    renajud: {
      msg_alerta: string;
      ocorrencias: CsvRenajudOcorrencia[];
      quantidade_ocorrencias: string;
      status_retorno: CsvStatusRetorno;
    };
  };
}

export interface GravameHistoricoItem {
  agentCode: number | null;
  agentDocumentNumber: string | null;
  agentName: string | null;
  contractDate: string | null;
  contractNumber: string | null;
  contractState: string | null;
  financedDocumentNumber: string | null;
  financedName: string | null;
  message: string | null;
  restrictionDate: string | null;
  restrictionNumber: number | null;
  restrictionState: string | null;
  status: string | null;
}

export interface GravameData {
  anofabricacao: string;
  anomodelo: string;
  chassi: string;
  codigofinanceira: string;
  datagravame: string;
  datagravamevigencia: string;
  descricaostatus: string;
  documentofinanceira: string;
  documentoproprietarioatual: string;
  financeiranome: string;
  historico: GravameHistoricoItem[];
  nomefinanciado: string;
  numerocontrato: string;
  placa: string;
  renavam: string;
  statusdoveiculo: string;
  ufgravame: string;
  ufplaca: string;
}

export interface CrlvPaData {
  consulta_id: string;
  tipo: string;
  uf: string;
  placa: string;
  pdf: string;
  status_retorno: CsvStatusRetorno;
}

export interface DebitosBoletoData {
  consulta_id: string;
  placa: string;
  pdf: string;
}

export interface DebitosBoletoJobData {
  "job-id": string;
  status: string;
  resultado: {
    status: boolean;
    consulta: {
      debitado: boolean;
      id: number;
      valor: number;
    };
    dados: DebitosBoletoData | null;
    msg: string;
  };
}

export interface AcertaDadosCadastrais {
  bairro: string;
  cep: string;
  cidade: string;
  cpf: string;
  dataNascimento: string;
  endereco: string;
  estadoCivil: string;
  grauInstrucao: string;
  nome: string;
  nomeMae: string;
  numeroDependentes: string;
  regiaoCPF: string;
  rendaPresumida: string;
  sexo: string;
  situacao: string;
  telefone: string;
  uf: string;
}

export interface AcertaScore {
  decisao: number;
  mensagem: string;
  probabilidade: string;
  score: string;
}

export interface AcertaConsultaCredito {
  dadosCadastrais: AcertaDadosCadastrais;
  score: AcertaScore;
  pendenciasFinanceiras: unknown[];
  protestos: unknown[];
  acoesCiveis: unknown[];
  chequesSemFundo: unknown[];
  chequesSustados: unknown[];
}

export interface AcertaEssencialData {
  dados: Array<{
    acertaEssencialPositivo: {
      consultaCredito: AcertaConsultaCredito;
      prioridade: number;
      providerId: number;
      statusRetorno: number;
    };
    resumoRetorno: {
      codigoConsulta: number;
      dataConsulta: string;
      document: string;
      protocolo: string;
      tempoExecucao: number;
    };
  }>;
  homolog: boolean;
  msg: string;
  status: boolean;
}

/* =====================================================================
   TRANSPORTE
   ===================================================================== */

export interface CreditsTransportRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface CreditsTransportResponse {
  status: number;
  body: unknown;
}

export interface CreditsTransport {
  send(request: CreditsTransportRequest): Promise<CreditsTransportResponse>;
}

/** Transporte padrão com `fetch` nativo e tempo-limite explícito. */
export class FetchCreditsTransport implements CreditsTransport {
  async send(request: CreditsTransportRequest): Promise<CreditsTransportResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      cache: "no-store",
      signal: AbortSignal.timeout(request.timeoutMs),
    });

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = { status_code: response.status, error: true, message: text.slice(0, 500) };
      }
    }
    return { status: response.status, body };
  }
}

/* =====================================================================
   CLIENTE
   ===================================================================== */

export interface CreditsClientConfig {
  bearerToken: string;
  baseUrl?: string;
  transport?: CreditsTransport;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  /** Padrão de homologação. Vem de APIBRASIL_HOMOLOG quando não informado. */
  homolog?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

export class ApiBrasilCreditsClient {
  private readonly bearerToken: string;
  private readonly baseUrl: string;
  private readonly transport: CreditsTransport;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly defaultHomolog: boolean;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: CreditsClientConfig) {
    if (!config.bearerToken?.trim()) {
      throw new ApiBrasilCreditsError("Bearer Token não informado.", {
        status: 0,
        code: "AUTHENTICATION",
        balance: null,
        tax: null,
        apiLimitFor: null,
        homolog: false,
      });
    }
    this.bearerToken = config.bearerToken.trim();
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.transport = config.transport ?? new FetchCreditsTransport();
    this.timeoutMs = Math.min(30_000, Math.max(10_000, config.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    this.maxRetries = Math.max(0, config.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.backoffMs = config.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.defaultHomolog = config.homolog ?? readHomologFromEnv();
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * `CSV Completa` — RENAINF + RENAJUD + BIN nacional + comunicado de venda +
   * recall + CSV, em uma única chamada.
   */
  csvCompleta(
    input: CsvCompletaRequest,
    options: { homolog?: boolean } = {},
  ): Promise<CreditsResult<CsvCompletaData>> {
    return this.execute<CsvCompletaData>(
      "/consulta/veiculos/credits",
      { tipo: "csv-renainf-renajud-bin-proprietario", placa: input.placa },
      options,
    );
  }

  /** `Gravame` — alienação fiduciária e histórico de financiamento. */
  gravame(
    input: GravameRequest,
    options: { homolog?: boolean } = {},
  ): Promise<CreditsResult<GravameData>> {
    return this.execute<GravameData>(
      "/consulta/veiculos/credits",
      { tipo: "gravame", placa: input.placa },
      options,
    );
  }

  /** `Documento CRLV PA` — devolve a URL do PDF do documento. */
  crlvPa(
    input: CrlvPaRequest,
    options: { homolog?: boolean } = {},
  ): Promise<CreditsResult<CrlvPaData>> {
    return this.execute<CrlvPaData>(
      "/consulta/veiculos/credits",
      { tipo: "documento-crlv-pa", placa: input.placa, renavam: input.renavam, cpf: input.cpf },
      options,
    );
  }

  /** `Consultar Débitos Boleto` — dispara a consulta assíncrona. */
  debitosBoleto(
    input: DebitosBoletoRequest,
    options: { homolog?: boolean } = {},
  ): Promise<CreditsResult<{ "job-id"?: string; status?: string }>> {
    const body: Record<string, unknown> = { tipo: "consultar-debitos-boleto", placa: input.placa };
    if (input.renavam) body.renavam = input.renavam;
    return this.execute<{ "job-id"?: string; status?: string }>(
      "/consulta/veiculos/credits",
      body,
      options,
    );
  }

  /** `Consultar Débitos Boleto Assíncrona` — consulta o resultado pelo job-id. */
  debitosBoletoJob(
    input: DebitosBoletoJobRequest,
    options: { homolog?: boolean } = {},
  ): Promise<CreditsResult<DebitosBoletoJobData>> {
    return this.execute<DebitosBoletoJobData>(
      "/consulta/veiculos/credits",
      { tipo: "consultar-chave-consultar-debitos-boleto", "job-id": input.jobId },
      options,
    );
  }

  /** `Acerta Essencial Plus` — score e dados cadastrais por CPF. */
  acertaEssencial(
    input: AcertaEssencialRequest,
    options: { homolog?: boolean } = {},
  ): Promise<CreditsResult<AcertaEssencialData>> {
    return this.execute<AcertaEssencialData>(
      "/consulta/cpf/credits",
      { cpf: input.cpf, tipo: "acerta-essencial-positivo" },
      options,
    );
  }

  /**
   * Núcleo da chamada. A validação é em DUAS etapas e as duas precisam passar:
   * primeiro o status HTTP, depois o campo `error` do corpo.
   */
  private async execute<TData>(
    path: string,
    body: Record<string, unknown>,
    options: { homolog?: boolean },
  ): Promise<CreditsResult<TData>> {
    const homolog = options.homolog ?? this.defaultHomolog;
    const payload = { ...body, homolog };
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this.bearerToken}`,
    };
    const url = `${this.baseUrl}${path}`;
    const serialized = JSON.stringify(payload);

    let attempt = 0;
    for (;;) {
      try {
        const { status, body: raw } = await this.transport.send({
          url,
          method: "POST",
          headers,
          body: serialized,
          timeoutMs: this.timeoutMs,
        });

        // ---- ETAPA 1: status HTTP ----
        if (status === 402) {
          throw new InsufficientBalanceError(
            extractMessage(raw) ?? "Saldo insuficiente na APIBrasil. Recarregue para continuar.",
            envelopeDetails(raw),
          );
        }
        // 4xx nunca é repetido: parâmetro errado repetido continua errado e continua cobrando.
        if (status >= 400 && status < 500 && status !== 408) {
          throw new ApiBrasilCreditsError(
            extractMessage(raw) ?? `A APIBrasil recusou a requisição (HTTP ${status}).`,
            envelopeDetails(raw, status),
          );
        }
        // Repete apenas 5xx e 408, com recuo exponencial e teto.
        if ((status >= 500 || status === 408) && attempt < this.maxRetries) {
          await this.sleep(this.backoffMs * 2 ** attempt);
          attempt += 1;
          continue;
        }
        if (status >= 500) {
          throw new ApiBrasilCreditsError(
            extractMessage(raw) ?? `A APIBrasil está indisponível (HTTP ${status}).`,
            envelopeDetails(raw, status),
          );
        }

        // ---- ETAPA 2: campo `error` do corpo ----
        const envelope = asRecord(raw) as unknown as CreditsEnvelope<TData>;
        if (envelope.error === true) {
          throw new ApiBrasilCreditsError(
            extractMessage(raw) ?? "A APIBrasil retornou erro no corpo da resposta.",
            envelopeDetails(raw, status),
          );
        }

        const data = (envelope.data ?? envelope.response) as TData;
        const tax = parseBrMoney(envelope.tax);
        const extraCharges = parseBrMoney(envelope.extra_charges?.total);
        return {
          data,
          message: extractMessage(raw) ?? "",
          balance: parseBrMoney(envelope.balance),
          tax,
          totalCost: tax !== null ? tax + (extraCharges ?? 0) : null,
          apiLimitFor: text(envelope.api_limit_for),
          homolog: envelope.homolog ?? homolog,
        };
      } catch (error) {
        const isRetryable =
          (error instanceof Error && error.name === "TimeoutError") ||
          (error instanceof Error && error.name === "TypeError" && error.message.includes("fetch"));
        if (isRetryable && attempt < this.maxRetries) {
          await this.sleep(this.backoffMs * 2 ** attempt);
          attempt += 1;
          continue;
        }
        if (error instanceof ApiBrasilCreditsError) throw error;
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new ApiBrasilCreditsError("A APIBrasil demorou para responder.", {
            status: 0,
            code: "TIMEOUT",
            balance: null,
            tax: null,
            apiLimitFor: null,
            homolog,
          });
        }
        throw new ApiBrasilCreditsError(
          error instanceof Error ? error.message : "Falha de comunicação com a APIBrasil.",
          { status: 0, code: "NETWORK", balance: null, tax: null, apiLimitFor: null, homolog },
        );
      }
    }
  }
}

/* =====================================================================
   FÁBRICA
   ===================================================================== */

export function createCreditsClientFromEnv(): ApiBrasilCreditsClient | null {
  const bearer = (
    process.env.APIBRASIL_BEARER_TOKEN || process.env.APIBRASIL_BEARER || ""
  ).trim();
  if (!bearer) return null;
  return new ApiBrasilCreditsClient({
    bearerToken: bearer,
    baseUrl: process.env.APIBRASIL_BASE_URL,
  });
}

export function readHomologFromEnv(): boolean {
  const value = (process.env.APIBRASIL_HOMOLOG ?? "").trim().toLowerCase();
  return value === "true" || value === "1";
}

/* =====================================================================
   HELPERS
   ===================================================================== */

function envelopeDetails(raw: unknown, status = 200): ApiBrasilErrorDetails {
  const envelope = asRecord(raw) as unknown as CreditsEnvelope<unknown>;
  return {
    status,
    code: codeForStatus(status),
    balance: parseBrMoney(envelope.balance),
    tax: parseBrMoney(envelope.tax),
    apiLimitFor: text(envelope.api_limit_for),
    homolog: envelope.homolog ?? false,
  };
}

function codeForStatus(status: number): ApiBrasilErrorCode {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 402) return "INSUFFICIENT_BALANCE";
  if (status === 404) return "NOT_FOUND";
  if (status === 408 || status === 0) return "TIMEOUT";
  if (status === 429) return "RATE_LIMIT";
  if (status >= 500) return "SERVER";
  return "VALIDATION";
}

function extractMessage(raw: unknown): string | null {
  const record = asRecord(raw);
  const inner = asRecord(record.response);
  return text(first(record.message, record.msg, inner.message, inner.msg, record.error)) ?? null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function first(...values: unknown[]): unknown {
  return values.find((value) => value !== null && value !== undefined && value !== "");
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 400) : null;
}
