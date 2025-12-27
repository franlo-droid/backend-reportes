const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));

// Railway usa process.env.PORT
const PORT = process.env.PORT || 3000;

// === VARIABLES (Railway) ===
const SHEET_ID = process.env.SHEET_ID;              // ID del Google Sheet
const SHEET_TAB = process.env.SHEET_TAB || "Hoja 1";// Nombre de pestaña
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;// Carpeta Drive para fotos
const SA_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON; // JSON completo

if (!SHEET_ID || !DRIVE_FOLDER_ID || !SA_JSON) {
  console.error("Faltan variables: SHEET_ID, DRIVE_FOLDER_ID, GOOGLE_SERVICE_ACCOUNT_JSON");
}

function getAuth() {
  // OJO: en Railway guardás el JSON como texto (una sola línea)
  const creds = JSON.parse(SA_JSON);

  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

async function uploadImageToDrive(auth, { base64DataUrl, fileName }) {
  const drive = google.drive({ version: "v3", auth });

  // base64DataUrl: "data:image/png;base64,AAAA..."
  const match = base64DataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error("foto no es DataURL base64 válido");

  const mimeType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");

  const createRes = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [DRIVE_FOLDER_ID],
    },
    media: {
      mimeType,
      body: require("stream").Readable.from(buffer),
    },
    fields: "id, webViewLink",
  });

  const fileId = createRes.data.id;

  // Hacerla visible "anyone with the link" (para que Sheets/App la vean)
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  // Link directo tipo "uc?export=view&id="
  const directUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
  return { fileId, directUrl };
}

async function appendRowToSheet(auth, rowValues) {
  const sheets = google.sheets({ version: "v4", auth });

  // Append al final
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A:Z`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowValues],
    },
  });
}

// Espera: [{id, fecha, turno, tipo, equipo, descripcion, operador, area, foto(base64DataURL)}]
app.post("/api/reports", async (req, res) => {
  try {
    const reports = req.body;
    if (!Array.isArray(reports)) {
      return res.status(400).json({ error: "Array expected" });
    }

    const auth = getAuth();
    await auth.authorize();

    for (const r of reports) {
      let fotoUrl = "";
      if (r.foto && typeof r.foto === "string" && r.foto.startsWith("data:image")) {
        const up = await uploadImageToDrive(auth, {
          base64DataUrl: r.foto,
          fileName: `reporte_${r.id || Date.now()}.png`,
        });
        fotoUrl = up.directUrl;
      }

      // Ajustá este orden EXACTO a tus columnas de Google Sheet
      // Ejemplo columnas: ID | FechaHora | Turno | TipoReporte | Equipo | Descripcion | Operario | Area | LinkFoto
      const row = [
        r.id || "",
        r.fecha || "",
        r.turno || "",
        r.tipo || "",
        r.equipo || "",
        r.descripcion || "",
        r.operador || "",
        r.area || "",
        fotoUrl,
      ];

      await appendRowToSheet(auth, row);
    }

    return res.json({ success: true, count: reports.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("OK backend-reportes (Sheets+Drive)"));

app.listen(PORT, () => console.log(`Server running on :${PORT}`));
