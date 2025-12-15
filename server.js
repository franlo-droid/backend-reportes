import express from "express";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

// =====================
// CONFIG
// =====================
const app = express();
const PORT = process.env.PORT || 8080;

// Si tu app manda JSON grande (base64 de foto), subí este límite.
// Igual: lo correcto es subir fotos como archivo (después lo hacemos).
app.use(express.json({ limit: "25mb" }));

// CORS simple (para app/web)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// =====================
// PATHS (en Railway es mejor guardar en /app/data)
// =====================
const DATA_DIR = path.join(process.cwd(), "data");
const EXCEL_FILE = path.join(DATA_DIR, "reportes.xlsx");
const SHEET_NAME = "Reportes";

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// =====================
// COLA PARA EVITAR CORRUPCIÓN
// =====================
let writing = Promise.resolve();
function enqueue(task) {
  writing = writing.then(task).catch((e) => {
    console.error("Error en cola:", e);
  });
  return writing;
}

// =====================
// HELPERS
// =====================

// ✅ Columnas “originales” (sin inventar nada nuevo)
const COLUMNS = [
  { header: "ID", key: "id", width: 20 },
  { header: "Fecha", key: "fecha", width: 24 },
  { header: "Turno", key: "turno", width: 10 },
  { header: "Tipo", key: "tipo", width: 22 },
  { header: "Equipo", key: "equipo", width: 22 },
  { header: "Descripción", key: "descripcion", width: 50 },
  { header: "Operador", key: "operador", width: 22 },
  { header: "Área", key: "area", width: 18 },
  { header: "SyncStatus", key: "syncStatus", width: 12 }
];

function ensureWorkbookStructure(workbook) {
  let sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) sheet = workbook.addWorksheet(SHEET_NAME);

  // Si no tiene columnas, las setea
  if (!sheet.columns || sheet.columns.length === 0) {
    sheet.columns = COLUMNS;
    sheet.getRow(1).font = { bold: true };
  }

  return sheet;
}

async function loadOrCreateWorkbook() {
  ensureDataDir();
  const workbook = new ExcelJS.Workbook();

  if (fs.existsSync(EXCEL_FILE)) {
    await workbook.xlsx.readFile(EXCEL_FILE);
  }

  ensureWorkbookStructure(workbook);
  return workbook;
}

function normalizeToArray(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") return [body];
  return [];
}

function cleanReport(r) {
  // Limpieza mínima, sin tocar tu lógica de negocio
  return {
    id: String(r.id ?? ""),
    fecha: String(r.fecha ?? ""),
    turno: String(r.turno ?? ""),
    tipo: String(r.tipo ?? ""),
    equipo: String(r.equipo ?? ""),
    descripcion: String(r.descripcion ?? ""),
    operador: String(r.operador ?? ""),
    area: String(r.area ?? ""),
    syncStatus: String(r.syncStatus ?? "synced")
  };
}

function isValidReport(r) {
  // Igual a tu validación: campos obligatorios
  return r.id && r.fecha && r.turno && r.tipo && r.equipo && r.descripcion;
}

// =====================
// ROUTES
// =====================

// Salud
app.get("/health", (req, res) => {
  ensureDataDir();
  res.json({ ok: true, excelExists: fs.existsSync(EXCEL_FILE) });
});

// Estado real del Excel (para verificar actualización)
app.get("/status", (req, res) => {
  ensureDataDir();
  const exists = fs.existsSync(EXCEL_FILE);
  const stat = exists ? fs.statSync(EXCEL_FILE) : null;

  res.json({
    ok: true,
    excelExists: exists,
    excelPath: EXCEL_FILE,
    lastModified: stat ? stat.mtime : null,
    sizeBytes: stat ? stat.size : 0
  });
});

// Crea el Excel a mano (prueba rápida)
app.get("/test-create-excel", async (req, res) => {
  try {
    await enqueue(async () => {
      const wb = await loadOrCreateWorkbook();
      await wb.xlsx.writeFile(EXCEL_FILE);
    });
    res.send("✅ reportes.xlsx creado/asegurado");
  } catch (e) {
    console.error(e);
    res.status(500).send("❌ Error creando Excel");
  }
});

// ✅ Reset del excel (para volver a columnas limpias, usar UNA VEZ si querés)
app.get("/reset-excel", async (req, res) => {
  try {
    await enqueue(async () => {
      ensureDataDir();
      if (fs.existsSync(EXCEL_FILE)) fs.unlinkSync(EXCEL_FILE);
      const wb = await loadOrCreateWorkbook();
      await wb.xlsx.writeFile(EXCEL_FILE);
    });
    res.send("✅ Excel reseteado con columnas originales");
  } catch (e) {
    console.error(e);
    res.status(500).send("❌ Error reseteando Excel");
  }
});

// Descargar el Excel (sin caché)
app.get("/download/reportes.xlsx", (req, res) => {
  ensureDataDir();
  if (!fs.existsSync(EXCEL_FILE)) {
    return res.status(404).send("No existe reportes.xlsx todavía");
  }

  // Evita caché para que siempre baje lo último
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  res.download(EXCEL_FILE, "reportes.xlsx");
});

// Endpoint principal: acepta ARRAY o UN SOLO OBJETO
app.post("/api/reports", async (req, res) => {
  const incoming = normalizeToArray(req.body);

  console.log(`[POST] /api/reports recibido=${incoming.length}`);

  if (incoming.length === 0) {
    return res.status(400).json({ ok: false, error: "Body vacío o inválido" });
  }

  const cleaned = incoming
    .filter((r) => r && typeof r === "object")
    .map(cleanReport)
    .map((r) => ({ ...r, syncStatus: "synced" })) // como antes: al guardarlo, queda synced
    .filter(isValidReport);

  if (cleaned.length === 0) {
    return res.status(400).json({
      ok: false,
      error: "No hay reportes válidos para guardar (faltan campos obligatorios)."
    });
  }

  try {
    await enqueue(async () => {
      const wb = await loadOrCreateWorkbook();
      const sheet = wb.getWorksheet(SHEET_NAME);

      // Append filas respetando columnas por key
      for (const r of cleaned) {
        sheet.addRow(r);
      }

      await wb.xlsx.writeFile(EXCEL_FILE);

      const stat = fs.statSync(EXCEL_FILE);
      console.log(`[EXCEL] actualizado size=${stat.size} lastModified=${stat.mtime.toISOString()}`);
    });

    res.json({ ok: true, agregados: cleaned.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Error escribiendo reportes.xlsx" });
  }
});

// =====================
// START
// =====================
app.listen(PORT, () => {
  console.log(`✅ Backend activo: http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Status: http://localhost:${PORT}/status`);
  console.log(`   Create Excel: http://localhost:${PORT}/test-create-excel`);
  console.log(`   Reset Excel: http://localhost:${PORT}/reset-excel`);
  console.log(`   Download Excel: http://localhost:${PORT}/download/reportes.xlsx`);
});

