// Har soatda GitHub Actions ishga tushiradi:
// 1) ota-onalarning "Start" bosishini o'quvchiga bog'laydi;
// 2) Toshkent vaqti bilan 08:00 dan keyin kuniga bir marta to'lov eslatmalarini yuboradi.
import { loadApp, dailyMessages, receiptText } from "./logic.mjs";

const TOKEN = process.env.TELEGRAM_TOKEN, SA = process.env.FIREBASE_SA;
if (!TOKEN || !SA) { console.log("TELEGRAM_TOKEN yoki FIREBASE_SA sozlanmagan — bot ishlamadi."); process.exit(0); }

const { initializeApp, cert } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
initializeApp({ credential: cert(JSON.parse(SA)) });
const db = getFirestore();
const api = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (!j.ok) console.log(method, "xato:", j.description);
  return j;
};

const COLS = ["groups", "students", "payments", "teachers", "salaries", "settings", "leads"];
async function loadData() {
  const data = {};
  for (const c of COLS) { data[c] = {}; (await db.collection(c).get()).forEach(d => (data[c][d.id] = d.data())); }
  return data;
}
let data = await loadData();
const center = (data.settings.main && data.settings.main.center) || "o'quv markazi";

// 1) Ulanishlar
const stRef = db.collection("botstate").doc("tg");
const st = (await stRef.get()).data() || {};
const up = await api("getUpdates", { offset: st.offset || 0, timeout: 0, allowed_updates: ["message"] });
let offset = st.offset || 0, changed = false;
for (const u of up.result || []) {
  offset = u.update_id + 1;
  const m = u.message; if (!m || !m.text || !m.chat) continue;
  const chat = String(m.chat.id), who = [m.from && m.from.first_name, m.from && m.from.last_name].filter(Boolean).join(" ");
  const [cmd, arg] = m.text.trim().split(/\s+/);
  if (cmd === "/start" && arg && data.students[arg]) {
    await db.collection("students").doc(arg).update({ [`tg.${chat}`]: { name: who, at: new Date().toISOString().slice(0, 10) } });
    changed = true;
    await api("sendMessage", { chat_id: chat, text: `Rahmat! Siz ${data.students[arg].name} uchun to'lov eslatmalariga ulandingiz. To'lov kuni yaqinlashganda shu yerga xabar keladi.\n\nTo'xtatish uchun: /stop\n\n${center}` });
  } else if (cmd === "/start") {
    await api("sendMessage", { chat_id: chat, text: `Assalomu alaykum! Ulanish uchun ${center} yuborgan maxsus havolani bosing.` });
  } else if (cmd === "/stop") {
    for (const [id, s] of Object.entries(data.students)) if (s.tg && s.tg[chat]) await db.collection("students").doc(id).update({ [`tg.${chat}`]: FieldValue.delete() });
    changed = true;
    await api("sendMessage", { chat_id: chat, text: "Eslatmalar to'xtatildi. Qayta ulanish uchun markaz yuborgan havolani bosing." });
  } else {
    await api("sendMessage", { chat_id: chat, text: `Bu bot faqat to'lov eslatmalarini yuboradi. Savollar bo'lsa, ${center} bilan bog'laning.` });
  }
}
if (offset !== (st.offset || 0)) await stRef.set({ offset }, { merge: true });
if (changed) data = await loadData();

const A = loadApp(new URL("../hisob/index.html", import.meta.url).pathname, data);

// 2) To'lov qabul qilinganda ota-onaga xabar (ulanganidan keyingi to'lovlar uchun)
for (const [pid, p] of Object.entries(data.payments)) {
  if (p.tgSent || !data.students[p.sid]) continue;
  const s = data.students[p.sid], pk = A.phKey(s.phone);
  const chats = {};
  for (const x of Object.values(data.students)) if (x === s || pk && A.phKey(x.phone) === pk) Object.assign(chats, x.tg || {});
  const ok = Object.entries(chats).filter(([, v]) => !v.at || (p.date || "") >= v.at);
  if (!ok.length) continue;
  const text = receiptText(A, pid);
  if (!text) continue;
  for (const [chat] of ok) await api("sendMessage", { chat_id: chat, text });
  await db.collection("payments").doc(pid).update({ tgSent: true });
  console.log("To'lov xabari:", s.name, p.amount);
}

// 3) Kunlik eslatmalar
const today = A.today(), hour = new Date().getHours();
const dayRef = db.collection("botstate").doc("daily");
const day = (await dayRef.get()).data() || {};
if (hour >= 8 && day.date !== today) {
  await dayRef.set({ date: today, started: new Date().toISOString() });
  const msgs = dailyMessages(A);
  let sent = 0;
  for (const [chat, text] of Object.entries(msgs)) {
    const r = await api("sendMessage", { chat_id: chat, text });
    if (r.ok) sent++;
    else if (r.error_code === 403) // ota-ona botni bloklagan
      for (const [id, s] of Object.entries(data.students)) if (s.tg && s.tg[chat]) await db.collection("students").doc(id).update({ [`tg.${chat}`]: FieldValue.delete() });
  }
  await dayRef.set({ date: today, sent, chats: Object.keys(msgs).length, done: new Date().toISOString() });
  console.log(`${today}: ${sent} ta xabar yuborildi`);
} else console.log("Kunlik eslatma:", day.date === today ? "bugun yuborilgan" : "soat 08:00 kutilmoqda");
