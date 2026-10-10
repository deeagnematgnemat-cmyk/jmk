// ==============================================
//  『✦』 𝐸𝓇𝑒𝓃 🍷 𝐵𝑜𝓉 『✦』 - نسخة Baileys الخفيفة
// ==============================================

require("dotenv").config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { MongoClient } = require("mongodb");
const { useMongoDBAuthState } = require("mongo-baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const qrcodeTerminal = require("qrcode-terminal");
const qrcode = require("qrcode");
const express = require("express");
const fs = require("fs");
const path = require("path");

// استدعاء ملفات الذاكرة إن وجدت بحماية تفادياً للأخطاء
let faqList = [];
let longTermMemory = {
  setName: () => {},
  getName: () => null,
  getPersonRecord: () => {},
  touchLastSeen: () => {}
};

try { faqList = require("./faq"); } catch (e) { faqList = []; }
try { longTermMemory = require("./memory"); } catch (e) {}

// ────────────────[إعدادات الأرقام والبوت]────────────────
const OWNER_NUMBER = "962796163926";
const BOT_NUMBER = "962795106901";
const BOT_NAME = "『✦』 𝐸𝓇𝑒𝓃 🍷 𝐵𝑜𝓉 『✦』";
const TRIGGER_NAME = "ايرين";

const sentMessageTexts = new Set();
const conversationHistory = new Map();
const MAX_HISTORY_MESSAGES = 20;
const LAST_TOPIC = new Map();

function pushToHistory(chatId, role, content, topic = null) {
  if (!conversationHistory.has(chatId)) conversationHistory.set(chatId, []);
  const h = conversationHistory.get(chatId);
  h.push({ role, content, time: Date.now(), topic });
  while (h.length > MAX_HISTORY_MESSAGES) h.shift();
  if (topic) LAST_TOPIC.set(chatId, { topic, time: Date.now() });
}

function trackSentMessage(text) {
  if (text) sentMessageTexts.add(text.slice(0, 60));
}

const PORT = process.env.PORT || 8080;
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";
const AUTH_DIR = path.join(__dirname, "auth_info_baileys");
const MONGODB_URL = process.env.MONGODB_URL || "";
let mongoClient = null;

// كاش الطقس
let weatherCache = { city: "", data: null, time: 0 };
async function getWeatherSmart(city = "Amman") {
  const now = Date.now();
  if (weatherCache.city.toLowerCase() === city.toLowerCase() && weatherCache.data && now - weatherCache.time < 10 * 60 * 1000) {
    return weatherCache.data;
  }
  try {
    city = city.replace(/(اليوم|النهارده|دلوقتي|كام|ايه|في|in|today|now|درجة|الحرارة|الجو|الطقس|حراره|دلوقتي)/gi, "").trim();
    if (!city || city.length < 2) city = "Amman";
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ar&format=json`);
    let geoData = await geoRes.json();
    if (!geoData.results || geoData.results.length === 0) {
      const geoRes2 = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&format=json`);
      geoData = await geoRes2.json();
      if (!geoData.results || geoData.results.length === 0) return null;
    }
    const place = geoData.results[0];
    const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current_weather=true&hourly=temperature_2m,relativehumidity_2m,apparent_temperature&timezone=Asia/Amman&forecast_days=1`);
    const weatherData = await weatherRes.json();
    const curr = weatherData.current_weather;
    if (!curr) return null;
    const idx = weatherData.hourly ? weatherData.hourly.time.findIndex(t => new Date(t).getHours() === new Date().getHours()) : 0;
    const humidity = weatherData.hourly?.relativehumidity_2m?.[idx] || weatherData.hourly?.relativehumidity_2m?.[0] || 50;
    const feels = weatherData.hourly?.apparent_temperature?.[idx] || weatherData.hourly?.apparent_temperature?.[0] || curr.temperature;

    const result = { temp: curr.temperature, feels_like: Math.round(feels), city: place.name, humidity, wind: curr.windspeed, code: curr.weathercode };
    weatherCache = { city, data: result, time: now };
    return result;
  } catch (e) { console.error(e); return null; }
}

let lastWeatherCity = "Amman";
function detectIntent(text) {
  const isWeatherQ = /(طقس|حرارة|الجو|weather|درجة|حراره)/i.test(text);
  if (isWeatherQ) {
    let city = "";
    const match = text.match(/(?:في|in)\s+([a-zA-Z\u0600-\u06FF\s]{3,20})/i);
    if (match) { city = match[1].replace(/(اليوم|النهارده|دلوقتي|كام|ايه|الجو|الطقس|درجة|الحرارة)/gi, "").trim(); }
    if (!city) city = lastWeatherCity;
    if (city && city.length >= 3) { lastWeatherCity = city; return { type: "weather", city }; }
  }
  return null;
}

async function searchWeb(query) {
  if (!TAVILY_API_KEY) return "";
  if (/(طقس|حرارة|الجو|درجة|weather|حراره)/i.test(query)) return "";
  try {
    const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: TAVILY_API_KEY, query, max_results: 4, include_answer: true, search_depth: "advanced" }) });
    const d = await r.json();
    let result = "";
    if (d.answer) result += d.answer + "\n";
    if (d.results) result += d.results.map(x => x.content?.slice(0, 200)).join("\n");
    return result;
  } catch { return ""; }
}

const SYSTEM_CONTEXT = `
انت هو البوت المساعد الذكي ${BOT_NAME} 🍷.
شخصيتك ذكية، فخمة، حازمة ودقيقة للغاية.

المطور الأساسي للبوت هو: Eren (رقم المطور: ${OWNER_NUMBER}).
رقم البوت الخاص هو: ${BOT_NUMBER}.

🧠 القواعد الأساسية:
- الإجابة بدقة ووضوح وبأسلوب رزين وفخم.
- الإجابة عن أي سؤال تقني أو عام بذكاء عالي.
- احترام المستخدمين مع الحفاظ على هيبة وفخامة شخصية ايرين (Eren).
`;

let latestQr = null, isReady = false, connectedNumber = null, botOwnId = null;
const app = express();
app.get("/", (req, res) => {
  if (isReady) res.send(`<h1>✅ بوت ${BOT_NAME} شغال بنجاح</h1><p>الرقم المتصل: ${connectedNumber}</p>`);
  else if (latestQr) res.send(`<div style="text-align:center"><h2>امسح رمز الـ QR للربط 😍</h2><img src="/qr" /></div>`);
  else res.send("⏳ جاري تجهيز البوت...");
});
app.get("/qr", async (req, res) => { if (!latestQr) return res.status(404).send("No QR"); try { const img = await qrcode.toDataURL(latestQr); res.send(`<img src="${img}" />`); } catch { res.status(500).send("error"); } });
app.get("/ping", (req, res) => res.send("pong"));
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 HTTP Server listening on port ${PORT}`));

