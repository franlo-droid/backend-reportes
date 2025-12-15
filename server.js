import express from "express";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

const app = express();

// 🔥 Aumentamos límite por si viene grande (igual después haremos upload real de fotos)
app.use(express.json({ limit: "25mb" }));

// ✅ LOG DE TODAS LAS REQUESTS (para ver en Railway sí o sí)
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} - ${new Date().toISOString()}`);
  next();
});

// Ruta estable al archivo
const DATA_DIR = path.join(process.cwd(), "data");
const EXCEL_FILE = path.join(DATA_DIR, "reportes.xlsx");

// Crea carpeta data si no existe
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function ensureExcelExists() {
  ensureDataDir();
  if (fs.existsSync(EXCEL_FILE)) return;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Reportes");

  ws.addRow([
    "ID",
    "Fecha",
    "Turno",
    "Tipo",
    "Equipo",
    "Descripción",
    "Operador",
    "Área",
    "SyncStatus",
  ]);

  await wb.xlsx.writeFile(EXCEL_FILE);
  console.log(`[EXCEL] creado: ${EXCEL_FILE}`);
}

app.get("/health", async (req, res) => {
  ensureDataDir();
  const exists = fs.existsSync(EXCEL_FILE);
  res.json({ ok: true, excelExists: exists });
});

// ✅ para saber si el archivo cambió
app.get("/status", async (req, res) => {
  ensureDataDir();
  const exists = fs.existsSync(EXCEL_FILE);
  const stat = exists ? fs.statSync(EXCEL_FILE) : null;
  res.json({
    ok: true,
    excelExists: exists,
    excelPath: EXCEL_FILE,
    lastModified: stat ? stat.mtime : null,
    sizeBytes: stat ? stat.size : 0,
  });
});

// crea excel manualmente
app.get("/test-create-excel", async (req, res) => {
  await ensureExcelExists();
  res.send("✅ reportes.xlsx creado/asegurado");
});

// ✅ descarga sin caché
app.get("/download/reportes.xlsx", (req, res) => {
  ensureDataDir();
  if (!fs.existsSync(EXCEL_FILE)) {
    return res.status(404).send("No existe reportes.xlsx todavía");
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  return res.download(EXCEL_FILE, "reportes.xlsx");
});

// ✅ recibe reportes (array u objeto)
app.post("/api/reports", async (req, res) => {
  try {
    await ensureExcelExists();

    const body = req.body;

    // Acepta array o un solo objeto
    const items = Array.isArray(body) ? body : [body];

    console.log(`[POST] /api/reports items=${items.length}`);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(EXCEL_FILE);
    const ws = wb.getWorksheet("Reportes") || wb.worksheets[0];

    for (const r of items) {
      ws.addRow([
        r.id || "",
        r.fecha || "",
        r.turno || "",
        r.tipo || "",
        r.equipo || "",
        r.descripcion || "",
        r.operador || "",
        r.area || "",
        r.syncStatus || "pending",
      ]);
    }

    await wb.xlsx.writeFile(EXCEL_FILE);

    const stat = fs.statSync(EXCEL_FILE);
    console.log(`[EXCEL] actualizado. size=${stat.size} lastModified=${stat.mtime.toISOString()}`);

    return res.json({ ok: true, received: items.length });
  } catch (err) {
    console.error("[ERROR] /api/reports", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Railway usa PORT
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Backend activo: http://localhost:${PORT}`);
});
