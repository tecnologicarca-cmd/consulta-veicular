export const optionalServices = [
  "fipe",
  "multas",
  "roubo",
  "leilao",
  "recall",
  "gravame",
  "csv",
  "debitos",
  "crlv",
  "score",
] as const;

export type OptionalService = (typeof optionalServices)[number];
export type ServiceSelection = Record<OptionalService, boolean>;
export type LookupType = "placa" | "renavam";
export type ConsultationStatus = "success" | "partial" | "error" | "unavailable" | "demo";
export type ConsultationSource = "public" | "mixed" | "apibrasil" | "unavailable" | "demo";

export const defaultServiceSelection: ServiceSelection = {
  fipe: false,
  multas: false,
  roubo: false,
  leilao: false,
  recall: false,
  gravame: false,
  csv: false,
  debitos: false,
  crlv: false,
  score: false,
};

export interface VehicleSummary {
  placa: string | null;
  renavam: string | null;
  chassi: string | null;
  motor: string | null;
  marca: string | null;
  modelo: string | null;
  marcaModelo: string | null;
  anoFabricacao: string | null;
  anoModelo: string | null;
  cor: string | null;
  combustivel: string | null;
  especie: string | null;
  tipo: string | null;
  categoria: string | null;
  municipio: string | null;
  uf: string | null;
  situacao: string | null;
  potencia: string | null;
  cilindradas: string | null;
  passageiros: string | null;
}

export interface FipeSummary {
  valor: string | null;
  codigoFipe: string | null;
  marca: string | null;
  modelo: string | null;
  anoModelo: string | null;
  combustivel: string | null;
  mesReferencia: string | null;
}

export interface FineSummary {
  ait: string | null;
  codigo: string | null;
  descricao: string;
  dataHora: string | null;
  local: string | null;
  municipio: string | null;
  orgao: string | null;
  pontos: string | null;
  status: string | null;
  valor: number | null;
  valorDevido: number | null;
  vencimento: string | null;
}

export interface ProviderSection {
  headline: string | null;
  state: "alert" | "clear" | "unknown";
  items: Array<{ label: string; value: string }>;
}

export interface ReportWarning {
  service: string;
  message: string;
}

export interface ConsultationReport {
  mode: ConsultationSource;
  lookupType: LookupType;
  lookupValue: string;
  plate: string | null;
  consultedAt: string;
  durationMs: number;
  services: ServiceSelection;
  sources: string[];
  vehicle: VehicleSummary;
  fipe: FipeSummary | null;
  multas: FineSummary[];
  totalMultas: number;
  rouboFurto: ProviderSection | null;
  leilao: ProviderSection | null;
  recall: ProviderSection | null;
  gravame: ProviderSection | null;
  csvCompleta: {
    bin: {
      marcaModelo: string | null;
      chassi: string | null;
      renavam: string | null;
      municipio: string | null;
      uf: string | null;
      situacao: string | null;
      proprietario: { documento: string | null; nome: string | null } | null;
    } | null;
    restricoes: Array<{ mensagem: string }>;
    renajud: {
      quantidade: string | null;
      ocorrencias: Array<{ processo: string | null; orgao: string | null; tribunal: string | null; data: string | null; restricoes: string | null }>;
    };
    renainf: {
      quantidade: string | null;
      ocorrencias: Array<{ descricao: string | null; valor: string | null; local: string | null; data: string | null }>;
    };
  } | null;
  debitos: { status: string | null; pdf: string | null; valor: number | null; msg: string | null } | null;
  crlv: { pdf: string | null; uf: string | null; consultaId: string | null } | null;
  score: { score: string | null; probabilidade: string | null; mensagem: string | null; nome: string | null; situacao: string | null; renda: string | null } | null;
  warnings: ReportWarning[];
  totalCost: number | null;
  demoNotice?: string;
}

export interface ConsultationHistoryEntry {
  id: number;
  plate: string | null;
  searchType: LookupType;
  searchValue: string;
  services: ServiceSelection;
  status: ConsultationStatus;
  source: ConsultationSource;
  durationMs: number | null;
  createdAt: string;
}

export function normalizePlate(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 7);
}

export function normalizeRenavam(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 11);
}

export function isValidRenavam(value: unknown): boolean {
  const renavam = normalizeRenavam(value);
  return renavam.length === 9 || renavam.length === 11;
}

export type PlateFormat = "antiga" | "mercosul";
export type PlateFormatSelection = "auto" | PlateFormat;

const legacyToMercosulLetter: Record<string, string> = {
  "0": "A", "1": "B", "2": "C", "3": "D", "4": "E",
  "5": "F", "6": "G", "7": "H", "8": "I", "9": "J",
};
const mercosulToLegacyDigit: Record<string, string> = Object.fromEntries(
  Object.entries(legacyToMercosulLetter).map(([digit, letter]) => [letter, digit]),
);

export function isValidPlate(value: unknown): boolean {
  const plate = normalizePlate(value);
  return /^(?:[A-Z]{3}[0-9]{4}|[A-Z]{3}[0-9][A-J][0-9]{2})$/.test(plate);
}

export function getPlateFormat(value: unknown): PlateFormat | null {
  const plate = normalizePlate(value);
  if (/^[A-Z]{3}[0-9]{4}$/.test(plate)) return "antiga";
  if (/^[A-Z]{3}[0-9][A-J][0-9]{2}$/.test(plate)) return "mercosul";
  return null;
}

export function convertPlateFormat(value: unknown, target: PlateFormatSelection): string {
  const plate = normalizePlate(value);
  if (target === "auto") return plate;
  const current = getPlateFormat(plate);
  if (!current || current === target) return plate;
  if (target === "mercosul") {
    const letter = legacyToMercosulLetter[plate[4]];
    return letter ? `${plate.slice(0, 4)}${letter}${plate.slice(5)}` : plate;
  }
  const digit = mercosulToLegacyDigit[plate[4]];
  return digit ? `${plate.slice(0, 4)}${digit}${plate.slice(5)}` : plate;
}

export function getAlternatePlateFormat(value: unknown): string | null {
  const format = getPlateFormat(value);
  if (!format) return null;
  return convertPlateFormat(value, format === "antiga" ? "mercosul" : "antiga");
}
