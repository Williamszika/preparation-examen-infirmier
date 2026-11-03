import { okUid, bad, body, cleanChat, claudeText, MODEL_GESPRAECH, kiAn, prueferin, kiAnbieter } from "../lib/common.mjs";
import { DATA, oralRules, rolle } from "../lib/shared.mjs";

export default async (req) => {
  const bd = await body(req);
  if(!bd || !okUid(bd.uid)) return bad("Anfrage ungültig");
  const o = DATA.muendlich.find(f => f.id === bd.fall);
  if(!o) return bad("Fall unbekannt");
  if(!(await kiAn())) return bad("ki_aus", 503);
  const chat = cleanChat(bd.chat);
  if(!chat.length){ // Eröffnung immer gleich: Name der Stimme + die typische Einstiegsfrage (Recherche [10])
    const R = rolle(await prueferin());
    return Response.json({ text: `Guten Tag, ich bin ${R.name}, ${R.ihr} ${R.pruef}. Fassen Sie zusammen, worum es in der Fallsituation im Wesentlichen geht.` });
  }
  if((await kiAnbieter()).art === "agnes") return gefuehrt(o, chat, bd);
  const messages = cleanChat([{ role: "user", content: oralRules(o, bd.notizen, bd.planung, await prueferin()) }, ...chat]);
  if(messages[messages.length - 1].role !== "user") messages.push({ role: "user", content: "(weiter)" });
  try{
    const text = await claudeText(messages, { model: MODEL_GESPRAECH(), max_tokens: 700 });
    return Response.json({ text: text || "Bitte wiederholen Sie Ihre Antwort." });
  }catch(e){ console.error(e); return e && e.status === 429 ? bad("Zu viele Anfragen bei der KI (Grenze des kostenlosen Kontos). Warte eine Minute.", 429) : bad("Die Prüferin antwortet gerade nicht.", 502); }
};

export const config = { path: "/api/pruefer", method: "POST", rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] } };

/* Geführter Ablauf für Agnes AI (schwächeres Modell, erfand am 03.11.2026 Sprachfehler):
   Der Server bestimmt die nächste Frage aus dem Fall; das Modell entscheidet nur zwischen
   „eine Nachfrage aus der Liste“ und „kurzer Satz + nächste Frage“, beides wörtlich. Sprachkorrektur erst in der Bewertung. */
const PLAN_FRAGE = "Sie haben eine Pflegeplanung vorbereitet. Welches Pflegeproblem hat für Sie Vorrang, und wie begründen Sie Ihre wichtigste Maßnahme?";
async function gefuehrt(o, chat, bd){
  const R = rolle(await prueferin());
  const hatPlan = (Array.isArray(bd.planung) ? bd.planung : []).some(r => r && (r.p || r.m));
  const liste = [...(hatPlan ? [{ frage: PLAN_FRAGE, nachfragen: ["Woran erkennen Sie, dass Ihr Ziel erreicht ist?", "Wer im Team übernimmt diese Maßnahme, und warum?"], erwartung: [{ text: "Problem nach PE(S)R, messbares und terminiertes Ziel, begründete Maßnahme" }] }] : []), ...o.fragen];
  const gesagt = chat.filter(m => m.role === "assistant").map(m => m.content);
  const gestellt = i => gesagt.some(t => t.includes(liste[i].frage));
  let aktuell = -1; for(let i = 0; i < liste.length; i++) if(gestellt(i)) aktuell = i;
  const naechste = liste.findIndex((f, i) => i > aktuell && !gestellt(i));
  const schluss = "Vielen Dank. Die Prüfung ist beendet. [ENDE]";
  const weiterText = naechste >= 0 ? liste[naechste].frage : schluss;
  const antwort = [...chat].reverse().find(m => m.role === "user")?.content || "";
  if(aktuell < 0) return Response.json({ text: "Danke. " + weiterText });       // Antwort auf die Zusammenfassung
  const f = liste[aktuell];
  const offen = (f.nachfragen || []).filter(n => !gesagt.some(t => t.includes(n)));
  const prompt = `Du bist ${R.name}, ${R.pruef} in einer mündlichen Pflegeprüfung. Die Kandidatin lernt Deutsch (B1).
Aktuelle Frage: ${f.frage}
Erwartete Punkte (geheim): ${(f.erwartung || []).map(e => e.text).join("; ")}
Antwort der Kandidatin: <<<${antwort.slice(0, 3000)}>>>

Antworte NUR mit JSON: {"entscheidung":"nachfrage"|"weiter","nachfrage_nr":0,"satz":"ein kurzer neutraler Aussagesatz auf Deutsch (KEINE Frage), siezen, ohne Lösung, ohne Sprachkorrektur"}
- "nachfrage", wenn wichtige erwartete Punkte fehlen und es noch eine Nachfrage gibt. Mögliche Nachfragen (nummeriert): ${offen.map((n, i) => `[${i}] ${n}`).join(" ") || "(keine mehr)"}
- sonst "weiter".`;
  let wahl = { entscheidung: "weiter", satz: "Danke." };
  try{ const t = await claudeText(prompt, { model: MODEL_GESPRAECH(), max_tokens: 200 }); const j = JSON.parse((t.match(/\{[\s\S]*\}/) || ["{}"])[0]); if(j && j.entscheidung) wahl = j; }
  catch(e){ if(e && e.status === 429) return bad("Zu viele Anfragen bei der KI (Grenze des kostenlosen Kontos). Warte eine Minute.", 429); console.error(e); }
  let satz = String(wahl.satz || "Danke.").replace(/[\[\]{}<>*#]/g, "").slice(0, 200).trim() || "Danke.";
  if(satz.includes("?")) satz = wahl.entscheidung === "nachfrage" ? "Gut, ich frage nach." : "Danke.";   // nie zwei Fragen auf einmal
  if(wahl.entscheidung === "nachfrage" && offen.length){
    const n = offen[Math.min(Math.max(0, Number(wahl.nachfrage_nr) || 0), offen.length - 1)];
    return Response.json({ text: satz + " " + n });
  }
  return Response.json({ text: satz + " " + weiterText });
}