async function askAI(question, senderName, history, lastTopicInfo, searchResult = "") {
  if (!GROQ_API_KEY) return "مفتاح الذكاء الاصطناعي (Groq Key) غير محدد في الملفات 🍷";
  try {
    const nick = senderName ? senderName : "عزيزي";
    const contextStr = history.slice(-10).map(h => `${h.role}: ${h.content}`).join("\n");

    const messages = [
      { role: "system", content: `${SYSTEM_CONTEXT}\nالمستخدم الحالي: ${nick}\nالبحث المحدث: ${searchResult || "لا يوجد"}\n\nالسياق:\n${contextStr}` },
      { role: "user", content: question }
    ];

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.55, max_tokens: 600 }),
    });
    const d = await r.json();
    return d.choices?.[0]?.message?.content?.trim() || `أهلاً بك يا ${nick}، كيف يمكنني مساعدتك؟ 🍷`;
  } catch (e) { console.error(e); return "حدث خطأ أثناء معالجة الطلب، يرجى المحاولة لاحقاً 🍷"; }
}

function extractText(message) {
  if (!message) return "";
  return message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || "";
}

async function getAuthState() {
  if (MONGODB_URL) {
    if (!mongoClient) {
      mongoClient = new MongoClient(MONGODB_URL);
      await mongoClient.connect();
      console.log("🗄️ متصل بقاعدة بيانات MongoDB");
    }
    const collection = mongoClient.db("eren_bot").collection("auth_state");
    return useMongoDBAuthState(collection);
  }
  return useMultiFileAuthState(AUTH_DIR);
}

async function startBot() {
  const { state, saveCreds } = await getAuthState();
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: true, // طباعة الـ QR في Terminal/Railway مباشرة
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
      botOwnId = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
      connectedNumber = sock.user?.id?.split(":")[0] || "";
      console.log(`✅ تم الاتصال بنجاح! بوت ${BOT_NAME} جاهز للعمل 🍷`);
    }
    if (connection === "close") {
      isReady = false;
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("⚠️ تم إغلاق الاتصال، إعادة الاتصال:", shouldReconnect);
      if (shouldReconnect) startBot();
      else console.log("❌ تم تسجيل الخروج - يتطلب إعادة مسح الـ QR");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    try {
      if (!msg.message || msg.key.fromMe) return;
      const chatId = msg.key.remoteJid;
      const text = extractText(msg.message).trim();
      if (!text) return;
      const lowerText = text.toLowerCase();

      // الاستجابة لأمر المطور
      if (["المطور", "مين عملك", "مين برمجك", "owner"].some(k => lowerText.includes(k))) {
        const p = path.join(__dirname, "developer.jpg");
        const captionText = `👨‍💻 مطور البوت هو: Eren\nرقم المطور: ${OWNER_NUMBER}\nاسم البوت: ${BOT_NAME}`;
        if (fs.existsSync(p)) {
          await sock.sendMessage(chatId, { image: fs.readFileSync(p), caption: captionText }, { quoted: msg });
        } else {
          await sock.sendMessage(chatId, { text: captionText }, { quoted: msg });
        }
        return;
      }

      const personId = msg.key.participant || chatId;
      let senderName = msg.pushName ? msg.pushName.split(" ")[0] : "عزيزي";

      const intent = detectIntent(text);
      if (intent && intent.type === "weather") {
        const w = await getWeatherSmart(intent.city);
        if (w) {
          const reply = `الطقس في ${w.city} الآن ${w.temp}°C (الشعور الحقيقي ${w.feels_like}°C) - الرطوبة ${w.humidity}% 🍷`;
          await sock.sendMessage(chatId, { text: reply }, { quoted: msg });
          return;
        }
      }

      const history = conversationHistory.get(chatId) || [];
      let searchResult = "";
      if (text.length > 15) searchResult = await searchWeb(text);

      const aiReply = await askAI(text, senderName, history, null, searchResult);
      await sock.sendMessage(chatId, { text: aiReply }, { quoted: msg });
      pushToHistory(chatId, "user", text);
      pushToHistory(chatId, "assistant", aiReply);

    } catch (err) { console.error("خطأ:", err); }
  });
}

startBot();
