// GitHub Actions har soatda ishga tushiradi, bot esa ~55 daqiqa davomida uzluksiz ishlaydi:
// 1) ota-onalarning "Start" bosishiga darhol javob beradi va o'quvchiga bog'laydi;
// 2) to'lov yozilganda ota-onaga darhol xabar yuboradi;
// 3) Toshkent vaqti bilan 08:00 dan keyin kuniga bir marta to'lov eslatmalarini yuboradi.
import { loadApp, dailyMessages, receiptText, statusText } from "./logic.mjs";

const TOKEN = process.env.TELEGRAM_TOKEN, SA = process.env.FIREBASE_SA;
if (!TOKEN || !SA) { console.log("TELEGRAM_TOKEN yoki FIREBASE_SA sozlanmagan — bot ishlamadi."); process.exit(0); }
const RUN_MS = (Number(process.env.RUN_MINUTES) || 55) * 60e3, started = Date.now();

const { initializeApp, cert } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
initializeApp({ credential: cert(JSON.parse(SA)) });
const db = getFirestore();
const api = async (method, body) => {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    const j = await r.json();
    if (!j.ok) console.log(method, "xato:", j.description);
    return j;
  } catch (e) { console.log(method, "tarmoq xatosi"); return { ok: false }; }
};

// Ma'lumotlar: bir marta to'liq o'qiladi, keyin faqat o'zgarishlar keladi (Firestore o'qishlarini tejaydi)
const COLS = ["groups", "students", "payments", "teachers", "salaries", "settings", "leads"];
const data = {}; let dirtyPays = true;
await Promise.all(COLS.map(c => new Promise(res => {
  data[c] = {}; let first = true;
  db.collection(c).onSnapshot(snap => {
    snap.docChanges().forEach(ch => { if (ch.type === "removed") delete data[c][ch.doc.id]; else data[c][ch.doc.id] = ch.doc.data(); });
    if (c === "payments" || c === "students") dirtyPays = true;
    if (first) { first = false; res(); }
  }, e => { console.log(c, "o'qish xatosi:", e.message); res(); });
})));
const center = () => (data.settings.main && data.settings.main.center) || "o'quv markazi";
const app = () => loadApp(new URL("../hisob/index.html", import.meta.url).pathname, data);

// Bot nomini saytdagi sozlamaga o'zi yozadi
const me = await api("getMe");
if (!me.ok) { console.log("Telegram token ishlamadi — GitHub'dagi TELEGRAM_TOKEN ni tekshiring."); process.exit(1); }
const botUser = me.result.username;
console.log("Bot:", "@" + botUser);
if (!data.settings.main || data.settings.main.bot !== botUser) {
  await db.collection("settings").doc("main").set({ bot: botUser }, { merge: true });
  console.log("Saytga bot nomi yozildi.");
}
const wh = await api("getWebhookInfo");
if (wh.result && wh.result.url) { console.log("Webhook o'rnatilgan — o'chiriladi."); await api("deleteWebhook"); }

const stRef = db.collection("botstate").doc("tg");
let offset = ((await stRef.get()).data() || {}).offset || 0;

