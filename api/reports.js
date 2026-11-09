import { get, list, put } from "@vercel/blob";

const LEGACY_PATH = "history/reports.json";
const DAILY_PREFIX = "history/reports/";

function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function readBlobJson(url) {
  const result = await get(url, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error("No se pudo leer el archivo privado del historial.");
  }
  const raw = await new Response(result.stream).text();
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function listAll(prefix) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    blobs.push(...(page.blobs || []));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function readHistory() {
  const history = {};

  // Compatibilidad con el historial anterior guardado en un solo JSON.
  const legacyBlobs = await listAll(LEGACY_PATH);
  const legacy = legacyBlobs.find((item) => item.pathname === LEGACY_PATH);
  if (legacy) {
    const parsed = jsonObject(await readBlobJson(legacy.url));
    for (const [key, value] of Object.entries(parsed)) {
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(String(value.date || key))) {
        const date = String(value.date || key);
        history[date] = { ...value, date };
      }
    }
  }

  // Cada fecha nueva se guarda en su propio archivo inmutable/versionado.
  // Esto evita sobrescribir un JSON grande y leer una versión anterior por caché.
  const dailyBlobs = await listAll(DAILY_PREFIX);
  dailyBlobs.sort((a, b) => String(a.uploadedAt || "").localeCompare(String(b.uploadedAt || "")));
  for (const blob of dailyBlobs) {
    try {
      const report = await readBlobJson(blob.url);
      if (!report || !/^\d{4}-\d{2}-\d{2}$/.test(String(report.date || ""))) continue;
      const previous = history[report.date];
      const nextTime = String(report.updatedAt || blob.uploadedAt || "");
      const previousTime = String(previous?.updatedAt || "");
      if (!previous || nextTime >= previousTime) history[report.date] = report;
    } catch (error) {
      // No ocultamos errores de un archivo de fecha: una lectura incompleta
      // del historial debe ser visible y no producir un éxito falso.
      throw new Error(`No se pudo recuperar el reporte ${blob.pathname}: ${error?.message || error}`);
    }
  }
  return history;
}

function reportsFrom(history) {
  return Object.values(history).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function validateReport(report) {
  if (!report || !/^\d{4}-\d{2}-\d{2}$/.test(String(report.date || ""))) {
    throw new Error("La fecha del reporte no es válida.");
  }
  if (!Array.isArray(report.rows) || !Array.isArray(report.details) || !Array.isArray(report.importedStores)) {
    throw new Error("El reporte está incompleto: faltan tiendas, concentrado o detalle.");
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    try {
      return res.status(200).json({ reports: reportsFrom(await readHistory()) });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "No se pudo leer el historial." });
    }
  }

  if (req.method === "POST") {
    try {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body);
      validateReport(body);

      const date = body.date;
      const report = {
        date,
        importedStores: [...new Set(body.importedStores.map((x) => String(x || "").trim()).filter(Boolean))],
        rows: body.rows,
        details: body.details,
        updatedAt: new Date().toISOString(),
      };

      // Archivo único por intento: no se sobrescribe una ruta compartida.
      const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const pathname = `${DAILY_PREFIX}${date}/${nonce}.json`;
      const blob = await put(pathname, JSON.stringify(report), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
      });

      // Verificación contra la URL exacta que devolvió put(), no mediante
      // una búsqueda de listado que puede devolver una versión anterior.
      const saved = jsonObject(await readBlobJson(blob.url));
      const expectedRows = report.rows.length;
      const expectedDetails = report.details.length;
      const actualRows = Array.isArray(saved.rows) ? saved.rows.length : -1;
      const actualDetails = Array.isArray(saved.details) ? saved.details.length : -1;
      if (saved.date !== date || actualRows !== expectedRows || actualDetails !== expectedDetails) {
        throw new Error(`Verificación del guardado: esperado ${expectedRows} filas y ${expectedDetails} detalles; leído ${actualRows} filas y ${actualDetails} detalles. No se confirmó el guardado.`);
      }

      // Construimos la respuesta con el reporte verificado, sin depender de
      // que el índice de blobs se actualice inmediatamente.
      const history = await readHistory();
      history[date] = saved;
      return res.status(200).json({
        success: true,
        reports: reportsFrom(history),
        savedDate: date,
        savedRows: actualRows,
        savedDetails: actualDetails,
      });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "No se pudo guardar el historial." });
    }
  }

  return res.status(405).end();
}
