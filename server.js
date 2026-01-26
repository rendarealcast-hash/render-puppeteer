import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Resvg } from "@resvg/resvg-js";

const app = express();
app.use(express.json({ limit: "5mb" }));

/* ================= PATH ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FONTS_DIR = path.join(__dirname, "fonts");

/* ================= FONT FILES ================= */
const FONT_PLAYFAIR = path.join(
  FONTS_DIR,
  "PlayfairDisplay-VariableFont_wght.ttf"
);
const FONT_RUBIK_BOLD = path.join(FONTS_DIR, "Rubik-Bold.ttf");
const FONT_RUBIK_MICROBE = path.join(
  FONTS_DIR,
  "RubikMicrobe-Regular.ttf"
);

// valida fontes
for (const f of [FONT_PLAYFAIR, FONT_RUBIK_BOLD, FONT_RUBIK_MICROBE]) {
  if (!fs.existsSync(f)) {
    throw new Error(`FONT_NOT_FOUND: ${path.basename(f)}`);
  }
}

/* ================= IMAGE STORE ================= */
const store = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.exp < now) store.delete(k);
  }
}, 60_000);

app.get("/img/:id", (req, res) => {
  const v = store.get(req.params.id);
  if (!v) return res.status(404).send("not found");
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=600");
  res.send(v.buf);
});

app.get("/", (_, res) => res.send("ok"));
app.get("/health", (_, res) => res.send("ok"));

/* ================= HELPERS ================= */
const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${proto}://${req.get("host")}`;
}

async function toDataUri(url) {
  if (!url) return "";
  const r = await fetch(url);
  if (!r.ok) throw new Error("BG_FETCH_FAILED");
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get("content-type") || "image/jpeg";
  return `data:${ct};base64,${buf.toString("base64")}`;
}

/* ================= TEXT WRAP ================= */
function wrap(text, maxChars) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let line = "";

  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (test.length <= maxChars) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* ================= SVG TEMPLATE ================= */
function buildSVG({ subheadline, kicker, brand, bg }) {
  const W = 1080;
  const H = 1350;
  const TOP = Math.floor(H * 0.46);

  const lines = wrap(subheadline, 22).slice(0, 6);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="#000"/>

  <!-- BRAND -->
  <text x="${W - 130}" y="80"
        font-family="Rubik Microbe"
        font-size="32"
        fill="rgba(255,255,255,.7)"
        text-anchor="end">
    ${esc(brand)}
  </text>

  <!-- KICKER -->
  <text x="90" y="130"
        font-family="Rubik"
        font-weight="700"
        font-size="32"
        letter-spacing="1.5"
        fill="#fff">
    ${esc(kicker)}
  </text>

  <rect x="90" y="148" width="120" height="4" fill="#e3120b"/>

  <!-- SUBHEADLINE -->
  <text x="90" y="230"
        font-family="Playfair Display"
        font-weight="600"
        font-size="69"
        fill="#fff">
    ${lines
      .map(
        (l, i) =>
          `<tspan x="90" dy="${i === 0 ? 0 : "1.15em"}">${esc(l)}</tspan>`
      )
      .join("")}
  </text>

  ${
    bg
      ? `<image href="${bg}"
         x="0" y="${TOP}"
         width="${W}" height="${H - TOP}"
         preserveAspectRatio="xMidYMid slice"/>`
      : ""
  }
</svg>
`.trim();
}

/* ================= ENDPOINT ================= */
app.post("/render-post", async (req, res) => {
  try {
    const { subheadline, kicker, brand, bg } = req.body;

    if (!subheadline) {
      return res.status(400).json({ error: "subheadline_required" });
    }

    const bgData = await toDataUri(bg);
    const svg = buildSVG({
      subheadline,
      kicker,
      brand,
      bg: bgData,
    });

    const png = new Resvg(svg, {
      font: {
        loadSystemFonts: false,
        fontFiles: [FONT_PLAYFAIR, FONT_RUBIK_BOLD, FONT_RUBIK_MICROBE],
      },
      fitTo: { mode: "width", value: 1080 },
    })
      .render()
      .asPng();

    const id = crypto.randomUUID();
    store.set(id, { buf: png, exp: Date.now() + 30 * 60 * 1000 });

    res.json({ url: `${baseUrl(req)}/img/${id}` });
  } catch (err) {
    console.error("RENDER_ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("SERVER OK — fonts locked, wrap stable, no fallback");
});
