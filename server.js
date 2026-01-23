import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { Resvg } from "@resvg/resvg-js";

const app = express();
app.use(express.json({ limit: "5mb" }));

/* =========================================================
   STORE TEMPORÁRIO DE IMAGENS (igual ao seu original)
   ========================================================= */
const store = new Map(); // id -> { buf, mime, exp }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.exp < now) store.delete(k);
  }
}, 60_000);

app.get("/img/:id", (req, res) => {
  const v = store.get(req.params.id);
  if (!v) return res.status(404).send("not found");
  res.setHeader("Content-Type", v.mime || "image/png");
  res.setHeader("Cache-Control", "public, max-age=600");
  return res.send(v.buf);
});

app.get("/", (_, res) => res.status(200).send("ok"));
app.get("/health", (_, res) => res.status(200).send("ok"));

/* =========================================================
   HELPERS
   ========================================================= */
const esc = (s = "") =>
  String(s)
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

/* =========================================================
   TEXT WRAP (evita estourar em uma linha)
   =========================================================
   - Heurística de largura por caractere (boa o bastante p/ posts)
   - Ajuste "CHAR_WIDTH_FACTOR" se quiser mais/menos quebra
   ========================================================= */
const CHAR_WIDTH_FACTOR_SERIF = 0.56; // Playfair (headline/sub)
const CHAR_WIDTH_FACTOR_SANS = 0.52;  // Rubik

