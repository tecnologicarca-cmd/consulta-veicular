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
  type ConsultationSource,
  type ConsultationStatus,
  type LookupType,
  type ServiceSelection,
} from "@/lib/vehicles";
import { executeConsultation } from "@/lib/consultation-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "arca_visitor";
const REQUEST_WINDOW_MS = 60_000;
const REQUEST_LIMIT = 25;
const MAX_IDENTIFIERS = 10;
const requestWindows = new Map<string, { count: number; startsAt: number }>();

type NormalizedIdentifier = { type: LookupType; value: string };
type UnknownRecord = Record<string, unknown>;

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

  const results = await Promise.all(
    identifiers.map(async (identifier) => {
      try {
        const report = await executeConsultation(identifier.type, identifier.value, services);
        return { ok: true as const, report };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "Falha ao consultar.",
        };
      }
    }),
  );

  const reports = results.flatMap((result) => (result.ok ? [result.report] : []));
  const failures = results.flatMap((result) => (result.ok ? [] : [result.error]));

  await Promise.all(
    results.map(async (result) => {
      const status: ConsultationStatus = !result.ok
        ? "error"
        : result.report.warnings.length > 0
          ? "partial"
          : "success";
      const source: ConsultationSource = !result.ok
        ? "unavailable"
        : result.report.sources.some((item) => item.startsWith("APIBrasil"))
          ? result.report.sources.some((item) => item.startsWith("Tabela FIPE oficial"))
            ? "mixed"
            : "apibrasil"
          : "public";
      await saveHistory({
        visitorId,
        lookupType,
        searchValue: result.ok ? result.report.lookupValue : identifiers[0].value,
        plate: result.ok ? result.report.plate : null,
        services,
        status,
        source,
        durationMs: Date.now() - startedAt,
      });
    }),
  );

  if (reports.length === 0) {
    const response = NextResponse.json(
      { ok: false, error: failures[0] ?? "Nenhuma consulta retornou dados." },
      { status: 502 },
    );
    attachVisitorCookie(response, visitorId, isNew);
    return response;
  }

  const response = NextResponse.json({ ok: true, data: { reports } });
  attachVisitorCookie(response, visitorId, isNew);
  return response;
}

function normalizeIdentifiers(input: UnknownRecord, type: LookupType): NormalizedIdentifier[] {
  const source = Array.isArray(input.identificadores)
    ? input.identificadores
    : [input.valor ?? input.identificador ?? input.placa ?? input.renavam];
  const values = source.flatMap((value) => (typeof value === "string" ? value.split(/[\n,;]+/) : []));
  const normalized = values
    .map((value) =>
      type === "renavam"
        ? { type, value: normalizeRenavam(value) }
        : { type, value: normalizePlate(value) },
    )
    .filter((item) => item.value.length > 0);

  const seen = new Set<string>();
  return normalized.filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return type === "renavam" ? isValidRenavam(item.value) : isValidPlate(item.value);
  });
}

function normalizeServices(value: unknown): ServiceSelection {
  const input = asRecord(value);
  return Object.fromEntries(
    optionalServices.map((service) => [service, input[service] === true]),
  ) as ServiceSelection;
}

function consumeRequest(request: Request): boolean {
  const address =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
  const previous = requestWindows.get(address);
  if (!previous || now - previous.startsAt > REQUEST_WINDOW_MS) {
    requestWindows.set(address, { count: 1, startsAt: now });
    if (requestWindows.size > 2_000) {
      for (const [key, item] of requestWindows) {
        if (now - item.startsAt > REQUEST_WINDOW_MS) requestWindows.delete(key);
      }
    }
    return true;
  }
  if (previous.count >= REQUEST_LIMIT) return false;
  previous.count += 1;
  return true;
}

async function getVisitor(): Promise<{ visitorId: string; isNew: boolean }> {
  const jar = await cookies();
  const existing = jar.get(COOKIE_NAME)?.value;
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
    return { visitorId: existing, isNew: false };
  }
  return { visitorId: randomUUID(), isNew: true };
}

function attachVisitorCookie(response: NextResponse, visitorId: string, isNew: boolean): void {
  if (!isNew) return;
  response.cookies.set(COOKIE_NAME, visitorId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}

async function saveHistory(input: {
  visitorId: string;
  lookupType: LookupType;
  searchValue: string;
  plate: string | null;
  services: ServiceSelection;
  status: ConsultationStatus;
  source: ConsultationSource;
  durationMs: number;
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

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}
