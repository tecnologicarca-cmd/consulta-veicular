import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FIPE_BASE = "https://fipe.parallelum.com.br/api/v2";
const vehicleKinds = new Set(["cars", "motorcycles", "trucks"]);
const cacheDurations: Record<string, number> = {
  brands: 86_400,
  models: 86_400,
  years: 86_400,
  price: 43_200,
};

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind") || "cars";
  const resource = query.get("resource") || "";
  if (!vehicleKinds.has(kind)) {
    return NextResponse.json({ error: "Tipo de veículo inválido." }, { status: 400 });
  }

  const brand = query.get("brand") || "";
  const model = query.get("model") || "";
  const year = query.get("year") || "";
  let path: string;

  if (resource === "brands") {
    path = `/${kind}/brands`;
  } else if (resource === "models" && /^\d+$/.test(brand)) {
    path = `/${kind}/brands/${brand}/models`;
  } else if (resource === "years" && /^\d+$/.test(brand) && /^\d+$/.test(model)) {
    path = `/${kind}/brands/${brand}/models/${model}/years`;
  } else if (
    resource === "price" &&
    /^\d+$/.test(brand) &&
    /^\d+$/.test(model) &&
    /^\d{4,}-\d+$/.test(year)
  ) {
    path = `/${kind}/brands/${brand}/models/${model}/years/${encodeURIComponent(year)}`;
  } else {
    return NextResponse.json(
      { error: "Parâmetros FIPE inválidos. Escolha tipo, marca, modelo e ano disponíveis." },
      { status: 400 },
    );
  }

  try {
    const headers: HeadersInit = { Accept: "application/json" };
    const token = process.env.FIPE_API_TOKEN?.trim();
    if (token) headers["X-Subscription-Token"] = token;

    const response = await fetch(`${FIPE_BASE}${path}`, {
      headers,
      cache: "force-cache",
      next: { revalidate: cacheDurations[resource] },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const status = response.status === 404 ? 404 : response.status === 429 ? 429 : 502;
      return NextResponse.json(
        {
          error:
            response.status === 429
              ? "Limite diário da API FIPE pública atingido. Tente novamente mais tarde."
              : response.status === 404
                ? "Esta marca, modelo ou ano não foi encontrado na referência FIPE atual."
                : "A API FIPE pública não respondeu. Tente novamente em instantes.",
        },
        { status },
      );
    }

    const data: unknown = await response.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": `public, s-maxage=${cacheDurations[resource]}, stale-while-revalidate=3600` },
    });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível acessar a API FIPE pública. Tente novamente em instantes." },
      { status: 502 },
    );
  }
}
