import { store, okUid, body, cleanChat, claudeText, parseJson, MODEL_KORREKTUR, kiAn } from "../lib/common.mjs";
import { DATA, oralEvalPrompt } from "../lib/shared.mjs";

/* Hintergrundfunktion: Bewertung der mündlichen Prüfung, Ergebnis unter <uid>/oral-<fall>-<sid> */
export default async (req) => {
  const bd = await body(req);
  if(!bd || !okUid(bd.uid) || !/^\d{6,16}$/.test(String(bd.sid || ""))) return;
  const o = DATA.muendlich.find(f => f.id === bd.fall);
  if(!o) return;
  const id = o.id + "-" + bd.sid, k = bd.uid + "/oral-" + id, s = store();
  const alt = await s.get(k, { type: "json" });
  if(alt && (alt.bewertung || (alt.wartet && !alt.fehler))) return;   // schon bewertet oder liegt bei der Prüferin
  const chat = cleanChat(bd.chat);
  const doc = { id, fall: o.id, uid: bd.uid, name: String(bd.name || "").slice(0, 80), notizen: String(bd.notizen || "").slice(0, 3000), planung: (Array.isArray(bd.planung) ? bd.planung : []).slice(0, 6).map(r => ({ p: String(r && r.p || "").slice(0, 1500), z: String(r && r.z || "").slice(0, 800), m: String(r && r.m || "").slice(0, 1500), b: String(r && r.b || "").slice(0, 1500) })), chat, am: Date.now() };
  if(!kiAn()){ doc.wartet = Date.now(); await s.setJSON(k, doc); return; }
  try{
    doc.bewertung = parseJson(await claudeText(oralEvalPrompt(o, chat, doc.planung), { model: MODEL_KORREKTUR(), max_tokens: 4000 }));
  }catch(e){ console.error(e); doc.fehler = String((e && e.message) || e).slice(0, 300); doc.fehlerFuer = bd.t || 0; }
  await s.setJSON(k, doc);
};

export const config = { path: "/api/muendlich", background: true, rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ["ip", "domain"] } };
