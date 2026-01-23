import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { Resvg } from "@resvg/resvg-js";

const app = express();
app.use(express.json({ limit: "5mb" }));

// ================= STORE DE IMAGENS (igual ao seu) =================
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
  res.send(v.buf);
});

app.get("/", (_, res) => res.send("ok"));
app.get("/health", (_, res) => res.send("ok"));

// ================= HELPERS =================
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
    .toString()
    .split(",")[0]
    .trim();
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

// ================= (A) CARROSSEL =================
// Espera: { slides: ["texto 1", "texto 2", ...] }
// Retorna: { urls: [...] }
app.post("/render", async (req, res) => {
  const slides = req.body?.slides;

  if (!Array.isArray(slides) || !slides.length) {
    return res.status(400).json({ error: "Body must include { slides: [...] }" });
  }

  try {
    const width = 1080;
    const height = 1080;
    const ttlMs = 30 * 60 * 1000;
    const urls = [];

    for (let i = 0; i < slides.length; i++) {
      const text = esc(slides[i]);
      const progress = Math.round(((i + 1) / slides.length) * 100);

      const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <style>
      .bg { fill: url(#grad); }
      .badge { font: 700 26px Arial, Helvetica, sans-serif; fill: rgba(255,255,255,.8); }
      .h1 { font: 700 72px Arial, Helvetica, sans-serif; fill: #fff; }
      .p { font: 400 36px Arial, Helvetica, sans-serif; fill: rgba(255,255,255,.9); }
      .footer { font: 400 24px Arial, Helvetica, sans-serif; fill: rgba(255,255,255,.7); }
    </style>

    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1c2d"/>
      <stop offset="100%" stop-color="#0f2a44"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" class="bg"/>

  <g transform="translate(80,90)">
    <text class="badge">Renda Real Cast ${i + 1} / ${slides.length}</text>

    <text class="h1" y="160">
      <tspan x="0">${text}</tspan>
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

      const png = new Resvg(svg).render().asPng();
      const id = crypto.randomUUID();

      store.set(id, {
        buf: Buffer.from(png),
        mime: "image/png",
        exp: Date.now() + ttlMs
      });

      urls.push(`${baseUrl(req)}/img/${id}`);
    }

    res.json({ urls });

  } catch (err) {
    console.error("SVG_CAROUSEL_ERROR:", err);
    res.status(500).json({ error: "render_failed" });
  }
});

// ================= (B) POST ÚNICO =================
// Espera: { headline, subheadline?, kicker?, brand?, bg? }
// Retorna: { url }
app.post("/render-post", async (req, res) => {
  try {
    const {
      headline,
      subheadline = "",
      kicker = "Economia & Mercado Imobiliário",
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

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <style>
      .brand { font: 700 18px Arial, Helvetica, sans-serif; fill: rgba(255,255,255,.75); }
      .kicker { font: 700 18px Arial, Helvetica, sans-serif; letter-spacing:2px; fill: rgba(255,255,255,.75); }
      .headline { font: 700 56px Georgia, "Times New Roman", serif; fill:#fff; }
      .sub { font: italic 28px Georgia, "Times New Roman", serif; fill: rgba(255,255,255,.9); }
    </style>

    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,.45)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,.2)"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="#0b0b0b"/>

  ${bgData ? `
  <image href="${bgData}"
         x="0" y="${height * 0.46}"
         width="${width}" height="${height * 0.54}"
         preserveAspectRatio="xMidYMid slice"/>
  <rect x="0" y="${height * 0.46}"
        width="${width}" height="${height * 0.54}"
        fill="url(#fade)"/>` : ""}

  <g transform="translate(90,120)">
    <text class="brand" x="${width - 260}" y="-40">${esc(brand)}</text>
    <text class="kicker">${esc(kicker).toUpperCase()}</text>
    <rect y="18" width="110" height="4" fill="#e3120b"/>

    <text class="headline" y="90">
      <tspan x="0">${esc(headline)}</tspan>
    </text>

    ${subheadline ? `
    <text class="sub" y="165">
      <tspan x="0">${esc(subheadline)}</tspan>
    </text>` : ""}
  </g>
</svg>`.trim();

    const png = new Resvg(svg).render().asPng();
    const id = crypto.randomUUID();

    store.set(id, {
      buf: Buffer.from(png),
      mime: "image/png",
      exp: Date.now() + ttlMs
    });

    res.json({ url: `${baseUrl(req)}/img/${id}` });

  } catch (err) {
    console.error("SVG_POST_ERROR:", err);
    res.status(500).json({ error: "render_post_failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("SVG server running on", PORT));
