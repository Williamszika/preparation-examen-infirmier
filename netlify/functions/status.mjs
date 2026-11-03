import { kiAn, stimmeAn } from "../lib/common.mjs";

/* Was ist eingeschaltet? Die Seite blendet danach Stimme und Mikrofon ein. Gibt nie Schlüssel heraus. */
export default async () => {
  let ki = false, stimme = false;
  try{ [ki, stimme] = await Promise.all([kiAn(), stimmeAn()]); }catch(e){ console.error(e); }
  return Response.json({ ki, stimme });
};
export const config = { path: "/api/status", method: "GET" };
