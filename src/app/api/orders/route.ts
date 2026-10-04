import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { consultationOrders } from "@/db/schema";
import {
  isValidPlate,
  isValidRenavam,
  normalizePlate,
  normalizeRenavam,
  optionalServices,
  type LookupType,
  type ServiceSelection,
} from "@/lib/vehicles";
import { calculatePrice, getBusinessSettings } from "@/lib/pricing";
import { generatePixCode } from "@/lib/pix";
import { createPixCharge } from "@/lib/mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "arca_visitor";
const ORDER_EXPIRY_MINUTES = 30;

export async function POST(request: Request) {
  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const record = input ?? {};
  const lookupType: LookupType = record.lookupType === "renavam" ? "renavam" : "placa";
  const rawValue = String(record.lookupValue ?? "");
  const lookupValue = lookupType === "renavam" ? normalizeRenavam(rawValue) : normalizePlate(rawValue);
  const valid = lookupType === "renavam" ? isValidRenavam(lookupValue) : isValidPlate(lookupValue);

  if (!valid) {
    return NextResponse.json({ ok: false, error: "Identificador inválido." }, { status: 400 });
  }

  const services = Object.fromEntries(
    optionalServices.map((service) => [
      service,
      (record.services as ServiceSelection | undefined)?.[service] === true,
    ]),
  ) as ServiceSelection;

  const [price, settings] = await Promise.all([calculatePrice(services), getBusinessSettings()]);

  if (!settings) {
    return NextResponse.json({ ok: false, error: "Pagamento não configurado." }, { status: 400 });
  }

  const { visitorId, isNew } = await getVisitor();
  const txId = `ARCA${Date.now()}${randomUUID().slice(0, 8).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + ORDER_EXPIRY_MINUTES * 60_000);

  const payerEmail = typeof record.payerEmail === "string" && record.payerEmail.includes("@")
    ? record.payerEmail.trim().slice(0, 120)
    : `cliente_${visitorId.slice(0, 8)}@arca.consultas`;

  let pixCode: string;
  let pixTxId: string | null = txId;
  let paymentProvider = settings.pixProvider;
  let providerPaymentId: string | null = null;
  let qrCodeBase64: string | null = null;

  if (settings.pixProvider === "mercadopago" && settings.mpAccessToken) {
    try {
      const notificationUrl = `${new URL(request.url).origin}/api/webhooks/mercadopago`;
      const charge = await createPixCharge({
        accessToken: settings.mpAccessToken,
        amountCents: price.totalCents,
        description: `Consulta veicular ${lookupValue}`,
        externalReference: txId,
        notificationUrl,
        payerEmail,
        expirationMinutes: ORDER_EXPIRY_MINUTES,
      });
      pixCode = charge.qrCode;
      providerPaymentId = charge.paymentId;
      qrCodeBase64 = charge.qrCodeBase64;
      if (charge.expiration) expiresAt.setTime(new Date(charge.expiration).getTime());
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao gerar cobrança no Mercado Pago.",
        },
        { status: 502 },
      );
    }
  } else if (settings.pixKey) {
    pixCode = generatePixCode({
      key: settings.pixKey,
      keyType: settings.pixKeyType as "cpf" | "cnpj" | "email" | "phone" | "random",
      amount: price.totalCents / 100,
      merchantName: settings.merchantName,
      merchantCity: settings.merchantCity,
      txId,
    });
    paymentProvider = "manual";
  } else {
    return NextResponse.json(
      { ok: false, error: "Pagamento não configurado. Fale com o administrador." },
      { status: 400 },
    );
  }

  let order: { id: number };
  try {
    const result = await db
      .insert(consultationOrders)
      .values({
        visitorId,
        lookupType,
        lookupValue,
        services,
        costCents: price.costCents,
        priceCents: price.totalCents,
        status: "pending",
        pixCode,
        pixTxId,
        pixProvider: paymentProvider,
        providerPaymentId,
        qrCodeBase64,
        payerEmail,
        expiresAt,
      })
      .returning({ id: consultationOrders.id });
    order = result[0];
  } catch {
    return NextResponse.json(
      { ok: false, error: "Não foi possível registrar o pedido. Tente novamente em instantes." },
      { status: 503 },
    );
  }

  const response = NextResponse.json({
    ok: true,
    data: {
      id: order.id,
      txId,
      pixCode,
      qrCodeBase64,
      amountCents: price.totalCents,
      expiresAt: expiresAt.toISOString(),
      provider: paymentProvider,
    },
  });
  if (isNew) attachVisitorCookie(response, visitorId);
  return response;
}

export async function GET() {
  const jar = await cookies();
  const visitorId = jar.get(COOKIE_NAME)?.value;
  if (!visitorId || !process.env.DATABASE_URL) return NextResponse.json({ items: [] });

  try {
    const items = await db
      .select()
      .from(consultationOrders)
      .where(eq(consultationOrders.visitorId, visitorId))
      .orderBy(desc(consultationOrders.createdAt))
      .limit(20);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Falha ao carregar pedidos." }, { status: 500 });
  }
}

async function getVisitor(): Promise<{ visitorId: string; isNew: boolean }> {
  const jar = await cookies();
  const existing = jar.get(COOKIE_NAME)?.value;
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
    return { visitorId: existing, isNew: false };
  }
  return { visitorId: randomUUID(), isNew: true };
}

function attachVisitorCookie(response: NextResponse, visitorId: string): void {
  response.cookies.set(COOKIE_NAME, visitorId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}
