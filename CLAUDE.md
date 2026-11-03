# Arbeitsanweisungen — Préparation examen infirmier

Nutzerin: französischsprachige Pflegeauszubildende (generalistische Ausbildung, NRW), Deutsch A2→B1.
Erklärungen auf Französisch, Prüfungsinhalte auf Deutsch.

**Grundregel: nichts erfinden.** Erwartungshorizonte nur aus ihren Unterlagen (Google-Drive-Ordner,
den sie schickt, und das Repo `Williamszika/Etude-et-revision-exercice-et-Examen`), jede Zeile mit Quelle.
Was für den Übungsfall erfunden ist (Namen, Alter, Details), steht in `fiktiv`. Fehlt Material zu
einem Matrix-Thema, steht es in `luecken` — nicht auffüllen.

## Was hier liegt

| | |
|---|---|
| `matrix/` | die Matrix ihrer Schule (PDF, Kurs 23-26) und `matrix.json` (Wortlaut der CE/UE) |
| `pruefungen/k<Klausur><variante>.json` | schriftliche Aufsichtsarbeiten, 120 Min, je ≈ 100 Punkte, AFB ≈ 30/40/30 |
| `muendlich/m<n>.json` | Fälle für die mündliche Prüfung (KB III, IV, V) |
| `muendlich/PRUEFER.md` | wie Claude im Gespräch Prüferin wird (öffentlicher Link, für jede Claude-Unterhaltung) |
| `pruefungen/STIL.md` | **Regeln für jede neue Klausur** (aus der Recherche) — vor dem Schreiben lesen |
| `recherche/` | Internet-Recherche zum Examen (Fragestil, Fallen, mündlich) und `tipps.json` für den Reiter „Tipps“ |
| `app/vorlage.html` → `build.py` → `app/index.html` | die Übungsseite (Artifact) |

**Ihr Plan (03.11.2026):** Tag 1 = Klausur 1 (alter Mensch, Pflegeheim), Tag 2 = Klausur 2
(Erwachsene/behinderte Menschen, ambulant), Tag 3 = Klausur 3 (Kind, Krankenhaus) — jeden Tag
**erst Variante A, dann B**. Dazu die mündliche Prüfung.

## Die Seite

Artifact-URL: steht in `README.md` (nie eine neue URL anlegen, immer dieselbe aktualisieren).
- Aufgaben verschlossen bis „Ich bin bereit“, dann Uhr (120 Min) oben; Antworten werden laufend
  gespeichert; bis Zeitende wieder zu öffnen; bei 0 schließt alles und wird abgegeben.
- Speicher: `db`-Capability, Pfad `abgaben/<userId>/versuche/<pruefung>-<versuch>`; die Besitzerin
  liest alle (Reiter „Abgaben“), jede Person schreibt nur ihre eigenen. Claude liest sie mit
  `ArtifactData` und kann eine Korrektur in das Feld `korrektur` schreiben.
- „Korrektur und Note“: die Seite fragt Claude (`sample`) als Prüferin, streng am Erwartungshorizont.
  Note nach dem NRW-Schlüssel aus `ressources/klausur-konventionen.md` (Etude-Repo) —
  **Übungsnote**, nie als amtliche Bewertung ausgeben.
- Nach jeder neuen Klausur: `python3 build.py`, committen, Artifact mit derselben URL neu veröffentlichen.

## Die öffentliche Seite (Netlify) — seit 03.11.2026

Ihr Wunsch: *„la personne ne doit pas forcément avoir Claude pour ouvrir“* → **https://examen-pflege-uebung.netlify.app**
(kein Konto nötig: Name eingeben, Code für ein zweites Gerät steht auf der Startseite).

| | |
|---|---|
| `site/index.html` | dieselbe Seite wie das Artifact, `MODE = "public"` (von `build.py` erzeugt) |
| `netlify/functions/versuche.mjs` | Abgaben speichern/lesen (Netlify Blobs, Store `abgaben`, Schlüssel `<uid>/<pruefung>-<versuch>`); die Uhr läuft **auf dem Server** (`start`/`ende`), nach Ablauf + 2 Min nimmt er keine Änderung mehr an |
| `korrektur.mjs`, `muendlich.mjs` | Hintergrundfunktionen: Prüferin per Anthropic-SDK — **nur wenn ein Schlüssel da ist**. Sonst: `korrekturWartet` / `wartet` → die Seite sagt „liegt bei der Prüferin“ und bietet Selbstkontrolle |
| `pruefer.mjs` | mündliche Prüferin Zug um Zug; ohne Schlüssel 503 `ki_aus` → die Seite stellt die Fragen aus `m<n>.json` der Reihe nach |
| `admin.mjs` | `GET /api/admin?token=…` alle Abgaben · `POST /api/admin` `{token, uid, key, bewertung}` trägt eine Korrektur ein (Format wie die JSON-Antwort in `prueferPrompt`; der Server rechnet Punkte und Note mit `auswerten`) · `{token, uid, oral:"m1-<sid>", bewertung}` mündlich · `{…, loeschen:true}` löscht |

**Zugangsschlüssel:** hat sie (am 03.11.2026 im Chat bekommen). Im Repo steht nur der SHA-256-Hash. Nie den Schlüssel committen.

**KI-Korrektur auf Netlify ist (Stand 03.11.2026) aus:** Das AI Gateway lieferte keinen Schlüssel (ihr Netlify-Plan
`nf_team_dev`, vermutlich Legacy — das Gateway gibt es nur auf Credit-Plänen), und Umgebungsvariablen über das MCP
zu setzen gab 403. Zwei Wege zum Einschalten, beide macht **sie** in Netlify: (1) Plan auf Credit-basiert umstellen
→ Gateway injiziert `ANTHROPIC_API_KEY` automatisch, dann neu deployen; (2) unter Project configuration →
Environment variables `ANTHROPIC_API_KEY` (Scope Functions) eintragen, neu deployen. Bis dahin korrigiert Claude
in einer Sitzung: Abgaben mit `GET /api/admin` holen, streng am Erwartungshorizont bewerten, mit `POST /api/admin` eintragen.

**Deploy:** Netlify-MCP `deploy-site` (Site-ID oben) gibt einen `npx @netlify/mcp …`-Befehl aus (der Schlüssel darin läuft nach kurzer Zeit ab → bei „401 Unauthorized“ `deploy-site` neu aufrufen); im Repo-Wurzelordner
ausführen (vorher `python3 build.py`, `node_modules` nicht mit hochladen). Lockfile und `.nvmrc` (22) müssen bleiben —
ohne sie scheiterte „Install dependencies“.
