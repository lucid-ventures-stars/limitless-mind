import express from "express";
import { chromium } from "playwright";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { executablePath } from "playwright-core";

const app = express();
app.use(express.json({ limit: "50mb" }));

console.log("🔍 ENV CHECK:", {
  COOKIE_PASSWORD: process.env.COOKIE_PASSWORD ? "✅ Loaded" : "❌ Missing",
  SECRET_KEY: process.env.SECRET_KEY ? "✅ Loaded" : "❌ Missing",
  COOKIES_FILE: process.env.COOKIES_FILE
    ? `✅ Loaded (${process.env.COOKIES_FILE.length} chars)`
    : "❌ Missing",
  REGION: process.env.REGION ? process.env.REGION : "❌ Missing",
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "❌ Missing"
});

// ---------- Decrypt cookies ----------
function decryptCookies() {
  try {
    const rawB64 = (process.env.COOKIES_FILE || "")
      .replace(/^data:.*?;base64,/, "")
      .replace(/[\s\u200B-\u200D\uFEFF]/g, "")
      .trim();

    const password = process.env.COOKIE_PASSWORD;

    if (!rawB64 || !password) {
      throw new Error("Missing encrypted cookies or password.");
    }

    console.log("🔎 B64 prefix:", rawB64.slice(0, 12));
    console.log("🔎 B64 length:", rawB64.length);

    const encrypted = Buffer.from(rawB64, "base64");
    const headerAscii = encrypted.slice(0, 8).toString("ascii");
    console.log("🔎 header bytes:", headerAscii);

    if (headerAscii !== "Salted__") {
      throw new Error("Missing Salted__ header. Invalid OpenSSL data.");
    }

    const salt = encrypted.slice(8, 16);
    const encryptedData = encrypted.slice(16);

    const keyIv = crypto.pbkdf2Sync(password, salt, 100000, 48, "sha256");
    const key = keyIv.slice(0, 32);
    const iv = keyIv.slice(32, 48);

    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

    console.log("🔓 Cookies decrypted successfully (PBKDF2).");
    return JSON.parse(decrypted.toString());
  } catch (err) {
    console.error("❌ Cookie decryption failed:", err.message);
    throw new Error("Could not decrypt cookies. Check your env variables.");
  }
}

// ---------- TikTok Upload Route ----------
app.post("/upload", async (req, res) => {
  const { video_url, caption } = req.body;
  console.log("🚀 Upload request received", { video_url, caption });

  try {
    const cookies = decryptCookies();

    const tempVideoPath = path.join(process.cwd(), "temp_video.mp4");
    const response = await fetch(video_url);
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(tempVideoPath, Buffer.from(arrayBuffer));

    console.log("🎬 Launching Chromium...");
    const browser = await chromium.launch({
      headless: true,
      executablePath: executablePath("chromium"),
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext();
    await context.addCookies(cookies);
    const page = await context.newPage();

    console.log("🌐 Navigating to TikTok upload page...");
    await page.goto("https://www.tiktok.com/upload", { timeout: 60000 });

    console.log("📤 Uploading video...");
    await page.setInputFiles('input[type="file"]', tempVideoPath);

    console.log("📝 Adding caption...");
    await page.waitForSelector('[placeholder=\"Describe your video\"]', { timeout: 60000 });
    await page.fill('[placeholder=\"Describe your video\"]', caption || "");

    console.log("📦 Posting...");
    await page.click("text=Post");

    await page.waitForTimeout(8000);
    await browser.close();

    fs.unlinkSync(tempVideoPath);
    console.log("✅ Video successfully posted to TikTok!");
    res.json({ status: "success", message: "Video uploaded to TikTok" });
  } catch (error) {
    console.error("❌ Upload failed:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Unknown upload error",
    });
  }
});

// ---------- Root ----------
app.get("/", (req, res) => {
  res.send("TikTok uploader is live. POST to /upload to upload videos.");
});

// ---------- Env Check ----------
app.get("/env-check", (req, res) => {
  res.json({
    COOKIE_PASSWORD: process.env.COOKIE_PASSWORD ? "✅ Loaded" : "❌ Missing",
    SECRET_KEY: process.env.SECRET_KEY ? "✅ Loaded" : "❌ Missing",
    COOKIES_FILE: process.env.COOKIES_FILE ? "✅ Loaded" : "❌ Missing",
  });
});

// ---------- Start Server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 TikTok uploader running in ${process.env.REGION || "UK"} region on port ${PORT}`);
});
