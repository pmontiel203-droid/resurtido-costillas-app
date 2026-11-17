const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}
function stats(report) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const active = rows.filter((r) => (Number(r.pieces) || 0) > 0 || (Number(r.money) || 0) > 0);
  return {
    stores: new Set(active.map((r) => String(r.store || "").trim().toUpperCase()).filter(Boolean)).size,
    pieces: rows.reduce((s, r) => s + (Number(r.pieces) || 0), 0),
    money: rows.reduce((s, r) => s + (Number(r.money) || 0), 0),
    details: Array.isArray(report?.details) ? report.details.length : 0,
  };
}
function regression(oldReport, incoming) {
  if (!oldReport) return false;
  const a = stats(oldReport), b = stats(incoming);
  return b.stores < a.stores || b.pieces < a.pieces || b.money + 0.009 < a.money || b.details < a.details;
}
function validate(report) {
  if (!report || !datePattern.test(String(report.date || ""))) throw new Error("La fecha del reporte no es válida.");
  if (!Array.isArray(report.rows) || !Array.isArray(report.details) || !Array.isArray(report.importedStores)) {
    throw new Error("El reporte está incompleto: faltan tiendas, concentrado o detalle.");
  }
}
async function getReports(db) {
  const result = await db.prepare("SELECT payload FROM reports ORDER BY report_date ASC").all();
  return (result.results || []).map((row) => JSON.parse(row.payload));
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Migration-Secret"
  }});
}
export async function onRequestGet({ env }) {
  try { return json({ reports: await getReports(env.DB) }); }
  catch (e) { return json({ error: e?.message || "No se pudo leer el historial." }, 500); }
}
export async function onRequestPost({ request, env }) {
  try {
    const report = await request.json();
    validate(report);
    const old = await env.DB.prepare("SELECT payload FROM reports WHERE report_date = ?")
      .bind(report.date).first();
    const existing = old ? JSON.parse(old.payload) : null;
    if (regression(existing, report)) {
      return json({ error: `Carga detenida para proteger el reporte ${report.date}: el archivo nuevo trae menos información que el guardado. No se reemplazó el historial.`, protected: true, saved: stats(existing), incoming: stats(report) }, 409);
    }
    const clean = {
      date: report.date,
      importedStores: [...new Set(report.importedStores.map((x) => String(x || "").trim()).filter(Boolean))],
      rows: report.rows,
      details: report.details,
      updatedAt: new Date().toISOString()
    };
    await env.DB.prepare(`INSERT INTO reports (report_date, updated_at, payload) VALUES (?, ?, ?)
      ON CONFLICT(report_date) DO UPDATE SET updated_at=excluded.updated_at, payload=excluded.payload`)
      .bind(clean.date, clean.updatedAt, JSON.stringify(clean)).run();
    return json({ success: true, reports: await getReports(env.DB), savedDate: clean.date,
      savedRows: clean.rows.length, savedDetails: clean.details.length });
  } catch (e) { return json({ error: e?.message || "No se pudo guardar el historial." }, 500); }
}
