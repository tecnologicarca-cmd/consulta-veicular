import "server-only";

const MP_BASE = "https://api.mercadopago.com";

export interface PixCharge {
  paymentId: string;
  status: string;
  qrCode: string;
  qrCodeBase64: string | null;
  expiration: string | null;
}

export class MercadoPagoError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "MercadoPagoError";
    this.status = status;
  }
}

/** Cria uma cobrança PIX no Mercado Pago e retorna o QR Code. */
export async function createPixCharge(input: {
  accessToken: string;
  amountCents: number;
  description: string;
  externalReference: string;
  notificationUrl: string;
  payerEmail: string;
  expirationMinutes?: number;
}): Promise<PixCharge> {
  const expiresIn = new Date(
    Date.now() + (input.expirationMinutes ?? 30) * 60_000,
  ).toISOString();

  const body = {
    transaction_amount: Number((input.amountCents / 100).toFixed(2)),
    description: input.description.slice(0, 200),
    payment_method_id: "pix",
    payer: { email: input.payerEmail },
    external_reference: input.externalReference,
    notification_url: input.notificationUrl,
    date_of_expiration: expiresIn,
  };

  const response = await mpFetch("/v1/payments", input.accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new MercadoPagoError(mpMessage(data, "Não foi possível gerar a cobrança PIX."), response.status);
  }

  const transactionData = (data?.point_of_interaction as Record<string, unknown> | undefined)
    ?.transaction_data as Record<string, unknown> | undefined;
  const qrCode = typeof transactionData?.qr_code === "string" ? transactionData.qr_code : "";

  if (!qrCode) {
    throw new MercadoPagoError("O Mercado Pago não retornou o código PIX.");
  }

  return {
    paymentId: String(data?.id ?? ""),
    status: String(data?.status ?? "pending"),
    qrCode,
    qrCodeBase64: typeof transactionData?.qr_code_base64 === "string" ? transactionData.qr_code_base64 : null,
    expiration: typeof data?.date_of_expiration === "string" ? data.date_of_expiration : expiresIn,
  };
}

/** Consulta o status atual de um pagamento. */
export async function getPaymentStatus(input: {
  accessToken: string;
  paymentId: string;
}): Promise<{ id: string; status: string; externalReference: string | null }> {
  const response = await mpFetch(`/v1/payments/${input.paymentId}`, input.accessToken);
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    throw new MercadoPagoError(mpMessage(data, "Não foi possível consultar o pagamento."), response.status);
  }

  return {
    id: String(data?.id ?? input.paymentId),
    status: String(data?.status ?? "unknown"),
    externalReference: typeof data?.external_reference === "string" ? data.external_reference : null,
  };
}

async function mpFetch(path: string, accessToken: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${MP_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new MercadoPagoError("O Mercado Pago demorou para responder.", 504);
    }
    throw new MercadoPagoError("Não foi possível conectar ao Mercado Pago.", 502);
  }
}

function mpMessage(data: Record<string, unknown> | null, fallback: string): string {
  const message = data?.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  const causes = data?.cause;
  if (Array.isArray(causes) && causes.length > 0) {
    const first = causes[0] as Record<string, unknown> | undefined;
    const description = first?.description;
    if (typeof description === "string" && description.trim()) return description.trim();
  }
  return fallback;
}