function wrapByWords(text, maxWidthPx, fontSizePx, charFactor) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return [];

  const maxChars = Math.max(8, Math.floor(maxWidthPx / (fontSizePx * charFactor)));
  const words = t.split(" ");
  const lines = [];

  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length <= maxChars) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // se uma palavra gigante vier, quebra “na marra”
    if (w.length > maxChars) {
      let chunk = w;
      while (chunk.length > maxChars) {
        lines.push(chunk.slice(0, maxChars));
        chunk = chunk.slice(maxChars);
      }
      line = chunk;
    } else {
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function tspans(lines, x, startDy, dy) {
  // primeiro tspan dy=startDy, próximos dy=dy
  return lines
    .map((ln, idx) => {
      const d = idx === 0 ? startDy : dy;
      return `<tspan x="${x}" dy="${d}">${esc(ln)}</tspan>`;
    })
    .join("");
}

/* =========================================================
   GOOGLE FONTS -> EMBED NO SVG (WOFF2 BASE64)
   =========================================================
   Isso garante que a fonte fique igual SEM depender de fonte do sistema.
   ========================================================= */
async function fetchGoogleFontsCss(familyQuery) {
  // Força retorno woff2
  const url = `https://fonts.googleapis.com/css2?${familyQuery}&display=swap`;
  const r = await fetch(url, {
    headers: {
      // user-agent ajuda a garantir woff2
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
  });
  if (!r.ok) throw new Error(`fonts css fetch failed: ${r.status}`);
  return await r.text();
}

async function embedFontFromCss(cssText) {
  // pega todas urls woff2 e substitui por data-uri
  const urls = [...cssText.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)\s*format\('woff2'\)/g)]
    .map(m => m[1]);

  let out = cssText;
  for (const u of urls) {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`font file fetch failed: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const b64 = buf.toString("base64");
    out = out.replaceAll(u, `data:font/woff2;base64,${b64}`);
  }
  return out;
}

// Carrega fonts 1x no boot (com cache em memória)
let EMBEDDED_FONT_CSS = "";
async function loadFontsOnce() {
  if (EMBEDDED_FONT_CSS) return EMBEDDED_FONT_CSS;

  // ✅ SUA ESCOLHA:
  // kicker: Rubik 500
  // brand: Rubik Microbe (regular)
  // headline/sub: Playfair Display (regular + italic)
  //
  // (opções não usadas, deixei aqui):
  // - Merriweather
  // - Lora

  const cssRubik = await fetchGoogleFontsCss("family=Rubik:wght@500");
  const cssMicrobe = await fetchGoogleFontsCss("family=Rubik+Microbe");
  const cssPlayfair = await fetchGoogleFontsCss("family=Playfair+Display:ital,wght@0,400;1,400");

  // Se quiser trocar, descomente e adicione:
  // const cssMerriweather = await fetchGoogleFontsCss("family=Merriweather:ital,wght@0,400;1,400");
  // const cssLora = await fetchGoogleFontsCss("family=Lora:ital,wght@0,400;1,400");

  const embeddedRubik = await embedFontFromCss(cssRubik);
  const embeddedMicrobe = await embedFontFromCss(cssMicrobe);
  const embeddedPlayfair = await embedFontFromCss(cssPlayfair);

  EMBEDDED_FONT_CSS = `${embeddedRubik}\n${embeddedMicrobe}\n${embeddedPlayfair}`;
  return EMBEDDED_FONT_CSS;
}

// dispara no boot (não bloqueia requests; se falhar, cai em fallback)
loadFontsOnce().catch((e) => console.error("FONT_BOOT_ERROR:", e));

/* =========================================================
   (A) CARROSSEL - SVG → PNG
   Espera: { slides: [...] }
   Retorna: { urls: [...] }
   ========================================================= */
app.post("/render", async (req, res) => {
  const slides = req.body?.slides;

  if (!Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ error: "Body must include { slides: [...] }" });
  }

  try {
    const width = 1080;
    const height = 1080;
    const ttlMs = 30 * 60 * 1000;
    const urls = [];

    const fontCss = EMBEDDED_FONT_CSS || "";

    for (let i = 0; i < slides.length; i++) {
      const text = String(slides[i] ?? "").trim();
      const progress = Math.round(((i + 1) / slides.length) * 100);

      // wrap do título do slide (fonte grande)
      const maxTextWidth = 920;     // semelhante ao card do seu HTML (920px de área útil)
      const titleFont = 72;
      const lines = wrapByWords(text, maxTextWidth, titleFont, CHAR_WIDTH_FACTOR_SANS).slice(0, 6);

      const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <style>
      ${fontCss}
      .badge{font-family:Rubik, Arial, Helvetica, sans-serif;font-weight:500;font-size:26px;letter-spacing:1px;fill:rgba(255,255,255,.8)}
      .h1{font-family:Rubik, Arial, Helvetica, sans-serif;font-weight:500;font-size:${titleFont}px;fill:#fff}
      .p{font-family:Rubik, Arial, Helvetica, sans-serif;font-weight:400;font-size:36px;fill:rgba(255,255,255,.9)}
      .footer{font-family:Rubik, Arial, Helvetica, sans-serif;font-weight:400;font-size:24px;fill:rgba(255,255,255,.7)}
    </style>

    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1c2d"/>
      <stop offset="100%" stop-color="#0f2a44"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="url(#grad)"/>

  <g transform="translate(80,90)">
    <text class="badge">Renda Real Cast ${i + 1} / ${slides.length}</text>

    <text class="h1" y="150">
      ${tspans(lines, 0, 0, Math.round(titleFont * 1.12))}
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

      const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
      const id = crypto.randomUUID();
      store.set(id, { buf: Buffer.from(png), mime: "image/png", exp: Date.now() + ttlMs });
      urls.push(`${baseUrl(req)}/img/${id}`);
    }

    return res.json({ urls });
  } catch (err) {
    console.error("SVG_CAROUSEL_ERROR:", err);
    return res.status(500).json({ error: "render_failed" });
  }
});

/* =========================================================
   (B) POST ÚNICO - SVG → PNG (estilo Economist)
   Espera: { headline, subheadline?, kicker?, brand?, bg? }
   Retorna: { url }
   ========================================================= */
app.post("/render-post", async (req, res) => {
  try {
    const headline = (req.body?.headline ?? "").toString().trim();
    const subheadline = (req.body?.subheadline ?? "").toString().trim();

    // ✅ variáveis FIÉIS ao seu fluxo/code
    const kicker = (req.body?.kicker ?? "Mercado Imobiliário").toString().trim();
    const brand = (req.body?.brand ?? "Renda Real Cast").toString().trim();
    const bg = (req.body?.bg ?? "").toString().trim();

    if (!headline) {
      return res.status(400).json({ error: 'Body must include { headline: "..." }' });
    }

    const width = 1080;
    const height = 1350;
    const ttlMs = 30 * 60 * 1000;

    const fontCss = EMBEDDED_FONT_CSS || "";
    const bgData = await toDataUri(bg);

    // Área do topo (texto) ~ igual ao seu HTML (46% conteúdo, 54% imagem)
    const topH = Math.round(height * 0.46);
    const imgY = topH;

    // Layout grid “Economist-like”
    const leftPad = 90;
    const rightPad = 90;
    const textW = width - leftPad - rightPad;

    // Tipos (ajustáveis)
    const kickerSize = 22;          // kicker Rubik 500
    const headlineSize = 76;        // Playfair grande “estiloso”
    const subSize = 30;             // Playfair italic

    // Wrap
    const headlineLines = wrapByWords(headline, textW, headlineSize, CHAR_WIDTH_FACTOR_SERIF).slice(0, 5);
    const subLines = subheadline
      ? wrapByWords(subheadline, textW, subSize, CHAR_WIDTH_FACTOR_SERIF).slice(0, 4)
      : [];

    const headlineDy = Math.round(headlineSize * 1.08);
    const subDy = Math.round(subSize * 1.35);

    // Posições
    const y0 = 120;                 // topo do bloco
    const kickerY = y0;
    const ruleY = kickerY + 18;
    const ruleH = 4;
    const headlineY = ruleY + 55;   // início do headline

    // sub começa depois do headline renderizado
    const headlineBlockH = headlineLines.length * headlineDy;
    const subStartY = headlineY + headlineBlockH + 28;

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <style>
      ${fontCss}

      /* ========= FONTES ESCOLHIDAS ========= */
      .kicker{
        font-family: Rubik, Arial, Helvetica, sans-serif;
        font-weight: 500; /* Medium 500 */
        font-size:${kickerSize}px;
        letter-spacing: 1px;
        fill: rgba(255,255,255,.92);
      }
      .headline{
        font-family: "Playfair Display", serif;
        font-weight: 400;
        font-size:${headlineSize}px;
        fill:#fff;
      }
      .sub{
        font-family: "Playfair Display", serif;
        font-style: italic;
        font-weight: 400;
        font-size:${subSize}px;
        fill: rgba(255,255,255,.92);
      }
      .brand{
        font-family: "Rubik Microbe", Rubik, Arial, Helvetica, sans-serif;
        font-weight: 400;
        font-size:18px;
        fill: rgba(255,255,255,.70);
      }

      /* ========= (OPÇÕES NÃO USADAS) =========
      .headline{ font-family: Merriweather, serif; }
      .headline{ font-family: Lora, serif; }
      */
    </style>

    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,.70)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,.20)"/>
    </linearGradient>
  </defs>

  <!-- fundo -->
  <rect width="100%" height="100%" fill="#000"/>

  <!-- brand (mais margem da direita e alinhado "end") -->
  <text class="brand" x="${width - 120}" y="60" text-anchor="end">${esc(brand)}</text>

  <!-- bloco de texto superior -->
  <g transform="translate(${leftPad},0)">
    <text class="kicker" y="${kickerY}">${esc(kicker)}</text>
    <rect x="0" y="${ruleY}" width="110" height="${ruleH}" fill="#e3120b"/>

    <text class="headline" y="${headlineY}">
      ${tspans(headlineLines, 0, 0, headlineDy)}
    </text>

    ${subLines.length ? `
    <text class="sub" y="${subStartY}">
      ${tspans(subLines, 0, 0, subDy)}
    </text>` : ""}
  </g>

  <!-- imagem inferior -->
  ${bgData ? `
  <image href="${bgData}"
         x="0" y="${imgY}"
         width="${width}" height="${height - imgY}"
         preserveAspectRatio="xMidYMid slice"/>
  <rect x="0" y="${imgY}"
        width="${width}" height="${height - imgY}"
        fill="url(#fade)"/>` : ""}

</svg>`.trim();

    const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
    const id = crypto.randomUUID();

    store.set(id, { buf: Buffer.from(png), mime: "image/png", exp: Date.now() + ttlMs });

    return res.json({ url: `${baseUrl(req)}/img/${id}` });
  } catch (err) {
    console.error("SVG_POST_ERROR:", err);
    return res.status(500).json({ error: "render_post_failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
