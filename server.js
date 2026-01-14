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
      const text = String(slides[i] ?? "").replace(/[<>]/g, "");

      await page.setContent(
        `
        <html>
          <body style="margin:0;width:1080px;height:1080px;display:flex;align-items:center;justify-content:center;background:#0b1c2d;color:white;font-family:Arial;padding:80px">
            <h1 style="font-size:64px;line-height:1.1;text-align:center;white-space:pre-wrap;">${text}</h1>
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
    return res.status(500).json({ error: "render_failed", details: String(err?.message || err) });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
