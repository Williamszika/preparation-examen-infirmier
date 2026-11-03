import { kiAn, stimmeAn, prueferinName } from "../lib/common.mjs";

/* Was ist eingeschaltet? Die Seite blendet danach Stimme und Mikrofon ein. Gibt nie Schlüssel heraus. */
export default async () => {
  let ki = false, stimme = false, name = "Sarah";
  try{ [ki, stimme, name] = await Promise.all([kiAn(), stimmeAn(), prueferinName()]); }catch(e){ console.error(e); }
  return Response.json({ ki, stimme, name });
};
export const config = { path: "/api/status", method: "GET" };
