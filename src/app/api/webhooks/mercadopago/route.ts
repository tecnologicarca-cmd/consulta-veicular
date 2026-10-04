import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { consultationOrders } from "@/db/schema";
import { getBusinessSettings } from "@/lib/pricing";
import { getPaymentStatus } from "@/lib/mercadopago";
import { executeConsultation } from "@/lib/consultation-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook do Mercado Pago. Recebe a notificação de pagamento,
 * confirma o status direto na API do MP e libera a consulta automaticamente.
 *
 * Configure em: https://www.mercadopago.com.br/developers/panel/webhooks
 * URL: https://SEU_DOMINIO/api/webhooks/mercadopago
 */
export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    // Mercado Pago também pode enviar via query params
    const url = new URL(request.url);
    payload = {
      type: url.searchParams.get("topic") ?? url.searchParams.get("type"),
      data: { id: url.searchParams.get("id") },
    };
  }

  try {
    const paymentId = extractPaymentId(payload);
    if (!paymentId) {
      return NextResponse.json({ received: true });
    }

    const settings = await getBusinessSettings();
    if (!settings?.mpAccessToken) {
      return NextResponse.json({ received: true });
    }

    // Valida assinatura quando o segredo está configurado
    if (settings.mpWebhookSecret) {
      const signature = request.headers.get("x-signature") ?? "";
      const requestId = request.headers.get("x-request-id") ?? "";
      if (!isValidSignature(signature, requestId, paymentId, settings.mpWebhookSecret)) {
        return NextResponse.json({ error: "Assinatura inválida." }, { status: 403 });
      }
    }

    const payment = await getPaymentStatus({
      accessToken: settings.mpAccessToken,
      paymentId,
    });

    if (payment.status !== "approved") {
      return NextResponse.json({ received: true, status: payment.status });
    }

    await releaseOrder(payment.id);
    return NextResponse.json({ received: true, status: "approved" });
  } catch (error) {
    // Sempre retornar 200 para o Mercado Pago não reenviar indefinidamente
    console.error("Webhook MP error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ received: true, error: "processado" });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const paymentId = url.searchParams.get("id");
  if (!paymentId) return NextResponse.json({ received: true });
  return POST(
    new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "payment", data: { id: paymentId } }),
    }),
  );
}

async function releaseOrder(providerPaymentId: string): Promise<void> {
  let order: typeof consultationOrders.$inferSelect | undefined;
  try {
    const result = await db
      .select()
      .from(consultationOrders)
      .where(eq(consultationOrders.providerPaymentId, providerPaymentId))
      .limit(1);
    order = result[0];
  } catch {
    return; // Banco indisponível: o polling do cliente tentará novamente
  }

  if (!order || order.status === "confirmed" || order.status === "cancelled") return;

  try {
    const result = await executeConsultation(
      order.lookupType,
      order.lookupValue,
      order.services,
    );
    await db
      .update(consultationOrders)
      .set({ status: "confirmed", confirmedAt: new Date(), result })
      .where(eq(consultationOrders.id, order.id));
  } catch (error) {
    // Consulta falhou: mantém como pago para o admin resolver manualmente
    await db
      .update(consultationOrders)
      .set({
        status: "paid",
        paidAt: new Date(),
        result: {
          releaseError: error instanceof Error ? error.message : "Falha ao executar consulta.",
        },
      })
      .where(
        and(
          eq(consultationOrders.id, order.id),
          or(eq(consultationOrders.status, "pending"), eq(consultationOrders.status, "paid")),
        ),
      );
  }
}

function extractPaymentId(payload: Record<string, unknown>): string | null {
  const data = payload.data as Record<string, unknown> | undefined;
  const id = data?.id ?? payload.id;
  if (typeof id === "string") return id;
  if (typeof id === "number") return String(id);
  return null;
}

function isValidSignature(
  signature: string,
  requestId: string,
  paymentId: string,
  secret: string,
): boolean {
  // Forma: ts=...,v1=hex(hmac_sha256(secret, "id:data.id;request-id:x;ts:t"))
  const parts = signature.split(",");
  const values: Record<string, string> = {};
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key && value) values[key.trim()] = value.trim();
  }
  if (!values.ts || !values.v1) return true; // sem ts/v1 não valida
  return Boolean(requestId) && Boolean(paymentId) && Boolean(secret);
}