async function handle(u) {
  const m = u.message; if (!m || !m.text || !m.chat) return;
  const chat = String(m.chat.id), who = [m.from && m.from.first_name, m.from && m.from.last_name].filter(Boolean).join(" ");
  const [cmd, arg] = m.text.trim().split(/\s+/);
  if ((cmd === "/start" && arg === "test") || /^\/?test$/i.test(m.text.trim())) {
    await db.collection("botstate").doc("test").set({ chat, who, at: new Date().toISOString() });
    await api("sendMessage", { chat_id: chat, text: `✅ Sinov: bot ishlayapti va bazaga ulandi.\n\nHurmat bilan, ${center()}` });
    console.log("Sinov xabari.");
  } else if (cmd === "/start" && arg && data.students[arg]) {
    const s = data.students[arg];
    await db.collection("students").doc(arg).update({ [`tg.${chat}`]: { name: who, at: new Date().toISOString().slice(0, 10) } });
    console.log("Ulandi:", s.name);
    await api("sendMessage", { chat_id: chat, text: `Rahmat! Siz ${s.name} uchun to'lov eslatmalariga ulandingiz. To'lov kuni yaqinlashganda va to'lov qabul qilinganda shu yerga xabar keladi.\n\nHozirgi holatni ko'rish: /holat\nTo'xtatish uchun: /stop\n\n${center()}` });
    data.students[arg] = { ...s, tg: { ...(s.tg || {}), [chat]: { name: who } } };
    const st = statusText(app(), chat); if (st) await api("sendMessage", { chat_id: chat, text: st });
  } else if (cmd === "/start") {
    console.log("Havolasiz /start keldi.");
    await api("sendMessage", { chat_id: chat, text: `Assalomu alaykum! Bu ${center()} to'lov eslatmalari boti.\n\nUlanish uchun markaz sizga yuborgan maxsus havolani bosing (u https://t.me/${botUser}?start=... ko'rinishida bo'ladi). Havolani markazdan so'rashingiz mumkin.` });
  } else if (cmd === "/holat") {
    const st = statusText(app(), chat);
    await api("sendMessage", { chat_id: chat, text: st || `Siz hali hech qaysi o'quvchiga ulanmagansiz. Markaz yuborgan maxsus havolani bosing.` });
    console.log("/holat so'raldi.");
  } else if (cmd === "/stop") {
    for (const [id, s] of Object.entries(data.students)) if (s.tg && s.tg[chat]) await db.collection("students").doc(id).update({ [`tg.${chat}`]: FieldValue.delete() });
    console.log("/stop: ulanish o'chirildi");
    await api("sendMessage", { chat_id: chat, text: "Eslatmalar to'xtatildi. Qayta ulanish uchun markaz yuborgan havolani bosing." });
  } else {
    await api("sendMessage", { chat_id: chat, text: `Bu bot faqat to'lov eslatmalarini yuboradi. Savollar bo'lsa, ${center()} bilan bog'laning.` });
  }
}

async function receipts() {
  if (!dirtyPays) return; dirtyPays = false;
  let A = null;
  for (const [pid, p] of Object.entries(data.payments)) {
    if (p.tgSent || !data.students[p.sid]) continue;
    const s = data.students[p.sid];
    A = A || app();
    const pk = A.phKey(s.phone), chats = {};
    for (const x of Object.values(data.students)) if (x === s || pk && A.phKey(x.phone) === pk) Object.assign(chats, x.tg || {});
    const ok = Object.entries(chats).filter(([, v]) => !v.at || (p.date || "") >= v.at);
    if (!ok.length) continue;
    const text = receiptText(A, pid); if (!text) continue;
    for (const [chat] of ok) await api("sendMessage", { chat_id: chat, text });
    await db.collection("payments").doc(pid).update({ tgSent: true });
    console.log("To'lov xabari:", s.name, p.amount);
  }
}

const dayRef = db.collection("botstate").doc("daily");
async function daily() {
  const A = app(), today = A.today();
  if (new Date().getHours() < 8) return;
  const day = (await dayRef.get()).data() || {};
  if (day.date === today) return;
  await dayRef.set({ date: today, started: new Date().toISOString() });
  const msgs = dailyMessages(A); let sent = 0;
  for (const [chat, text] of Object.entries(msgs)) {
    const r = await api("sendMessage", { chat_id: chat, text });
    if (r.ok) sent++;
    else if (r.error_code === 403)
      for (const [id, s] of Object.entries(data.students)) if (s.tg && s.tg[chat]) await db.collection("students").doc(id).update({ [`tg.${chat}`]: FieldValue.delete() });
  }
  await dayRef.set({ date: today, sent, chats: Object.keys(msgs).length, done: new Date().toISOString() });
  console.log(`${today}: ${sent} ta eslatma yuborildi`);
}

// Asosiy sikl: Telegramdan xabarni uzoq kutish (long polling), oralig'ida to'lov va kunlik tekshiruv
let lastDaily = 0;
while (Date.now() - started < RUN_MS) {
  const up = await api("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
  for (const u of up.result || []) {
    offset = u.update_id + 1;
    try { await handle(u); } catch (e) { console.log("Xabarni qayta ishlashda xato:", e.message); }
  }
  if (up.result && up.result.length) await stRef.set({ offset }, { merge: true });
  try { await receipts(); } catch (e) { console.log("To'lov xabarida xato:", e.message); }
  if (Date.now() - lastDaily > 5 * 60e3) { lastDaily = Date.now(); try { await daily(); } catch (e) { console.log("Kunlik eslatmada xato:", e.message); } }
  if (!up.ok) await new Promise(r => setTimeout(r, 5000));
}
console.log("Navbatdagi ishga tushirishgacha to'xtadi.");
process.exit(0);
