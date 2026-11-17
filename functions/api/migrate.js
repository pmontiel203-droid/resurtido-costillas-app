const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
function reply(data, status = 200) { return new Response(JSON.stringify(data), { status, headers }); }
export async function onRequestPost({ request, env }) {
  if (!env.MIGRATION_SECRET) return reply({ error: "Falta configurar MIGRATION_SECRET." }, 503);
  if (request.headers.get("X-Migration-Secret") !== env.MIGRATION_SECRET) return reply({ error: "No autorizado." }, 401);
  try {
    const body = await request.json();
    if (!Array.isArray(body.reports)) return reply({ error: "Se esperaba reports como arreglo." }, 400);
    const statements = [];
    for (const r of body.reports) {
      if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || "")) || !Array.isArray(r.rows) || !Array.isArray(r.details) || !Array.isArray(r.importedStores)) continue;
      const payload = JSON.stringify(r);
      statements.push(env.DB.prepare(`INSERT INTO reports (report_date, updated_at, payload) VALUES (?, ?, ?)
        ON CONFLICT(report_date) DO NOTHING`).bind(r.date, String(r.updatedAt || new Date().toISOString()), payload));
    }
    if (statements.length) await env.DB.batch(statements);
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM reports").first();
    return reply({ success: true, importedCandidates: statements.length, totalStored: count?.total || 0,
      note: "La migración no reemplaza fechas que ya existan en la base nueva." });
  } catch (e) { return reply({ error: e?.message || "Falló la migración." }, 500); }
}
