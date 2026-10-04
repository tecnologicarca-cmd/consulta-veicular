import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { consultationOrders } from "@/db/schema";
import {
  isSettingsPasswordRequired,
  verifySettingsAdminPassword,
} from "@/lib/api-provider-settings";
import { executeConsultation } from "@/lib/consultation-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lista pedidos (admin) e confirma pagamento liberando a consulta. */
export async function GET(request: Request) {
  if (isSettingsPasswordRequired()) {
    const password = new URL(request.url).searchParams.get("password") ?? "";
    if (!verifySettingsAdminPassword(password)) {
      return NextResponse.json({ error: "Senha incorreta." }, { status: 403 });
    }
  }

  try {
    const orders = await db
      .select()
      .from(consultationOrders)
      .orderBy((t) => t.createdAt)
      .limit(100);
    return NextResponse.json({ items: orders.reverse() });
  } catch {
    return NextResponse.json({ error: "Falha ao carregar pedidos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (isSettingsPasswordRequired() && !verifySettingsAdminPassword(body?.adminPassword)) {
    return NextResponse.json({ error: "Senha incorreta." }, { status: 403 });
  }

  const orderId = Number(body?.orderId);
  const action = String(body?.action ?? "confirm");
  if (!Number.isInteger(orderId)) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

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
  if (!order) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });

  if (action === "reject") {
    const [updated] = await db
      .update(consultationOrders)
      .set({ status: "cancelled" })
      .where(eq(consultationOrders.id, orderId))
      .returning();
    return NextResponse.json({ ok: true, data: updated });
  }

  if (order.status !== "paid" && order.status !== "pending") {
    return NextResponse.json({ ok: true, data: order });
  }

  try {
    const result = await executeConsultation(
      order.lookupType as "placa" | "renavam",
      order.lookupValue,
      order.services,
    );
    const [updated] = await db
      .update(consultationOrders)
      .set({ status: "confirmed", confirmedAt: new Date(), result })
      .where(eq(consultationOrders.id, orderId))
      .returning();
    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao executar consulta." },
      { status: 502 },
    );
  }
}
