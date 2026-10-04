import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { consultationOrders } from "@/db/schema";
import { getBusinessSettings } from "@/lib/pricing";
import { getPaymentStatus } from "@/lib/mercadopago";
import { executeConsultation } from "@/lib/consultation-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "arca_visitor";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const jar = await cookies();
  const visitorId = jar.get(COOKIE_NAME)?.value;
  let order: typeof consultationOrders.$inferSelect | undefined;
  try {
    const result = await db
      .select()
      .from(consultationOrders)
      .where(eq(consultationOrders.id, orderId))
      .limit(1);
    order = result[0];
  } catch {
    return NextResponse.json(
      { error: "Banco de dados indisponível. Tente novamente em instantes." },
      { status: 503 },
    );
  }

  if (!order || order.visitorId !== visitorId) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }

  // Polling: se ainda está pendente no Mercado Pago, verifica o status real
  let current = order;
  if (
    order.status === "pending" &&
    order.pixProvider === "mercadopago" &&
    order.providerPaymentId
  ) {
    current = await syncWithProvider(order);
  }

  return NextResponse.json({ data: current });
}

/** Cliente informa que realizou o pagamento (mantido para PIX manual). */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? "");
  const jar = await cookies();
  const visitorId = jar.get(COOKIE_NAME)?.value;

  let order: typeof consultationOrders.$inferSelect | undefined;
  try {
    const result = await db
      .select()
      .from(consultationOrders)
      .where(eq(consultationOrders.id, orderId))
      .limit(1);
    order = result[0];
  } catch {
    return NextResponse.json(
      { error: "Banco de dados indisponível. Tente novamente em instantes." },
      { status: 503 },
    );
  }

  if (!order || order.visitorId !== visitorId) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }

  if (action === "sync" && order.pixProvider === "mercadopago" && order.providerPaymentId) {
    const updated = await syncWithProvider(order);
    return NextResponse.json({ ok: true, data: updated });
  }

  if (action === "report_payment") {
    if (order.status !== "pending") {
      return NextResponse.json({ ok: true, data: order });
    }
    const [updated] = await db
      .update(consultationOrders)
      .set({ status: "paid", paidAt: new Date() })
      .where(eq(consultationOrders.id, orderId))
      .returning();
    return NextResponse.json({ ok: true, data: updated });
  }

  if (action === "cancel") {
    if (order.status === "pending" || order.status === "paid") {
      const [updated] = await db
        .update(consultationOrders)
        .set({ status: "cancelled" })
        .where(eq(consultationOrders.id, orderId))
        .returning();
      return NextResponse.json({ ok: true, data: updated });
    }
    return NextResponse.json({ ok: true, data: order });
  }

  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}

async function syncWithProvider(order: typeof consultationOrders.$inferSelect) {
  const settings = await getBusinessSettings();
  if (!settings?.mpAccessToken || !order.providerPaymentId) return order;

  try {
    const payment = await getPaymentStatus({
      accessToken: settings.mpAccessToken,
      paymentId: order.providerPaymentId,
    });

    if (payment.status === "approved") {
      const result = await executeConsultation(
        order.lookupType,
        order.lookupValue,
        order.services,
      );
      const [updated] = await db
        .update(consultationOrders)
        .set({ status: "confirmed", confirmedAt: new Date(), result })
        .where(eq(consultationOrders.id, order.id))
        .returning();
      return updated;
    }

    if (payment.status === "rejected" || payment.status === "cancelled") {
      const [updated] = await db
        .update(consultationOrders)
        .set({ status: "cancelled" })
        .where(eq(consultationOrders.id, order.id))
        .returning();
      return updated;
    }
  } catch {
    // Falha de rede: mantém o status atual
  }
  return order;
}
