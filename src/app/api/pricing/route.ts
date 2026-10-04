import { NextResponse } from "next/server";
import { calculatePrice, getBusinessSettings } from "@/lib/pricing";
import { defaultServiceSelection, optionalServices } from "@/lib/vehicles";
import type { ServiceSelection } from "@/lib/vehicles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const services = (body?.services ?? defaultServiceSelection) as ServiceSelection;
  const clean = Object.fromEntries(
    optionalServices.map((service) => [service, services[service] === true]),
  ) as ServiceSelection;

  try {
    const [pricing, settings] = await Promise.all([calculatePrice(clean), getBusinessSettings()]);
    return NextResponse.json(
      {
        pricing,
        freeLookupEnabled: settings?.freeLookupEnabled ?? true,
        paymentConfigured: Boolean(settings?.pixKey),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Falha ao calcular preço." }, { status: 500 });
  }
}

export async function GET() {
  try {
    const [settings, pricing] = await Promise.all([
      getBusinessSettings(),
      calculatePrice(defaultServiceSelection),
    ]);
    return NextResponse.json(
      {
        settings,
        pricing,
        freeLookupEnabled: settings?.freeLookupEnabled ?? true,
        paymentConfigured: Boolean(settings?.pixKey),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Falha ao carregar." }, { status: 500 });
  }
}
