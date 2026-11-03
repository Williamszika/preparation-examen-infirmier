import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { bad, body, elevenKey, agnesVoice } from "../lib/common.mjs";

/* Die Prüferin spricht: ElevenLabs Text-to-Speech. Jeder Satz wird nur einmal erzeugt und dann aus dem Speicher geliefert. */
export default async (req) => {
  const key = await elevenKey();
  if(!key) return bad("stimme_aus", 503);
  const bd = await body(req);
  const text = String((bd && bd.text) || "").replace("[ENDE]", "").trim().slice(0, 1500);
  if(!text) return bad("kein Text");
  const voice = (await agnesVoice()).replace(/[^a-zA-Z0-9]/g, "");
  const model = "eleven_multilingual_v2";
  const cache = getStore("tts");
  const ck = createHash("sha256").update(voice + "|" + model + "|ruhig-0.88|" + text).digest("hex");
  const hit = await cache.get(ck, { type: "arrayBuffer" });
  if(hit) return new Response(hit, { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=86400" } });
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.65, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 0.88 } })
  });
  if(!r.ok){ console.error("tts", r.status, (await r.text()).slice(0, 300)); return bad("stimme_fehler", 502); }
  const buf = await r.arrayBuffer();
  await cache.set(ck, buf);
  return new Response(buf, { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=86400" } });
};
export const config = { path: "/api/tts", method: "POST", rateLimit: { windowLimit: 40, windowSize: 60, aggregateBy: ["ip", "domain"] } };
