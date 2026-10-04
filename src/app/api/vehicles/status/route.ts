import { getPublicPlateApiUrl } from "@/lib/public-vehicle-apis";
import { getSafeApiBrasilSettings } from "@/lib/api-provider-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSafeApiBrasilSettings();
    const publicPlateConfigured = getPublicPlateApiUrl() !== null;
    return Response.json({
      publicPlateConfigured,
      publicFipeAvailable: true,
      paidConfigured: settings.configured,
      hasBearer: settings.hasBearer,
      hasDevice: settings.hasDevice,
      message: settings.configured
        ? settings.hasDevice
          ? "APIBrasil conectada (Bearer + Device Token). Consultas por créditos e serviços device-based habilitados."
          : "APIBrasil conectada (Modo por Créditos com Bearer Token). Consultas veiculares ativas!"
        : "APIBrasil ainda não configurada. Abra Configurações e cole o seu Bearer Token.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({
      publicPlateConfigured: false,
      publicFipeAvailable: true,
      paidConfigured: false,
      message: "Não foi possível carregar as credenciais salvas. Confira a conexão com o banco de dados.",
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
