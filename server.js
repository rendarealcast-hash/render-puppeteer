import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "25mb" }));

// ====== HOST DE IMAGENS (em memória) ======
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

  res.setHeader("Content-Type", v.mime || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=600");
  return res.send(v.buf);
});

app.get("/", (req, res) => res.status(200).send("ok"));
app.get("/health", (req, res) => res.status(200).send("ok"));

async function launchBrowser() {
  return puppeteer.launch({
    args: [...chromium.args, "--single-process"],
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
}

function escapeHtml(raw) {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ====== (A) CARROSSEL - mantém seu endpoint atual ======
app.post("/render", async (req, res) => {
  const slides = req.body?.slides;

  if (!Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ error: "Body must include { slides: [...] }" });
  }

  let browser;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

    const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https")
      .toString()
      .split(",")[0]
      .trim();
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const baseUrl = `${proto}://${host}`;

    const ttlMs = 30 * 60 * 1000;
    const urls = [];

    for (let i = 0; i < slides.length; i++) {
      const text = escapeHtml(slides[i]);
      const progress = Math.round(((i + 1) / slides.length) * 100);

      await page.setContent(
        `
        <html>
        <head>
          <style>
            body{margin:0;width:1080px;height:1080px;background:linear-gradient(135deg,#0b1c2d,#0f2a44);font-family:Arial;color:#fff;display:flex;align-items:center;justify-content:center}
            .card{width:920px;height:920px;padding:90px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between}
            .badge{font-size:26px;letter-spacing:1px;opacity:.8}
            h1{font-size:72px;line-height:1.1;margin:40px 0 20px;white-space:pre-wrap}
            p{font-size:36px;line-height:1.3;opacity:.9;margin:0}
            .footer{display:flex;justify-content:space-between;align-items:center;font-size:24px;opacity:.7}
            .bar{width:100%;height:6px;background:rgba(255,255,255,.15);border-radius:4px;overflow:hidden;margin-top:12px}
            .bar-fill{height:100%;width:${progress}%;background:#4da3ff}
          </style>
        </head>
        <body>
          <div class="card">
            <div>
              <div class="badge">Renda Real Cast ${i + 1} / ${slides.length}</div>
              <h1>${text}</h1>
              <p>Economia e Imóveis em 3 min!</p>
            </div>
            <div>
              <div class="footer"><span>@rendarealcast</span><span>Arraste →</span></div>
              <div class="bar"><div class="bar-fill"></div></div>
            </div>
          </div>
        </body>
        </html>
        `,
        { waitUntil: "load" }
      );

      const buffer = await page.screenshot({ type: "jpeg", quality: 90 });
      const id = crypto.randomUUID();
      store.set(id, { buf: buffer, mime: "image/jpeg", exp: Date.now() + ttlMs });
      urls.push(`${baseUrl}/img/${id}`);
    }

    return res.json({ urls });
  } catch (err) {
    console.error("RENDER_ERROR:", err);
    return res.status(500).json({ error: "render_failed" });
  } finally {
    if (browser) await browser.close();
  }
});

// ====== (B) POST ÚNICO - endpoint “The Economist style” ======
// Espera: { headline: "...", subheadline: "...", kicker?: "...", brand?: "...", bg?: "..." }
// Retorna: { url: "..." } (apenas 1)
app.post("/render-post", async (req, res) => {
  const headline = (req.body?.headline ?? "").toString().trim();
  const subheadline = (req.body?.subheadline ?? "").toString().trim();

  // opcionais
  const kicker = (req.body?.kicker ?? "Economia & Mercado Imobiliario").toString().trim();
  const brand = (req.body?.brand ?? "@rendarealcast").toString().trim();

  // bg: URL de uma imagem (opcional). Se vazio, usa gradiente.
  const bg = (req.body?.bg ?? "").toString().trim();

  if (!headline) {
    return res.status(400).json({ error: 'Body must include { headline: "..." }' });
  }

  let browser;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    // Formato recomendado p/ feed: 1080x1350
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });

    const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https")
      .toString()
      .split(",")[0]
      .trim();
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const baseUrl = `${proto}://${host}`;

    const ttlMs = 30 * 60 * 1000;

    const H = escapeHtml(headline);
    const S = escapeHtml(subheadline);
    const K = escapeHtml(kicker);
    const B = escapeHtml(brand);

    // ===== AJUSTE CIRÚRGICO: detectar infográfico e usar contain =====
    const isGraphic =
      /\.png(\?|$)/i.test(bg) ||
      /infogra|grafico|chart|diagram|svg/i.test(bg);

    const bgCss = bg
      ? `background-image:
            linear-gradient(180deg, rgba(0,0,0,.45), rgba(0,0,0,.20)),
            url("${escapeHtml(bg)}");
         background-repeat:no-repeat;
         background-position:center;
         background-size:${isGraphic ? "contain" : "cover"};
         background-color:#0b0b0b;`
      : `background: radial-gradient(1200px 900px at 20% 20%, #1b2a3a 0%, #0b0f14 55%, #07090c 100%);`;

    await page.setContent(
      `
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body{
      margin:0;
      width:1080px;
      height:1350px;
      font-family: Georgia, "Times New Roman", serif;
      background:#0b0b0b;
      color:#fff;
    }

    .container{
      display:flex;
      flex-direction:column;
      height:100%;
      width:100%;
      background:#0b0b0b;
    }

    /* ===== TOPO (TEXTO) ===== */
    .content{
      height:46%;
      padding:80px 90px 60px 90px;
      box-sizing:border-box;
      display:flex;
      flex-direction:column;
      justify-content:flex-start;
      position:relative;
    }

    .brand{
      position:absolute;
      top:40px;
      right:90px;
      font-family: Arial, Helvetica, sans-serif;
      font-size:18px;
      opacity:.75;
    }

    .kicker{
      font-family: Arial, Helvetica, sans-serif;
      font-size:18px;
      letter-spacing:2px;
      text-transform:uppercase;
      opacity:.75;
      margin-bottom:14px;
    }

    .rule{
      height:4px;
      width:110px;
      background:#e3120b;
      margin-bottom:28px;
    }

    .headline{
      font-size:56px;
      line-height:1.12;
      margin:0 0 18px 0;
      white-space:pre-wrap;
    }

    .sub{
      font-size:28px;
      line-height:1.35;
      font-style:italic;
      opacity:.9;
      margin:0;
      max-width:900px;
      white-space:pre-wrap;
    }

    /* ===== IMAGEM EMBAIXO ===== */
    .image{
      height:54%;
      width:100%;
      ${bgCss}
    }
  </style>
</head>

<body>
  <div class="container">

    <div class="content">
      <div class="brand">${B}</div>

      <div class="kicker">${K}</div>
      <div class="rule"></div>

      <h1 class="headline">${H}</h1>
      ${S ? `<p class="sub">${S}</p>` : ""}
    </div>

    <div class="image"></div>

  </div>
</body>
</html>
`,
      { waitUntil: "load" }
    );

    const buffer = await page.screenshot({ type: "jpeg", quality: 92 });
    const id = crypto.randomUUID();
    store.set(id, { buf: buffer, mime: "image/jpeg", exp: Date.now() + ttlMs });

    return res.json({ url: `${baseUrl}/img/${id}` });
  } catch (err) {
    console.error("RENDER_POST_ERROR:", err);
    return res.status(500).json({ error: "render_post_failed" });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
