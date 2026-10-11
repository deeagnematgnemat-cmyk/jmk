// ==============================================
//  『✦』 𝐸𝓇𝑒𝓃 🍷 𝐵𝑜𝓉 『✦』 - كود التشغيل والاستجابة للأوامر
// ==============================================

require("dotenv").config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const qrcodeTerminal = require("qrcode-terminal");
const qrcode = require("qrcode");
const express = require("express");
const fs = require("fs");
const path = require("path");

// ────────────────[إعدادات البوت والمطور]────────────────
const OWNER_NUMBER = "962796163926";
const BOT_NUMBER = "962795106901";
const BOT_NAME = "『✦』 𝐸𝓇𝑒𝓃 🍷 𝐵𝑜𝓉 『✦』";

const PORT = process.env.PORT || 8080;
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const AUTH_DIR = path.join(__dirname, "auth_info_baileys");

let latestQr = null, isReady = false, connectedNumber = null;

// ────────────────[سيرفر الويب لإظهار الـ QR]────────────────
const app = express();
app.get("/", (req, res) => {
  if (isReady) res.send(`<h1>✅ بوت ${BOT_NAME} متصل بنجاح</h1><p>الرقم المتصل: ${connectedNumber}</p>`);
  else if (latestQr) res.send(`<div style="text-align:center"><h2>امسح رمز الـ QR للربط 😍</h2><img src="/qr" /></div>`);
  else res.send("⏳ جاري تجهيز البوت...");
});
app.get("/qr", async (req, res) => {
  if (!latestQr) return res.status(404).send("No QR Available");
  try {
    const img = await qrcode.toDataURL(latestQr);
    res.send(`<img src="${img}" />`);
  } catch { res.status(500).send("Error generating QR"); }
});
app.get("/ping", (req, res) => res.send("pong"));
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 HTTP Server running on port ${PORT}`));

// ────────────────[دالة الذكاء الاصطناعي]────────────────
async function askAI(question, senderName) {
  if (!GROQ_API_KEY) return "🍷 أهلاً بك! الذكاء الاصطناعي بحاجة لإضافة GROQ_API_KEY في متغيرات Railway للرد على الأسئلة العامة.";
  try {
    const messages = [
      { role: "system", content: `انت هو البوت المساعد الذكي ${BOT_NAME} 🍷. المطور هو Eren (${OWNER_NUMBER}). أجب باختصار وبأسلوب فخم ورزين.` },
      { role: "user", content: question }
    ];

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.6, max_tokens: 400 }),
    });
    const d = await r.json();
    return d.choices?.[0]?.message?.content?.trim() || "لم أستطع معالجة الطلب حالياً 🍷";
  } catch (e) {
    console.error("Groq AI Error:", e);
    return "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي 🍷";
  }
}

function extractText(message) {
  if (!message) return "";
  return message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || "";
}

// ────────────────[محرك البوت والاتصال]────────────────
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: true,
    browser: ["Eren Bot", "Chrome", "1.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      latestQr = qr;
      qrcodeTerminal.generate(qr, { small: true });
    }
    if (connection === "open") {
      isReady = true;
      latestQr = null;
      connectedNumber = sock.user?.id?.split(":")[0] || "";
      console.log(`✅ تم الاتصال بنجاح! ${BOT_NAME} يعمل الآن على الرقم: ${connectedNumber}`);
    }
    if (connection === "close") {
      isReady = false;
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("⚠️ تم إغلاق الاتصال، جاري إعادة المحاولة...", shouldReconnect);
      if (shouldReconnect) startBot();
      else console.log("❌ تم تسجيل الخروج. يرجى إعادة مسح الـ QR.");
    }
  });

  // ────────────────[معالجة الأوامر والرسائل]────────────────
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    try {
      if (!msg.message || msg.key.fromMe) return;
      const chatId = msg.key.remoteJid;
      const text = extractText(msg.message).trim();
      if (!text) return;

      console.log(`📩 رسالة جديدة من (${chatId}): ${text}`);
      const lowerText = text.toLowerCase();

      // 1. أمر قائمة الأوامر
      if ([".اوامر", ".الاوامر", "اوامر", "الاوامر", ".أوامر"].includes(lowerText)) {
        const menuText = `🍷 *قائمة أوامر ${BOT_NAME}* 🍷\n\n• *.اوامر* : عرض قائمة الأوامر\n• *.بوت* أو *بوت* : فحص حالة الاتصال\n• *المطور* : عرض بيانات المطور\n\n_يمكنك كتابة أي سؤال وسيجيبك الذكاء الاصطناعي مباشرة!_`;
        await sock.sendMessage(chatId, { text: menuText }, { quoted: msg });
        return;
      }

      // 2. أمر فحص البوت
      if ([".بوت", "بوت", ".ping", "ping"].includes(lowerText)) {
        await sock.sendMessage(chatId, { text: `🍷 أهلاً بك! بوت ${BOT_NAME} شغال وجاهز للاستجابة.` }, { quoted: msg });
        return;
      }

      // 3. أمر معلومات المطور
      if (["المطور", "مين عملك", "مين برمجك", "owner"].some(k => lowerText.includes(k))) {
        const captionText = `👨‍💻 *بيانات المطور*:\n• اسم المطور: Eren\n• رقم المطور: ${OWNER_NUMBER}\n• اسم البوت: ${BOT_NAME}`;
        await sock.sendMessage(chatId, { text: captionText }, { quoted: msg });
        return;
      }

      // 4. الذكاء الاصطناعي للأسئلة العامة
      const senderName = msg.pushName ? msg.pushName.split(" ")[0] : "عزيزي";
      const aiReply = await askAI(text, senderName);
      await sock.sendMessage(chatId, { text: aiReply }, { quoted: msg });

    } catch (err) {
      console.error("❌ خطأ أثناء معالجة الرسالة:", err);
    }
  });
}

startBot();
