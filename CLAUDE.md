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
| `muendlich/PRUEFER.md` | wie Claude im Gespräch Prüferin wird |
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
