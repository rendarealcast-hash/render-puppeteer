import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Resvg } from "@resvg/resvg-js";

const app = express();
app.use(express.json({ limit: "6mb" }));

/* ===================== PATHS (ESM-safe) ===================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ SUA PASTA REAL: /fonts (plural)
const FONTS_DIR = path.resolve(__dirname, "..", "fonts");

/* ===================== IMAGE STORE ===================== */
const store = new Map(); // id -> { buf, exp }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store.entries()) if (v.exp < now) store.delete(k);
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

/* ===================== HELPERS ===================== */
const esc = (s = "") =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https")
    .toString()
    .split(",")[0]
    .trim();
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

async function toDataUri(url) {
  if (!url) return "";
  const r = await fetch(url);
  if (!r.ok) throw new Error(`image fetch failed: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get("content-type") || "image/jpeg";
  return `data:${ct};base64,${buf.toString("base64")}`;
}

function renderPng(svg, width = 1080) {
  return new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
}

function putImageAndReturnUrl(req, pngBuf, ttlMs = 30 * 60 * 1000) {
  const id = crypto.randomUUID();
  store.set(id, { buf: Buffer.from(pngBuf), exp: Date.now() + ttlMs });
  return `${baseUrl(req)}/img/${id}`;
}

/* ===================== FONTS: LOCAL TTF ===================== */
function readFontBase64(filename) {
  const p = path.join(FONTS_DIR, filename);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p).toString("base64");
}

// ✅ NOMES EXATOS dos arquivos que você disse que subiu
const TTF_PLAYFAIR_REG = readFontBase64("PlayfairDisplay-VariableFont_wght.ttf");
const TTF_PLAYFAIR_ITAL = readFontBase64("PlayfairDisplay-Italic-VariableFont_wght.ttf");
const TTF_LORA_REG = readFontBase64("Lora-VariableFont_wght.ttf");
const TTF_LORA_ITAL = readFontBase64("Lora-Italic-VariableFont_wght.ttf");
const TTF_RUBIK_BOLD = readFontBase64("Rubik-Bold.ttf");
const TTF_RUBIK_EXTRABOLD = readFontBase64("Rubik-ExtraBold.ttf");
const TTF_RUBIK_MICROBE = readFontBase64("RubikMicrobe-Regular.ttf");

function missingFonts() {
  const miss = [];
  if (!TTF_PLAYFAIR_REG) miss.push("PlayfairDisplay-VariableFont_wght.ttf");
  if (!TTF_PLAYFAIR_ITAL) miss.push("PlayfairDisplay-Italic-VariableFont_wght.ttf");
  if (!TTF_RUBIK_BOLD) miss.push("Rubik-Bold.ttf");
  if (!TTF_RUBIK_MICROBE) miss.push("RubikMicrobe-Regular.ttf");
  return miss;
}

/**
 * Nota:
 * - Você queria Rubik Medium 500, mas você não subiu um arquivo Rubik 500.
 * - Então kicker vai usar Rubik Bold (700).
 * - Se você adicionar Rubik-Medium.ttf depois, eu ajusto em 10s.
 */
const LOCAL_FONT_CSS = `
/* ===== LOCAL FONTS (TTF base64) ===== */
@font-face{
  font-family:'PlayfairDisplay';
  font-style:normal;
  font-weight:400;
  src:url(data:font/ttf;base64,${TTF_PLAYFAIR_REG}) format('truetype');
}
@font-face{
  font-family:'PlayfairDisplay';
  font-style:italic;
  font-weight:400;
  src:url(data:font/ttf;base64,${TTF_PLAYFAIR_ITAL}) format('truetype');
}
@font-face{
  font-family:'Rubik';
  font-style:normal;
  font-weight:700;
  src:url(data:font/ttf;base64,${TTF_RUBIK_BOLD}) format('truetype');
}
@font-face{
  font-family:'Rubik';
  font-style:normal;
  font-weight:800;
  src:url(data:font/ttf;base64,${TTF_RUBIK_EXTRABOLD}) format('truetype');
}
@font-face{
  font-family:'RubikMicrobe';
  font-style:normal;
  font-weight:400;
  src:url(data:font/ttf;base64,${TTF_RUBIK_MICROBE}) format('truetype');
}

/* ===== OPÇÕES (DISPONÍVEIS, NÃO USADAS AGORA) =====
@font-face{
  font-family:'Lora';
  font-style:normal;
  font-weight:400;
  src:url(data:font/ttf;base64,${TTF_LORA_REG}) format('truetype');
}
@font-face{
  font-family:'Lora';
  font-style:italic;
  font-weight:400;
  src:url(data:font/ttf;base64,${TTF_LORA_ITAL}) format('truetype');
}
*/
`.trim();

/* ===================== WRAP + AUTO FIT ===================== */
function wrapByWords(text, maxWidthPx, fontSizePx, charFactor = 0.56) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return [];
  const maxChars = Math.max(10, Math.floor(maxWidthPx / (fontSizePx * charFactor)));
  const words = t.split(" ");
  const lines = [];
  let line = "";

  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length <= maxChars) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function tspans(lines, x, startDy, dy) {
  return lines
    .map((ln, i) => `<tspan x="${x}" dy="${i === 0 ? startDy : dy}">${esc(ln)}</tspan>`)
    .join("");
}

function fitTextToBox({
  text,
  maxWidthPx,
  maxHeightPx,
  maxFont = 84,
  minFont = 40,
  lineHeightFactor = 1.12,
  maxLines = 6,
  charFactor = 0.56,
}) {
  const clean = String(text || "").trim();
  if (!clean) {
    const lh = Math.round(minFont * lineHeightFactor);
    return { fontSize: minFont, lineHeight: lh, lines: [] };
  }

  for (let fs = maxFont; fs >= minFont; fs -= 2) {
    const lh = Math.round(fs * lineHeightFactor);
    const lines = wrapByWords(clean, maxWidthPx, fs, charFactor).slice(0, maxLines);
    const h = lines.length * lh;
    if (h <= maxHeightPx) return { fontSize: fs, lineHeight: lh, lines };
  }

  const fs = minFont;
  const lh = Math.round(fs * lineHeightFactor);
  return {
    fontSize: fs,
    lineHeight: lh,
    lines: wrapByWords(clean, maxWidthPx, fs, charFactor).slice(0, maxLines),
  };
}

/* ===================== TEMPLATES ===================== */
/**
 * POST ÚNICO (Economist-ish)
 * ✅ subheadline = texto principal da imagem
 * ❌ headline não aparece aqui (vai na legenda do n8n)
 */
function buildRenderPostSvg({ width, height, kicker, brand, mainText, bgDataUri }) {
  const topArea = Math.round(height * 0.46);
  const leftPad = 90;
  const rightPad = 90;
  const textW = width - leftPad - rightPad;

  const yStart = 120;
  const ruleY = yStart + 18;
  const textY = yStart + 90;

  // espaço real antes da imagem (nunca invade)
  const availableTextH = topArea - textY - 40;

  const fitted = fitTextToBox({
    text: mainText,
    maxWidthPx: textW,
    maxHeightPx: availableTextH,
    maxFont: 84,
    minFont: 44,
    lineHeightFactor: 1.12,
    maxLines: 6,
    charFactor: 0.56,
  });

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <style>
      ${LOCAL_FONT_CSS}

      .kicker{
        font-family: Rubik, Arial, sans-serif;
        font-weight: 700;
        font-size: 22px;
        letter-spacing: 1px;
        fill: rgba(255,255,255,.92);
      }
      .main{
        font-family: PlayfairDisplay, serif;
        font-weight: 400;
        font-style: normal;
        font-size: ${fitted.fontSize}px;
        fill: #fff;
      }
      .brand{
        font-family: RubikMicrobe, Rubik, Arial, sans-serif;
        font-weight: 400;
        font-size: 18px;
        fill: rgba(255,255,255,.70);
      }
    </style>

    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,.70)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,.20)"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="#000"/>

  <!-- brand (mais margem da direita) -->
  <text class="brand" x="${width - 130}" y="60" text-anchor="end">${esc(brand)}</text>

  <g transform="translate(${leftPad},0)">
    <text class="kicker" y="${yStart}">${esc(kicker)}</text>
    <rect x="0" y="${ruleY}" width="110" height="4" fill="#e3120b"/>

    <text class="main" y="${textY}">
      ${tspans(fitted.lines, 0, 0, fitted.lineHeight)}
    </text>
  </g>

  ${bgDataUri ? `
  <image href="${bgDataUri}"
         x="0" y="${topArea}"
         width="${width}" height="${height - topArea}"
         preserveAspectRatio="xMidYMid slice"/>
  <rect x="0" y="${topArea}"
        width="${width}" height="${height - topArea}"
        fill="url(#fade)"/>` : ""}

</svg>`.trim();
}

/** CARROSSEL (estilo original) */
function buildCarouselSlideSvg({ width, height, slideText, idx, total }) {
  const fitted = fitTextToBox({
    text: slideText,
    maxWidthPx: 920,
    maxHeightPx: 380,
    maxFont: 76,
    minFont: 46,
    lineHeightFactor: 1.12,
    maxLines: 6,
    charFactor: 0.52,
  });

  const progress = Math.round(((idx + 1) / total) * 100);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <style>
      ${LOCAL_FONT_CSS}
      .badge{font-family:Rubik,Arial,sans-serif;font-weight:700;font-size:26px;letter-spacing:1px;fill:rgba(255,255,255,.8)}
      .h1{font-family:Rubik,Arial,sans-serif;font-weight:700;font-size:${fitted.fontSize}px;fill:#fff}
      .p{font-family:Rubik,Arial,sans-serif;font-weight:400;font-size:36px;fill:rgba(255,255,255,.9)}
      .footer{font-family:Rubik,Arial,sans-serif;font-weight:400;font-size:24px;fill:rgba(255,255,255,.7)}
    </style>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1c2d"/>
      <stop offset="100%" stop-color="#0f2a44"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="url(#grad)"/>

  <g transform="translate(80,90)">
    <text class="badge">Renda Real Cast ${idx + 1} / ${total}</text>

    <text class="h1" y="150">
      ${tspans(fitted.lines, 0, 0, fitted.lineHeight)}
    </text>

    <text class="p" y="520">Economia e Imóveis em 3 min!</text>

    <g transform="translate(0,760)">
      <text class="footer">@rendarealcast</text>
      <text class="footer" x="780">Arraste →</text>
      <rect y="24" width="920" height="6" rx="3" fill="rgba(255,255,255,.15)"/>
      <rect y="24" width="${(920 * progress) / 100}" height="6" rx="3" fill="#4da3ff"/>
    </g>
  </g>
</svg>`.trim();
}

/* ===================== ENDPOINTS ===================== */

app.post("/render", async (req, res) => {
  const slides = req.body?.slides;
  if (!Array.isArray(slides) || !slides.length) {
    return res.status(400).json({ error: "Body must include { slides: [...] }" });
  }

  const miss = missingFonts();
  if (miss.length) {
    return res.status(500).json({
      error: "fonts_missing",
      message: `Missing fonts in /fonts: ${miss.join(", ")}`
    });
  }

  try {
    const width = 1080, height = 1080;
    const urls = [];

    for (let i = 0; i < slides.length; i++) {
      const svg = buildCarouselSlideSvg({
        width,
        height,
        slideText: String(slides[i] ?? ""),
        idx: i,
        total: slides.length,
      });
      const png = renderPng(svg, width);
      urls.push(putImageAndReturnUrl(req, png));
    }

    res.json({ urls });
  } catch (e) {
    console.error("CAROUSEL_RENDER_ERROR:", e);
    res.status(500).json({ error: "render_failed" });
  }
});

app.post("/render-post", async (req, res) => {
  // ✅ subheadline é o TEXTO do post
  const subheadline = String(req.body?.subheadline ?? "").trim();
  const kicker = String(req.body?.kicker ?? "Mercado Imobiliário").trim();
  const brand = String(req.body?.brand ?? "Renda Real Cast").trim();
  const bg = String(req.body?.bg ?? "").trim();

  if (!subheadline) return res.status(400).json({ error: "subheadline_required" });

  const miss = missingFonts();
  if (miss.length) {
    return res.status(500).json({
      error: "fonts_missing",
      message: `Missing fonts in /fonts: ${miss.join(", ")}`
    });
  }

  try {
    const width = 1080, height = 1350;
    const bgDataUri = await toDataUri(bg);

    const svg = buildRenderPostSvg({
      width,
      height,
      kicker,
      brand,
      mainText: subheadline,
      bgDataUri
    });

    const png = renderPng(svg, width);
    const url = putImageAndReturnUrl(req, png);
    res.json({ url });
  } catch (e) {
    console.error("POST_RENDER_ERROR:", e);
    res.status(500).json({ error: "render_post_failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
