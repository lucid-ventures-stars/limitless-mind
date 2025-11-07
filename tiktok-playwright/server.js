import express from "express";
import { chromium } from "playwright";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json({ limit: "50mb" }));

// ---------- Decrypt cookies from environment variable ----------
function decryptCookies() {
  try {
    const encryptedBase64 = process.env.COOKIES_FILE;
    const password = process.env.COOKIE_PASSWORD || process.env.COOKIE_SECRET || process.env.SECRET_KEY;

    if (!encryptedBase64 || !password) {
      throw new Error("Missing encrypted cookies or password.");
    }

    // Decode from Base64 first
    const encrypted = Buffer.from(encryptedBase64, "base64");

    // OpenSSL-compatible AES-256-CBC decryption
    const saltHeader = encrypted.slice(0, 8).toString();
    if (saltHeader !== "Salted__") {
      throw new Error("Missing Salted__ header. Invalid OpenSSL data.");
    }

    const salt = encrypted.slice(8, 16);
    const encryptedData = encrypted.slice(16);

    // Derive key and IV using OpenSSL's method
    const keyIv = [];
    let prev = Buffer.alloc(0);
    while (Buffer.concat(keyIv).length < 48) {
      const data = Buffer.concat([prev, Buffer.from(password), salt]);
      prev = crypto.createHash("md5").update(data).digest();
      keyIv.push(prev);
    }

    const derived = Buffer.concat(keyIv);
    const key = derived.slice(0, 32);
    const iv = derived.slice(32, 48);

    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const decrypted = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);

    console.log("🔓 Cookies decrypted successfully.");
    return JSON.parse(decrypted.toString());
  } catch (error) {
    console.error("❌ Cookie decryption failed:", error.message);
    throw new Error("Could not decrypt cookies. Check your env variables.");
  }
}

// ---------- TikTok Upload Route ----------
app.post("/upload", async (req, res) => {
  const { video_url, caption } = req.body;
  console.log("🚀 Upload request received", { video_url, caption });

  try {
    const cookies = decryptCookies();

    // Create a temp file for the video
    const tempVideoPath = path.join(process.cwd(), "temp_video.mp4");

    // Download video file from provided URL
    const response = await fetch(video_url);
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(tempVideoPath, Buffer.from(arrayBuffer));

    const browser = await chromium.launch({
      headless: true,
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

    // Clean up temp file
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

// ---------- Root Endpoint ----------
app.get("/", (req, res) => {
  res.send("TikTok uploader is live. POST to /upload to upload videos.");
});

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
