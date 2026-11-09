import { get, list, put } from "@vercel/blob";
const PATH = "history/reports.json";
async function parseBlob(blob) {
  const result = await get(blob.url, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) throw new Error("No se pudo leer el historial privado.");
  const raw = await new Response(result.stream).text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}
async function readHistory() {
  const listing = await list({ prefix: PATH, limit: 10 });
  const blob = (listing.blobs || []).find((item) => item.pathname === PATH);
  return blob ? parseBlob(blob) : {};
}
async function writeHistory(history) {
  return await put(PATH, JSON.stringify(history), {
    access: "private", addRandomSuffix: false, allowOverwrite: true,
    contentType: "application/json", cacheControlMaxAge: 0
  });
}
function reportsFrom(history) { return Object.values(history).sort((a,b) => String(a.date).localeCompare(String(b.date))); }
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") {
    try { return res.status(200).json({ reports: reportsFrom(await readHistory()) }); }
    catch (e) { return res.status(500).json({ error: e?.message || "No se pudo leer el historial." }); }
  }
  if (req.method === "POST") {
    try {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body);
      if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ""))) return res.status(400).json({ error: "La fecha del reporte no es válida." });
      if (!Array.isArray(body.rows) || !Array.isArray(body.details) || !Array.isArray(body.importedStores)) return res.status(400).json({ error: "El reporte está incompleto: faltan tiendas, concentrado o detalle." });
      const history = await readHistory();
      // Solo sustituye la fecha importada; conserva intactas las demás fechas.
      history[body.date] = {
        date: body.date,
        importedStores: [...new Set(body.importedStores.map(x => String(x || "").trim()).filter(Boolean))],
        rows: body.rows, details: body.details, updatedAt: new Date().toISOString()
      };
      const written = await writeHistory(history);
      // Verifica directamente la URL devuelta por put, evitando leer una versión anterior desde list().
      const verified = await parseBlob(written);
      const saved = verified[body.date];
      if (!saved || saved.rows?.length !== body.rows.length || saved.details?.length !== body.details.length) {
        throw new Error(`Verificación del guardado: esperado ${body.rows.length} filas y ${body.details.length} detalles; leído ${saved?.rows?.length ?? 0} y ${saved?.details?.length ?? 0}.`);
      }
      return res.status(200).json({ success: true, reports: reportsFrom(verified), savedDate: body.date, savedRows: saved.rows.length, savedDetails: saved.details.length });
    } catch (e) { return res.status(500).json({ error: e?.message || "No se pudo guardar el historial." }); }
  }
  return res.status(405).end();
}
