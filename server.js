import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "25mb" })); // aumentei pq base64 cresce

// ====== HOST DE IMAGENS (em memória) ======
const store = new Map(); // id -> { buf, mime, exp }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.exp < now) store.delete(k);
  }
}, 60_000);

// Serve JPG direto (isso a Meta consegue baixar)
app.get("/img/:id", (req, res) => {
  const v = store.get(req.params.id);
  if (!v) return res.status(404).send("not found");

  res.setHeader("Content-Type", v.mime || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=600");
  return res.send(v.buf);
});

app.get("/", (req, res) => res.status(200).send("ok"));
app.get("/health", (req, res) => res.status(200).send("ok"));

// ====== RENDER ======
app.post("/render", async (req, res) => {
  const slides = req.body?.slides;

  if (!Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ error: "Body must include { slides: [...] }" });
  }

  let browser;

  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, "--single-process"],
      executablePath: await chromium.executablePath({ cache: true }),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const ttlMs = 30 * 60 * 1000; // 30 min pra Meta baixar
    const urls = [];

    for (let i = 0; i < slides.length; i++) {
      const raw = String(slides[i] ?? "");
      const text = raw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

      const progress = Math.round(((i + 1) / slides.length) * 100);

      // ====== SEU HTML (edite aqui quando precisar) ======
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

      // Gera JPEG e guarda no store
      const buffer = await page.screenshot({ type: "jpeg", quality: 90 });
      const id = crypto.randomUUID();
      store.set(id, { buf: buffer, mime: "image/jpeg", exp: Date.now() + ttlMs });

      urls.push(`${baseUrl}/img/${id}`);
    }

    // Agora você manda "urls" pra Meta (em vez de Drive)
    return res.json({ urls });

  } catch (err) {
    console.error("RENDER_ERROR:", err);
    return res.status(500).json({ error: "render_failed" });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
