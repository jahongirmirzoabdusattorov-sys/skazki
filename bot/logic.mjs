// Saytdagi (hisob/index.html) hisob-kitob kodini aynan o'zini ishlatadi, shuning uchun bot va sayt bir xil hisoblaydi.
import fs from "node:fs";
import vm from "node:vm";

export function loadApp(htmlPath, data) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let code = blocks.sort((a, b) => b.length - a.length)[0];
  code = code.replace(/render\(\);\s*init\(\);/, "");
  const el = () => ({ addEventListener() {}, classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } }, style: {}, dataset: {}, innerHTML: "", textContent: "" });
  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Set, Map, RegExp, Promise, encodeURIComponent, parseInt, parseFloat, isNaN,
    document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null, body: el(), addEventListener() {}, createElement: el },
    window: {}, localStorage: { getItem() {}, setItem() {} }, sessionStorage: { getItem() {}, setItem() {} }, location: {}, navigator: {},
    setTimeout: () => 0, clearTimeout() {},
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(code + `
;globalThis.API={S,rows,rowPays,debt,famDue,today,dshift,shift,fullD,fmtD,money,center,billMode,phKey,trackFrom,resetC(){C={}}};`, ctx);
  const A = ctx.API;
  for (const k of Object.keys(A.S)) A.S[k] = data[k] || {};
  A.resetC();
  return A;
}

// Bugungi xabarlar: chatId -> matn
export function dailyMessages(A) {
  if (A.billMode() !== "cycle") return {};
  const S = A.S, t = A.today(), tm = A.dshift(t, 1), m0 = t.slice(0, 7);
  const lines = {}; // sid -> [matn]
  const add = (sid, s) => (lines[sid] = lines[sid] || []).push(s);
  const seen = new Set();
  for (const m of [A.shift(m0, -4), A.shift(m0, -3), A.shift(m0, -2), A.shift(m0, -1), m0, A.shift(m0, 1)]) {
    for (const r of A.rows(m)) {
      const key = r.sid + "|" + r.gid + "|" + r.b.k;
      if (seen.has(key) || !r.b.cyc || r.left <= 0 || r.s.end && r.s.end < t) continue;
      seen.add(key);
      const kurs = `"${r.g.name}" kursi`, n = r.b.anch ? r.b.n : r.b.pack;
      if (r.b.cyc === tm) add(r.sid, `Ertaga (${A.fullD(tm)}) ${r.s.name}ning ${kurs} bo'yicha yangi ${n} ta dars boshlanadi (${A.fullD(r.b.cyc)} – ${A.fullD(r.b.last)}). To'lov: ${A.money(r.left)} so'm.`);
      else if (r.b.cyc === t) add(r.sid, `Bugun ${r.s.name}ning ${kurs} bo'yicha to'lov kuni (${A.fullD(r.b.cyc)} – ${A.fullD(r.b.last)}). To'lov: ${A.money(r.left)} so'm.`);
      else if (r.b.cyc < t && m >= A.trackFrom()) {
        const days = Math.round((Date.parse(t) - Date.parse(r.b.cyc)) / 864e5);
        if (days % 3 === 0) add(r.sid, `${r.s.name}ning ${kurs} bo'yicha ${A.fullD(r.b.cyc)} kungi to'lovi qolgan: ${A.money(r.left)} so'm. Iltimos, to'lovni amalga oshiring.`);
      }
    }
  }
  // Har bir ota-ona chatiga: o'z bolasi va shu telefonli aka-ukalari
  const out = {};
  for (const [sid, L] of Object.entries(lines)) {
    const s = S.students[sid], pk = A.phKey(s.phone);
    const fam = Object.entries(S.students).filter(([id, x]) => id === sid || pk && A.phKey(x.phone) === pk);
    for (const [, x] of fam) for (const chat of Object.keys(x.tg || {})) {
      out[chat] = out[chat] || new Set();
      L.forEach(l => out[chat].add(l));
    }
  }
  const end = A.center() ? `\n\nHurmat bilan, ${A.center()}` : "";
  return Object.fromEntries(Object.entries(out).map(([c, set]) => [c, `Assalomu alaykum!\n\n${[...set].join("\n\n")}${end}`]));
}

// To'lov qabul qilingani haqida xabar matni (payment id bo'yicha)
export function receiptText(A, pid) {
  const p = A.S.payments[pid]; if (!p) return "";
  let r = null;
  for (let m = A.shift(p.month || A.today().slice(0, 7), -1), i = 0; i < 4 && !r; i++, m = A.shift(m, 1))
    r = A.rows(m).find(x => x.sid === p.sid && x.gid === p.gid && A.rowPays(x).some(q => q.id === pid)) || null;
  const s = A.S.students[p.sid], g = A.S.groups[p.gid];
  if (!s || !g) return "";
  const L = [`Assalomu alaykum! To'lov qabul qilindi ✅`, `${s.name}, "${g.name}" kursi`];
  if (r && r.b.cyc) L.push(`12 talik davr: ${A.fullD(r.b.cyc)} – ${A.fullD(r.b.last)}`);
  L.push(`To'landi: ${A.money(p.amount)} so'm (${A.fullD(p.date)}${p.method ? ", " + p.method : ""})`);
  if (r) L.push(r.left > 0 ? `Shu davr bo'yicha qoldi: ${A.money(r.left)} so'm` : `Shu davr to'liq to'landi.`);
  if (r && r.b.next) L.push(`Keyingi to'lov kuni: ${A.fullD(r.b.next)}`);
  if (A.center()) L.push(`\nHurmat bilan, ${A.center()}`);
  return L.join("\n");
}
