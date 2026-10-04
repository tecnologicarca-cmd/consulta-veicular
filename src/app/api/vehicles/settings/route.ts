import { NextResponse } from "next/server";
import {
  ApiSettingsError,
  clearSavedApiBrasilSettings,
  getSafeApiBrasilSettings,
  isSettingsPasswordRequired,
  saveApiBrasilSettings,
  verifySettingsAdminPassword,
} from "@/lib/api-provider-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSafeApiBrasilSettings();
    return NextResponse.json(settings, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível carregar as configurações APIBrasil." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const record = asRecord(await request.json().catch(() => null));
  try {
    if (isSettingsPasswordRequired()) {
      if (!verifySettingsAdminPassword(record.adminPassword)) {
        return NextResponse.json(
          { error: "Senha administrativa incorreta (definida em ARCA_SETTINGS_PASSWORD)." },
          { status: 403 },
        );
      }
    }

    const { adminPassword: _adminPassword, ...settingsInput } = record;
    const settings = await saveApiBrasilSettings(settingsInput);
    return NextResponse.json(
      { ok: true, settings },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof ApiSettingsError ? 400 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível salvar as configurações." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function DELETE(request: Request) {
  const record = asRecord(await request.json().catch(() => null));
  if (isSettingsPasswordRequired()) {
    if (!verifySettingsAdminPassword(record.adminPassword)) {
      return NextResponse.json({ error: "Senha administrativa incorreta." }, { status: 403 });
    }
  }
  try {
    await clearSavedApiBrasilSettings();
    const settings = await getSafeApiBrasilSettings();
    return NextResponse.json({ ok: true, settings }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível remover as credenciais salvas." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
