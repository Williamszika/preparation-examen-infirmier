import { store, okUid, okKey, bad, body, cleanAntworten } from "../lib/common.mjs";
import { DATA } from "../lib/shared.mjs";

export default async (req) => {
  const s = store();
  if(req.method === "GET"){
    const uid = new URL(req.url).searchParams.get("uid");
    if(!okUid(uid)) return bad("uid");
    const { blobs } = await s.list({ prefix: uid + "/" });
    const docs = [], oral = {};
    for(const b of blobs){
      const d = await s.get(b.key, { type: "json" });
      if(!d) continue;
      if(b.key.includes("/oral-")) oral[d.id] = d; else docs.push(d);
    }
    return Response.json({ docs, oral });
  }
  const bd = await body(req);
  if(!bd || !okUid(bd.uid) || !bd.doc || !okKey(bd.doc.key)) return bad("Anfrage ungültig");
  const ex = DATA.pruefungen.find(e => e.id === bd.doc.pruefung);
  if(!ex || !bd.doc.key.startsWith(ex.id + "-")) return bad("Klausur unbekannt");
  const k = bd.uid + "/" + bd.doc.key;
  const old = await s.get(k, { type: "json" });
  const now = Date.now();
  let doc;
  if(!old){
    doc = { key: bd.doc.key, pruefung: ex.id, versuch: Number(bd.doc.versuch) || 1, status: "laeuft", start: now, ende: now + ex.dauerMin * 60000, antworten: cleanAntworten(bd.doc.antworten) };
  } else {
    doc = { ...old };
    const offen = !old.endgueltig && !old.korrektur && now <= old.ende + 120000;   // 2 Minuten Kulanz für die Übertragung
    if(offen){
      doc.antworten = cleanAntworten(bd.doc.antworten);
      if(bd.doc.status === "laeuft" && now < old.ende){ doc.status = "laeuft"; delete doc.abgegeben; doc.automatisch = false; }
      else { doc.status = "abgegeben"; doc.abgegeben = Math.min(now, old.ende); doc.automatisch = !!bd.doc.automatisch || now >= old.ende; }
      if(bd.doc.endgueltig) doc.endgueltig = true;
    } else if(doc.status === "laeuft"){ doc.status = "abgegeben"; doc.abgegeben = old.ende; doc.automatisch = true; }
  }
  doc.uid = bd.uid; doc.name = String(bd.name || "").slice(0, 80); doc.geaendert = now;
  await s.setJSON(k, doc);
  return Response.json({ doc });
};

export const config = { path: "/api/versuche", method: ["GET", "POST"], rateLimit: { windowLimit: 180, windowSize: 60, aggregateBy: ["ip", "domain"] } };
