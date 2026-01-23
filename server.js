import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Resvg } from "@resvg/resvg-js";

const app = express();
app.use(express.json({ limit: "6mb" }));

/* ================= PATHS ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FONTS_DIR = path.resolve(__dirname, "fonts");

/* ================= LOAD FONTS (BUFFER) ================= */
function loadFont(name) {
  const p = path.join(FONTS_DIR, name);
  if (!fs.existsSync(p)) {
    throw new Error(`FONT_MISSING: ${name}`);
  }
  return fs.readFileSync(p);
}

const FONT_PLAYFAIR = loadFont("PlayfairDisplay-VariableFont_wght.ttf");
const FONT_RUBIK_BOLD = loadFont("Rubik-Bold.ttf");
const FONT_RUBIK_MICROBE = loadFont("RubikMicrobe-Regular.ttf");

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

/* ================= HELPERS ================= */
const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

async function toDataUri(url) {
  if (!url) return "";
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get("content-type") || "image/jpeg";
  return `data:${ct};base64,${buf.toString("base64")}`;
}

function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${proto}://${req.get("host")}`;
}

/* ================= TEXT FIT ================= */
function wrap(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (t.length <= maxChars) line = t;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* ================= TEMPLATE ================= */
function buildSVG({ subheadline, kicker, brand, bg }) {
  const WIDTH = 1080;
  const HEIGHT = 1350;
  const TOP = Math.floor(HEIGHT * 0.46);

  const maxChars = 32;
  const lines = wrap(subheadline, maxChars).slice(0, 6);

  return `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#000"/>

  <text x="90" y="120"
        font-family="Rubik"
        font-weight="700"
        font-size="22"
        fill="#fff"
        letter-spacing="1">
    ${esc(kicker)}
  </text>

  <rect x="90" y="138" width="110" height="4" fill="#e3120b"/>

  <text x="90" y="210"
        font-family="Playfair Display"
        font-size="64"
        fill="#fff">
    ${lines.map((l, i) =>
      `<tspan x="90" dy="${i === 0 ? 0 : 72}">${esc(l)}</tspan>`
    ).join("")}
  </text>

  <text x="${WIDTH - 120}" y="60"
        font-family="Rubik Microbe"
        font-size="18"
        fill="rgba(255,255,255,.7)"
        text-anchor="end">
    ${esc(brand)}
  </text>

  ${bg ? `
  <image href="${bg}"
         x="0" y="${TOP}"
         width="${WIDTH}" height="${HEIGHT - TOP}"
         preserveAspectRatio="xMidYMid slice"/>` : ""}
</svg>
`.trim();
}

/* ================= ENDPOINT ================= */
/**
 * POST /render-post
 * Body:
 * { subheadline, kicker, brand, bg }
 */
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
      fonts: [
        { name: "Playfair Display", data: FONT_PLAYFAIR, weight: 400 },
        { name: "Rubik", data: FONT_RUBIK_BOLD, weight: 700 },
        { name: "Rubik Microbe", data: FONT_RUBIK_MICROBE, weight: 400 },
      ],
      fitTo: { mode: "width", value: 1080 },
    }).render().asPng();

    const id = crypto.randomUUID();
    store.set(id, { buf: png, exp: Date.now() + 30 * 60 * 1000 });

    res.json({ url: `${baseUrl(req)}/img/${id}` });
  } catch (e) {
    console.error("RENDER_ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("SVG server running on", PORT));
