import express from "express";
import puppeteer from "puppeteer";

const app = express();
app.use(express.json());

app.post("/render", async (req, res) => {
  const slides = req.body.slides;
  const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const images = [];

  for (let i = 0; i < slides.length; i++) {
    await page.setContent(`
      <html><body style="margin:0;width:1080px;height:1080px;
      display:flex;align-items:center;justify-content:center;
      background:#0b1c2d;color:white;font-family:Arial;padding:80px">
      <h1 style="font-size:64px;text-align:center">${slides[i]}</h1>
      </body></html>
    `);
    const buffer = await page.screenshot();
    images.push(buffer.toString("base64"));
  }

  await browser.close();
  res.json({ images });
});

app.listen(3000);
