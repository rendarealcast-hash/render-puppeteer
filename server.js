import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { Resvg } from "@resvg/resvg-js";

const app = express();
app.use(express.json({ limit: "5mb" }));

/* =========================================================
   STORE TEMPORÁRIO DE IMAGENS
   ========================================================= */
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

/* =========================================================
   HELPERS
   ========================================================= */
const esc = (s = "") =>
  String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");

function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https")
    .toString().split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

async function toDataUri(url) {
  if (!url) return "";
  const r = await fetch(url);
  if (!r.ok) throw new Error("image fetch failed");
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get("content-type") || "image/jpeg";
  return `data:${ct};base64,${buf.toString("base64")}`;
}

/* =========================================================
   FONTES — EMBUTIDAS SEMPRE (GARANTIA VISUAL)
   ========================================================= */
async function loadFonts() {
  const fonts = [
    // Rubik Medium 500 (kicker)
    "family=Rubik:wght@500",
    // Rubik Microbe (brand)
    "family=Rubik+Microbe",
    // Playfair Display (texto principal)
    "family=Playfair+Display:ital,wght@0,400;1,400"
  ].join("&");

  const cssUrl = `https://fonts.googleapis.com/css2?${fonts}&display=swap`;
  const cssRes = await fetch(cssUrl, {
    headers: { "user-agent": "Mozilla/5.0 Chrome/120" }
  });
  const css = await cssRes.text();

  const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g)]
    .map(m => m[1]);

  let out = css;
  for (const u of urls) {
    const r = await fetch(u);
    const b = Buffer.from(await r.arrayBuffer()).toString("base64");
    out = out.replaceAll(u, `data:font/woff2;base64,${b}`);
  }
  return out;
}

/* =========================================================
   TEXT WRAP + LIMITE DE ALTURA
   ========================================================= */
function wrapText(text, maxWidthPx, fontSizePx) {
  const approxChar = fontSizePx * 0.56;
  const maxChars = Math.floor(maxWidthPx / approxChar);
  const words = text.split(" ");
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

/* =========================================================
   POST ÚNICO — DEFINITIVO
   subheadline = TEXTO DO POST
   headline = APENAS PARA LEGENDA (IGNORADO AQUI)
   ========================================================= */
app.post("/render-post", async (req, res) => {
  try {
    const {
      subheadline,        // <-- TEXTO PRINCIPAL
      kicker = "Mercado Imobiliário",
      brand = "Renda Real Cast",
      bg = ""
    } = req.body || {};

    if (!subheadline) {
      return res.status(400).json({ error: "subheadline_required" });
    }

    const width = 1080;
    const height = 1350;
    const topArea = Math.round(height * 0.46);
    const textWidth = width - 180;

    const fontCss = await loadFonts();
    const bgData = await toDataUri(bg);

    const fontSize = 64; // tamanho editorial forte
    const lineHeight = Math.round(fontSize * 1.15);
    const maxLines = Math.floor((topArea - 200) / lineHeight);

    const lines = wrapText(subheadline, textWidth, fontSize).slice(0, maxLines);

    const tspans = lines.map((l, i) =>
      `<tspan x="0" dy="${i === 0 ? 0 : lineHeight}">${esc(l)}</tspan>`
    ).join("");

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <style>
      ${fontCss}

      .kicker{
        font-family:Rubik,Arial,Helvetica,sans-serif;
        font-weight:500;
        font-size:22px;
        letter-spacing:1px;
        fill:rgba(255,255,255,.9);
      }
      .headline{
        font-family:"Playfair Display",serif;
        font-size:${fontSize}px;
        fill:#fff;
      }
      .brand{
        font-family:"Rubik Microbe",Rubik,Arial,sans-serif;
        font-size:18px;
        fill:rgba(255,255,255,.7);
      }
    </style>

    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,.65)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,.25)"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="#000"/>

  <!-- brand -->
  <text class="brand" x="${width - 120}" y="60" text-anchor="end">${esc(brand)}</text>

  <!-- texto -->
  <g transform="translate(90,120)">
    <text class="kicker">${esc(kicker)}</text>
    <rect y="18" width="110" height="4" fill="#e3120b"/>
    <text class="headline" y="90">${tspans}</text>
  </g>

  <!-- imagem -->
  ${bgData ? `
  <image href="${bgData}"
         x="0" y="${topArea}"
         width="${width}" height="${height - topArea}"
         preserveAspectRatio="xMidYMid slice"/>
  <rect x="0" y="${topArea}"
        width="${width}" height="${height - topArea}"
        fill="url(#fade)"/>` : ""}

</svg>`.trim();

    const png = new Resvg(svg).render().asPng();
    const id = crypto.randomUUID();
    store.set(id, { buf: Buffer.from(png), mime: "image/png", exp: Date.now() + 30 * 60 * 1000 });

    res.json({ url: `${baseUrl(req)}/img/${id}` });

  } catch (err) {
    console.error("RENDER_ERROR:", err);
    res.status(500).json({ error: "render_post_failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("SVG server running on", PORT));
