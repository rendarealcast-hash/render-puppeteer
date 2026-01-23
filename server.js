import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { Resvg } from "@resvg/resvg-js";

const app = express();
app.use(express.json({ limit: "5mb" }));

/* =========================================================
   STORE TEMPORÁRIO DE IMAGENS (igual ao seu original)
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

async function toDataUri(url) {
  if (!url) return "";
  const r = await fetch(url);
  if (!r.ok) throw new Error("image fetch failed");
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get("content-type") || "image/jpeg";
  return `data:${ct};base64,${buf.toString("base64")}`;
}

function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https")
    .toString().split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

/* =========================================================
   TEMPLATE: POST ÚNICO (ESTILO ECONOMIST)
   =========================================================
   ▶ VARIÁVEIS ESPERADAS:
   { headline, subheadline?, kicker?, brand?, bg? }

   ▶ PARA CRIAR NOVO TEMPLATE:
   - Duplique este endpoint
   - Mude APENAS o SVG abaixo
   - Mantenha o contrato de payload
   ========================================================= */
app.post("/render-post", async (req, res) => {
  try {
    const {
      headline,
      subheadline = "",
      kicker = "A deadly collision",
      brand = "@rendarealcast",
      bg = ""
    } = req.body || {};

    if (!headline) {
      return res.status(400).json({ error: "headline_required" });
    }

    const width = 1080;
    const height = 1350;
    const ttlMs = 30 * 60 * 1000;

    const bgData = await toDataUri(bg);

    /* =========================================================
       SVG TEMPLATE — EDITE AQUI (TIPOGRAFIA / TAMANHOS)
       ========================================================= */
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>

    <!-- Fonte serif editorial (substitui Georgia/Times) -->
    <style>
      @font-face {
        font-family: 'LibreBaskerville';
        font-weight: 400;
        src: local('Libre Baskerville');
      }

      .kicker {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 22px;
        letter-spacing: 1px;
        fill: #ffffff;
        opacity: .9;
      }

      .headline {
        font-family: 'LibreBaskerville', Georgia, serif;
        font-size: 74px;
        line-height: 1.08;
        fill: #ffffff;
      }

      .sub {
        font-family: 'LibreBaskerville', Georgia, serif;
        font-size: 30px;
        line-height: 1.35;
        fill: rgba(255,255,255,.92);
        font-style: italic;
      }

      .brand {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 18px;
        fill: rgba(255,255,255,.7);
      }
    </style>

    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,.65)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,.25)"/>
    </linearGradient>

  </defs>

  <!-- FUNDO PRETO -->
  <rect width="100%" height="100%" fill="#000"/>

  <!-- BLOCO DE TEXTO SUPERIOR -->
  <g transform="translate(90,120)">
    <text class="kicker">${esc(kicker)}</text>

    <text class="headline" y="95">
      <tspan x="0">${esc(headline)}</tspan>
    </text>

    ${subheadline ? `
    <text class="sub" y="220">
      <tspan x="0">${esc(subheadline)}</tspan>
    </text>` : ""}

    <text class="brand" x="${width - 260}" y="-40">${esc(brand)}</text>
  </g>

  <!-- IMAGEM INFERIOR -->
  ${bgData ? `
  <image href="${bgData}"
         x="0"
         y="${height * 0.45}"
         width="${width}"
         height="${height * 0.55}"
         preserveAspectRatio="xMidYMid slice"/>
  <rect x="0"
        y="${height * 0.45}"
        width="${width}"
        height="${height * 0.55}"
        fill="url(#fade)"/>` : ""}

</svg>`.trim();

    const png = new Resvg(svg, {
      fitTo: { mode: "width", value: width }
    }).render().asPng();

    const id = crypto.randomUUID();
    store.set(id, {
      buf: Buffer.from(png),
      mime: "image/png",
      exp: Date.now() + ttlMs
    });

    res.json({ url: `${baseUrl(req)}/img/${id}` });

  } catch (err) {
    console.error("SVG_RENDER_ERROR:", err);
    res.status(500).json({ error: "render_post_failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("SVG server running on", PORT));
