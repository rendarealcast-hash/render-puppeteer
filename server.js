import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.status(200).send("ok");
});

app.post("/render", async (req, res) => {
  const slides = req.body?.slides;

  if (!Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ error: "Body must include { slides: [...] }" });
  }

  let browser;

  try {
    const executablePath = await chromium.executablePath();

    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

    const images = [];

    for (let i = 0; i < slides.length; i++) {
      const raw = String(slides[i] ?? "");
      const text = raw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

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
              <div class="badge">DICA ${i + 1} / ${slides.length}</div>
              <h1>${text}</h1>
              <p>Salve este post para não esquecer</p>
            </div>
            <div>
              <div class="footer"><span>@seuperfil</span><span>Arraste →</span></div>
              <div class="bar"><div class="bar-fill"></div></div>
            </div>
          </div>
        </body>
        </html>
        `,
        { waitUntil: "load" }
      );

      const buffer = await page.screenshot({ type: "jpeg", quality: 90 });
      images.push(buffer.toString("base64"));
    }

    return res.json({ images });

  } catch (err) {
    console.error("RENDER_ERROR:", err);
    return res.status(500).json({ error: "render_failed" });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Listening on", PORT);
});

