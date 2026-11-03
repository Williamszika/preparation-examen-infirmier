import { okUid, bad, body, cleanChat, claudeText, MODEL_GESPRAECH, kiAn, prueferin } from "../lib/common.mjs";
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
  const messages = cleanChat([{ role: "user", content: oralRules(o, bd.notizen, bd.planung, await prueferin()) }, ...chat]);
  if(messages[messages.length - 1].role !== "user") messages.push({ role: "user", content: "(weiter)" });
  try{
    const text = await claudeText(messages, { model: MODEL_GESPRAECH(), max_tokens: 700 });
    return Response.json({ text: text || "Bitte wiederholen Sie Ihre Antwort." });
  }catch(e){ console.error(e); return e && e.status === 429 ? bad("Zu viele Anfragen bei der KI (Grenze des kostenlosen Kontos). Warte eine Minute.", 429) : bad("Die Prüferin antwortet gerade nicht.", 502); }
};

export const config = { path: "/api/pruefer", method: "POST", rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] } };
