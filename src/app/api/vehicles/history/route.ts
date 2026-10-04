import { and, count, desc, eq, gte } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { vehicleConsultations } from "@/db/schema";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "arca_visitor";

export async function GET() {
  const jar = await cookies();
  const visitorId = jar.get(COOKIE_NAME)?.value;
  if (!visitorId || !/^[0-9a-f-]{36}$/i.test(visitorId)) {
    return Response.json({ items: [], stats: { total: 0, thisMonth: 0 } });
  }

  if (!process.env.DATABASE_URL) {
    return Response.json({ items: [], stats: { total: 0, thisMonth: 0 } });
  }

  try {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [items, totalRows, monthRows] = await Promise.all([
      db
        .select()
        .from(vehicleConsultations)
        .where(eq(vehicleConsultations.visitorId, visitorId))
        .orderBy(desc(vehicleConsultations.createdAt))
        .limit(10),
      db
        .select({ value: count() })
        .from(vehicleConsultations)
        .where(eq(vehicleConsultations.visitorId, visitorId)),
      db
        .select({ value: count() })
        .from(vehicleConsultations)
        .where(
          and(
            eq(vehicleConsultations.visitorId, visitorId),
            gte(vehicleConsultations.createdAt, monthStart),
          ),
        ),
    ]);

    return Response.json({
      items: items.map((item) => ({
        id: item.id,
        plate: item.plate,
        searchType: item.searchType ?? "placa",
        searchValue: item.searchValue || item.plate || "—",
        services: item.services,
        status: item.status,
        source: item.source,
        durationMs: item.durationMs,
        createdAt: item.createdAt.toISOString(),
      })),
      stats: {
        total: Number(totalRows[0]?.value ?? 0),
        thisMonth: Number(monthRows[0]?.value ?? 0),
      },
    });
  } catch {
    return Response.json(
      { error: "Não foi possível carregar o histórico agora." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const jar = await cookies();
  const visitorId = jar.get(COOKIE_NAME)?.value;
  if (!visitorId || !/^[0-9a-f-]{36}$/i.test(visitorId)) {
    return Response.json({ ok: true, deleted: 0 });
  }

  try {
    const deleted = await db
      .delete(vehicleConsultations)
      .where(eq(vehicleConsultations.visitorId, visitorId))
      .returning({ id: vehicleConsultations.id });
    return Response.json({ ok: true, deleted: deleted.length });
  } catch {
    return Response.json(
      { ok: false, error: "Não foi possível excluir o histórico agora." },
      { status: 500 },
    );
  }
}
