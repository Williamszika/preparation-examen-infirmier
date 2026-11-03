import { createHash } from "node:crypto";
import { store, bad, body, okUid, okKey } from "../lib/common.mjs";
import { DATA, auswerten } from "../lib/shared.mjs";

/* SHA-256 des Zugangsschlüssels der Besitzerin (der Schlüssel selbst steht nicht im Repo). ADMIN_TOKEN als Umgebungsvariable geht auch. */
const HASH = "87d0b7961b66c8259fa27100b7f5635cb00537f1f22e2dc8736e08592284302f";
const erlaubt = given => { const token = Netlify.env.get("ADMIN_TOKEN"); return !!given && ((token && given === token) || createHash("sha256").update(String(given)).digest("hex") === HASH); };

export default async (req) => {
  const s = store();
  if(req.method === "GET"){
    if(!erlaubt(new URL(req.url).searchParams.get("token"))) return bad("Zugang verweigert", 403);
    const { blobs } = await s.list();
    const docs = [];
    for(const b of blobs){ const d = await s.get(b.key, { type: "json" }); if(d) docs.push({ ...d, pid: d.uid }); }
    return Response.json({ docs });
  }
  /* POST: Korrektur der Prüferin eintragen.
     {token, uid, key, bewertung:{aufgaben:[…], staerken, ueben, gesamt, gesamtFr}, von}  → schriftlich
     {token, uid, oral:"m1-<sid>", bewertung:{kb, note, …}}                                → mündlich */
  const bd = await body(req);
  if(bd && erlaubt(bd.token) && okUid(bd.uid) && bd.loeschen && (okKey(bd.key) || bd.oral)){
    await s.delete(bd.uid + "/" + (bd.oral ? "oral-" + String(bd.oral).replace(/[^a-z0-9-]/gi, "") : bd.key)); return Response.json({ ok: true });
  }
  if(!bd || !erlaubt(bd.token) || !okUid(bd.uid) || !bd.bewertung) return bad("Zugang verweigert oder Anfrage ungültig", 403);
  if(bd.oral){
    const k = bd.uid + "/oral-" + String(bd.oral).replace(/[^a-z0-9-]/gi, "");
    const d = await s.get(k, { type: "json" }); if(!d) return bad("nicht gefunden", 404);
    d.bewertung = bd.bewertung; delete d.wartet; delete d.fehler; d.bewertetAm = Date.now();
    await s.setJSON(k, d); return Response.json({ ok: true });
  }
  if(!okKey(bd.key)) return bad("key");
  const k = bd.uid + "/" + bd.key;
  const d = await s.get(k, { type: "json" }); if(!d) return bad("nicht gefunden", 404);
  const ex = DATA.pruefungen.find(e => e.id === d.pruefung); if(!ex) return bad("Klausur unbekannt");
  d.korrektur = auswerten(ex, bd.bewertung, String(bd.von || "Claude (Prüferin)"));
  d.endgueltig = true; if(d.status === "laeuft") { d.status = "abgegeben"; d.abgegeben = d.ende; }
  delete d.korrekturWartet; delete d.korrekturFehler; d.geaendert = Date.now();
  await s.setJSON(k, d);
  return Response.json({ ok: true, summe: d.korrektur.summe, prozent: d.korrektur.prozent, note: d.korrektur.note });
};

export const config = { path: "/api/admin", method: ["GET", "POST"], rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
