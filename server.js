import express from "express";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

// =====================
// CONFIG
// =====================
const app = express();
const PORT = process.env.PORT || 3000;

// Si tu app manda JSON grande (base64 de foto), subí este límite.
// OJO: después lo mejor es subir fotos como archivos, no base64.
app.use(express.json({ limit: "25mb" }));

// CORS simple (para que desde tu app/web no te bloquee el navegador)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // en prod, poné tu dominio
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const EXCEL_FILE = path.join(process.cwd(), "reportes.xlsx");
const SHEET_NAME = "Reportes";

// =====================
// COLA PARA EVITAR CORRUPCIÓN (muy importante)
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
function ensureWorkbookStructure(workbook) {
  let sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    sheet = workbook.addWorksheet(SHEET_NAME);
  }

  // Si está vacío, definimos columnas
  if (!sheet.columns || sheet.columns.length === 0) {
    sheet.columns = [
      { header: "ID", key: "id", width: 20 },
      { header: "Fecha", key: "fecha", width: 24 },
      { header: "Turno", key: "turno", width: 10 },
      { header: "Tipo", key: "tipo", width: 22 },
      { header: "Equipo", key: "equipo", width: 22 },
      { header: "Descripción", key: "descripcion", width: 50 },
      { header: "Operador", key: "operador", width: 22 },
      { header: "Área", key: "area", width: 18 },
      { header: "SyncStatus", key: "syncStatus", width: 12 }
      // Nota: por ahora NO guardamos foto en Excel.
      // Después lo hacemos bien con archivos + link.
    ];

    // Opcional: estilo a encabezados
    sheet.getRow(1).font = { bold: true };
  }

  return sheet;
}

async function loadOrCreateWorkbook() {
  const workbook = new ExcelJS.Workbook();

  if (fs.existsSync(EXCEL_FILE)) {
    await workbook.xlsx.readFile(EXCEL_FILE);
  }

  // Asegura que exista la hoja/columnas
  ensureWorkbookStructure(workbook);
  return workbook;
}

// =====================
// ROUTES
// =====================

// Salud
app.get("/health", (req, res) => {
  res.json({ ok: true, excelExists: fs.existsSync(EXCEL_FILE) });
});

// Crea el Excel a mano (prueba rápida sin POST)
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

// Descargar el Excel para verificar
app.get("/download/reportes.xlsx", (req, res) => {
  if (!fs.existsSync(EXCEL_FILE)) {
    return res.status(404).send("No existe reportes.xlsx todavía");
  }
  res.download(EXCEL_FILE, "reportes.xlsx");
});

// Endpoint principal: tu app manda un ARRAY de reportes (pending)
app.post("/api/reports", async (req, res) => {
  const reports = req.body;

  if (!Array.isArray(reports)) {
    return res.status(400).json({ ok: false, error: "Se espera un array de reportes" });
  }

  // Validación mínima (para evitar filas vacías)
  const cleaned = reports
    .filter((r) => r && typeof r === "object")
    .map((r) => ({
      id: String(r.id ?? ""),
      fecha: String(r.fecha ?? ""),
      turno: String(r.turno ?? ""),
      tipo: String(r.tipo ?? ""),
      equipo: String(r.equipo ?? ""),
      descripcion: String(r.descripcion ?? ""),
      operador: String(r.operador ?? ""),
      area: String(r.area ?? ""),
      syncStatus: "synced"
    }))
    .filter((r) => r.id && r.fecha && r.turno && r.tipo && r.equipo && r.descripcion);

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

      // Append filas
      for (const r of cleaned) {
        sheet.addRow(r);
      }

      await wb.xlsx.writeFile(EXCEL_FILE);
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
  console.log(`   Create Excel: http://localhost:${PORT}/test-create-excel`);
  console.log(`   Download Excel: http://localhost:${PORT}/download/reportes.xlsx`);
});
