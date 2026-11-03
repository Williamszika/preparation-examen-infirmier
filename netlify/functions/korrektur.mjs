import { store, okUid, okKey, body, claudeText, parseJson, MODEL_KORREKTUR, kiAn } from "../lib/common.mjs";
import { DATA, prueferPrompt, auswerten } from "../lib/shared.mjs";

/* Hintergrundfunktion: die Seite bekommt sofort 202 und fragt danach /api/versuche ab. */
export default async (req) => {
  const bd = await body(req);
  if(!bd || !okUid(bd.uid) || !okKey(bd.key)) return;
  const s = store(), k = bd.uid + "/" + bd.key;
  const d = await s.get(k, { type: "json" });
  if(!d || d.korrektur) return;
  const ex = DATA.pruefungen.find(e => e.id === d.pruefung);
  if(!ex) return;
  if(d.status === "laeuft"){ d.status = "abgegeben"; d.abgegeben = Math.min(Date.now(), d.ende); }
  d.endgueltig = true;
  if(!(await kiAn())){ delete d.korrekturFehler; d.korrekturWartet = Date.now(); d.geaendert = Date.now(); await s.setJSON(k, d); return; }
  try{
    const text = await claudeText(prueferPrompt(ex, d.antworten), { model: MODEL_KORREKTUR(), max_tokens: 12000 });
    d.korrektur = auswerten(ex, parseJson(text), "Claude (Prüferin)");
    delete d.korrekturFehler;
  }catch(e){
    console.error(e);
    d.korrekturFehler = String((e && e.message) || e).slice(0, 300); d.fehlerFuer = bd.t || 0;
  }
  d.geaendert = Date.now();
  await s.setJSON(k, d);
};

export const config = { path: "/api/korrektur", background: true, rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ["ip", "domain"] } };
