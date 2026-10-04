import { NextResponse } from "next/server";
import { getBusinessSettings, saveBusinessSettings } from "@/lib/pricing";
import {
  isSettingsPasswordRequired,
  verifySettingsAdminPassword,
} from "@/lib/api-provider-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getBusinessSettings();
    return NextResponse.json(
      {
        settings: settings
          ? {
              key: settings.key,
              markupPercent: settings.markupPercent,
              fixedFeeCents: settings.fixedFeeCents,
              minimumChargeCents: settings.minimumChargeCents,
              freeLookupEnabled: settings.freeLookupEnabled,
              pixProvider: settings.pixProvider,
              pixKeyType: settings.pixKeyType,
              pixKey: settings.pixKey,
              merchantName: settings.merchantName,
              merchantCity: settings.merchantCity,
            }
          : null,
        hasMpToken: Boolean(settings?.mpAccessToken),
        passwordRequired: isSettingsPasswordRequired(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Não foi possível carregar as configurações de negócio." },
      { status: 500 },
    );
  }
}

/** Remove segredos antes de devolver ao navegador. */
function toSafeSettings(settings: Awaited<ReturnType<typeof saveBusinessSettings>>) {
  if (!settings) return null;
  const { mpAccessToken: _token, mpWebhookSecret: _secret, ...safe } = settings;
  return safe;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const record = body ?? {};

  if (isSettingsPasswordRequired() && !verifySettingsAdminPassword(record.adminPassword)) {
    return NextResponse.json({ error: "Senha administrativa incorreta." }, { status: 403 });
  }

  try {
    const settings = await saveBusinessSettings(record);
    return NextResponse.json(
      { ok: true, settings: toSafeSettings(settings), hasMpToken: Boolean(settings?.mpAccessToken) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao salvar." },
      { status: 400 },
    );
  }
}
