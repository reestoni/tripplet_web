# TrippleT Web – Tablet & Mobile (Konzept, 2026-11-18)

Nutzerentscheid 2026-11-18: **alle Screens** werden auch für Tablet und Handy durchdacht – wo nötig abgespeckt.
Nur Web (keine Desktop-Entsprechung, wie das Tempo-Kapitel). Voraussetzung im Betrieb: Firmen-WLAN/VPN (IT-Liste).

## Grundregeln

- **Breiten:** Handy `< 600 px`, Tablet `600–1024 px`, darüber Desktop wie heute. Touch zusätzlich über
  `@media (pointer: coarse)` (Tablet quer kann breiter als 1024 sein und ist trotzdem Touch).
- **Eine Datei** `src/responsive.css` für Layout + Touch, gilt in allen Darstellungen (Klassisch/Modern/Nacht/Blaupause/Heberlein; Heberlein färbt Kopfzeile, Schublade, feste Leisten und Vollbild-Blätter selbst ein, `theme-heberlein.css`).
  Nur Aufbau (Spalten, Abstände, Grössen), keine Farben → Klassisch bleibt optisch gleich, Nacht-Generator unberührt.
  Komponenten, die auf dem Handy anders *funktionieren*, fragen `useMedia()` (neuer Hook in `src/media.ts`).
- **Shell:** unter 1024 px Seitenleiste als Schublade (☰ oben links, Wischen/Klick daneben schliesst), Kopfzeile mit
  Seitentitel, Suche, Glocke. Handy: Fuss-Werkzeuge + Konto in die Schublade.
- **Touch-Ersatz für Desktop-Bedienung** (gilt überall):
  - Rechtsklick-Menü → langes Drücken (500 ms) **und** sichtbarer „⋯“-Knopf an Zeile/Karte/Spalte.
  - Hover-Tooltips (Düse, Spule, Notizen) → Antippen öffnet den Kasten, Antippen daneben schliesst.
  - Strg+S / Strg+Z → feste Speicherleiste unten (Speichern, Rückgängig, Verwerfen), sobald etwas ungespeichert ist.
  - Drag & Drop → zusätzlich „Verschieben nach…“ im Menü.
  - Klickflächen mind. 40 px, Eingabefelder mind. 16 px Schrift (sonst zoomt iOS beim Antippen).
- **Dialoge:** Handy = Vollbild-Blatt mit Titelzeile + ✕, Knöpfe unten fest; Tablet wie heute, max. 90 vw.
- **Breite Tabellen:** scrollen in sich (erste Spalte bleibt stehen), nie die ganze Seite seitlich.
- **„Am PC besser“:** Screens, die auf dem Handy nur lesend/abgespeckt gehen, zeigen oben einen schmalen Hinweis
  (nicht blockierend). Nichts wird ganz gesperrt, ausser es geht technisch nicht sinnvoll (dann Hinweis statt Seite).

## Pro Screen

Legende: **voll** = alles wie Desktop, nur umgebaut · **abgespeckt** = Kernfunktionen, Rest Hinweis „am PC“ ·
**lesend** = ansehen ja, bearbeiten nein · Prio 1–3 = Reihenfolge der Umsetzung.

| Screen | Route | Tablet | Handy | Prio | Handy-Idee |
|---|---|---|---|---|---|
| Login | `/` | voll | voll | 1 | Karte über volle Breite, Flaggen bleiben |
| Backlog | `/backlog` | voll | abgespeckt | ✅ | 2026-11-18: Handy = Status-Reiter mit Zählern (Start „In Arbeit“), eine Spalte in voller Höhe, Wischen = Nachbar-Spalte; Karte antippen = öffnen, lange drücken = Menü (Status ändern …). 2026-11-19 (Nutzermeldung: Karten liessen sich nicht mehr verschieben - Android startete beim langen Drücken das Browser-Ziehen der `draggable`-Karte, und das Untermenü öffnete nur per Maus-Hover): auf dem Handy eigenes Finger-Ziehen - lange drücken (450 ms) hebt die Karte an, alle Status-Reiter werden Ziele (bleiben oben kleben, brechen um), loslassen auf einem Reiter = verschieben (gleiche Regeln/Rückfragen wie am PC), loslassen ohne Bewegung = Menü, woanders loslassen = abbrechen; Karten dort nicht `draggable`. Untermenüs (`ContextMenu`) öffnen jetzt auch per Antippen |
| Show Experiment | `/series/:id` | voll | abgespeckt | 1 | Kopf einklappbar, Reiter als waagrecht scrollbare Leiste; Tabelle: eine Versuchsspalte breit + Wechsel ◀ V3 ▶ **oder** quer gedreht volle Tabelle; Werte eintragen ja (Speicherleiste unten), Bulk Edit/Fill Row nur Tablet+; Notizen, Anhänge (Kamera-Upload!), Fazit voll |
| Yarn Stock | `/tools/yarn-stock` | voll | abgespeckt | ✅ | 2026-11-18: Handy = Karten Garn/Batch (Farbquadrat, Status-Pille, Batch, Hersteller, Spulen, kg, Lagerort; 60 + weitere), Antippen wählt und springt zu den Spulen; Spulen als Karten mit Häkchen und Feldern Gewicht/Lagerplatz/Hülse/Hersteller. Inline-Bearbeiten von Batch/Hersteller/Mindestbestand bleibt am PC |
| Inventur | `/tools/yarn-stock/stock-take` | voll | voll | ✅ | 2026-11-18: Seitenrand, grosses Scanfeld, „📷 Mit Kamera scannen“ (Vollbild, Rückkamera, `BarcodeDetector` = Chrome/Android; Safari ohne → Knopf weg, Handscanner gehen immer), erwartete Spulen als Karten (grün gefunden, blau von Hand; langes Drücken = von Hand / zurück). Kamera braucht HTTPS oder localhost |
| Schnellsuche, Glocke, Zuletzt | (Shell) | voll | voll | 1 | Vollbild-Blatt |
| Einstellungen | `/settings` | voll | voll | 1 | eine Spalte |
| All Experiments | `/experiments` | voll | abgespeckt | ✅ | 2026-11-18: Handy = Karten (ID, Maschine, Status-Pille, Name, Besitzer · Datum, Symbole Anhang/ER/Notizen/Report, Fazit 2 Zeilen), eine Suche für Name oder Experiment-ID, „Filter ▾“ = Maschinen, Fazit, Sortieren ▲▼; Antippen = öffnen, langes Drücken = Menü (Status ändern usw.), 100 + „weitere anzeigen“ |
| My Requests | `/requests` | voll | voll | ✅ | 2026-11-18: Handy = Karten (#ID, Projekt, Status-Pille, Titel mit NEW/Δ, Termin „n Tage überfällig“, Besitzer, → Experiment), Suche + „Filter ▾“ (Projekt, Besitzer, Aktualisieren), Status-Reiter zum Wischen, „Zu prüfen“ oben, runder Knopf „+“ = neue Anfrage. Reiter/Termin/„Zu prüfen“/„Dringende zuerst“ auch am PC und im Desktop |
| Request-Formular | `/requests/new`, `/:id` | voll | voll | ✅ | 2026-11-19: eine Spalte; auf Touch-Geräten Knopf „📷 Foto aufnehmen“ (`capture="environment"` = direkt die Rückkamera, „Bilder hinzufügen…“ bleibt für die Galerie); bis 1024 px klebt die Speichern-Zeile unten, solange etwas ungespeichert ist (`rq-actions-live`); Prüfung eines Änderungsvorschlags (Superuser) pro Feld untereinander. Bilder weiterhin erst nach dem ersten Speichern (bewusst, siehe PARITY) |
| Request-Popup | (Dialog) | voll | voll | ✅ | 2026-11-19: Vollbild-Blatt in voller Breite (vorher blieb `rqp-wide` = 94vw), das Blatt scrollt als Ganzes; Versionsverlauf als Liste (gilt auch am PC - die Einträge waren ungestaltete Knöpfe), Versionsvergleich pro Feld untereinander (`table.rqp-cmp`) |
| Report | `/series/:id/report` | voll | lesend | ✅ | Desktop-Vorlage im iframe: Diagramme untereinander, PDF-Knopf; Bearbeiten der Beobachtungen Tablet+ |
| Create Experiment / Add Series / Add Lab / Add Trials / Legacy | `/experiments/new` … | voll | abgespeckt | ✅ | 2026-11-19: Handy = Reiter bleiben als Leiste zum Wischen, unten fest „‹ Zurück · Schritt n von m · Weiter ›“, im letzten Schritt „Speichern“ (`ce-steps`); Düsenzeilen als Karten (Platten, Luftdruck, ▲ ▼, Kopieren = gleiche Zeile hinten an, ✕); Düsenauswahl nur Düse/Titerbereich/Idealtiter; Maschinenfelder eine pro Zeile, zeilenweise wie am PC (eine Zeile = was zusammengehört, z. B. Spannung vor/nach Düse); Legacy-Import (Strg+Umschalt+J) auf dem Handy = Hinweis „am PC oder Tablet“ (`PcOnly`) |
| Knowledge Base + Hilfe (F1) | `/knowledge-base` | voll | voll | ✅ | 2026-11-18 (Nutzerwunsch: Navigation oben, nicht neben der Seite): bis 1024 px Leiste „📚 Modul ▾“ oben, die Liste klappt darunter auf und ersetzt solange die Seite, Auswahl klappt zu; Szenen-Reiter einzeilig zum Wischen; Handy: Titel/Zusammenfassung weg, Seite randlos. Die Lernseiten selbst passen sich schon an. Hilfe (F1) geprüft 2026-11-18: Suche (Liste oben, Treffer darunter) und Kontext-Hilfe (Reiter, Text) passen ohne Änderung |
| Fresh off the Spool | (Dialog) / `/whats-new` | voll | voll | ✅ | 2026-11-18 (Nutzerwunsch): Handy = normale Seite `/whats-new` unter der Kopfzeile (Menü bleibt bedienbar, Zurück geht), auch das automatische Öffnen nach dem Login; Verlassen = gesehen, kein Schliessen-Knopf (Seite wie jede andere). Tablet/PC: Fenster mit Schliessen. Bis 1024 px Versionsauswahl + Suche oben statt der Liste links, Reiter zum Wischen |
| Yarn Count | `/tools/yarn-count` | voll | voll | ✅ | 2026-11-19: eine Spalte (seit 2026-11-18), Zahlen-Tastatur für Wert, Filamente, Fachung (`inputMode`); auf Touch kein Autofokus (sonst springt die Tastatur sofort auf) |
| Jet Advisor | `/tools/jet-advisor` | voll | abgespeckt | ✅ | 2026-11-19: bis 1024 px Eingaben über den Ergebnissen; Handy: „Düsen suchen“ klebt unten, nach der Suche springt die Seite zur Liste; Rangliste als Karten (Nr., Düse, Typ, Chance-Balken, Einstellungen mit Bereich, Ziele ✓/✗ ± Streuung, Luft, Grundlage), Antippen klappt die Details auf (gleicher Inhalt wie am PC) |
| DTY/ATY-YarnScope | Reiter in Show Experiment | voll | lesend | ✅ | 2026-11-19: Versuche als Leiste zum Wischen oben, Kennzahlen, Kuchen, Trendzeilen und Diagramme untereinander (Diagramme 300 px hoch); Batch, Vergleich und Speichern nur Tablet/PC (auf dem Handy ausgeblendet) |
| Manage Jets / Yarn / Stammtabellen / Projekte | `/admin/…` | voll | abgespeckt | ✅ | 2026-11-18 (Nutzerwunsch: übersichtlicher): `AdminTable` auf dem Handy = Kartenliste (Name, #ID, die ersten Spalten nach den eingefrorenen als Kennwerte, gelb = ungespeichert, 100 + „weitere anzeigen“), Antippen = Blatt mit allen Feldern untereinander (Eingabe/Auswahl/Häkchen wie in der Tabelle, sofort als Änderung, Speichern über die Seite); Knopfleiste kompakt. Gilt auch für Manage User |
| Manage User | `/superuser/users` | voll | abgespeckt | ✅ | Liste = AdminTable-Karten. „Zugriff…“ auf dem Handy (2026-11-18, Nutzerentscheid „beide mit Umschalter“): Umschalter „Nach Person | Nach Werkzeug“, Auswahl (mit Zahl der Ausnahmen), Suche, „Nur Ausnahmen“, pro Zeile Schalter Standard · Ja · Nein + was gilt und warum (über Gruppe / nach Zugriffsstufe) - `AccessPhone` in `ManageUsers.tsx`, gleiche Regeln/Speichern wie die Tabelle |
| Papierkorb | `/superuser/recycle-bin` | voll | voll | ✅ | 2026-11-19: Karten (Name, Art, Zusammenfassung, Datum · Benutzer); Antippen klappt die Aktionen in der Karte auf (Ansehen bei Serien, Wiederherstellen, Endgültig löschen - jeweils mit der bisherigen Bestätigung) |
| Dashboards | `/tools/dashboards` | voll | lesend | ✅ | Visuals untereinander (Desktop-Fläche im iframe, Breite anpassen) |
| Smart Chart (Editor) | `/tools/smart-chart` | abgespeckt | **raus** | – | Handy: nicht in der Seitenleiste, Direktaufruf = Hinweis „am PC oder Tablet öffnen“ (Nutzerentscheid 2026-11-18) |
| Jet ROI | `/tools/jet-roi` | voll | voll | ✅ | 2026-11-19: Einzel- und Mehrfachrechnung voll; Düse A/B untereinander, Vergleichstabelle als Karten (Beschriftung pro Wert), nach „Berechnen“ springt die Seite zum Ergebnis, bei einem Fehler zur Meldung (gilt auch für Jet Advisor und Quick Scan); PDF wie am PC |
| Process Playground | `/tools/process-playground` | voll | voll | ✅ | 2026-11-19: alles untereinander (ab 1024 px schon die Startwerte/Regler-Karten); Kombinationsliste 40 % hoch, Antippen springt zur gewählten Kombination; Ergebnistabelle als kleine Karten (Kennwert, Start, Änderung, Aussage, Grundlage, Ziel); Diagramm und Vorschläge wie am PC |
| Requirement Hub / Quick Scan | `/tools/requirement-hub…` | voll | voll | ✅ | 2026-11-19: Regelzeilen umbrechen (Feldname oben, Bedingung darunter), Treffer als Karten (Experiment · Versuch, Score, Serie, Düse/Garn/Titer, Werte der Ziele), 100 + „weitere anzeigen“, Antippen öffnet die Serie; nach der Suche Sprung zu den Treffern. Regelsätze laden/speichern gehen auch auf dem Handy |
| TDMS Inspector | `/tools/tdms-inspector` | voll | **raus** | – | wie Smart Chart (Nutzerentscheid 2026-11-18) |
| Image Compare | `/tools/image-compare` | abgespeckt | **raus** | – | Tablet: 1–2 Felder, Stift/Finger; Handy raus (Nutzerentscheid 2026-11-18) |
| Canvas | `/tools/canvas` | abgespeckt | **raus** | – | Tablet: Stift/Finger, Zwei-Finger-Zoom; Handy raus (Nutzerentscheid 2026-11-18) |
| Label Generator | `/tools/label-generator` | abgespeckt | **raus** | – | Tablet: Elemente als Liste + Eigenschaften-Blatt; Handy raus (Nutzerentscheid 2026-11-18) |
| Air Supply | `/tools/air-supply` | voll | voll | ✅ | 2026-11-19 (Nutzer: „gerade unterwegs interessant“): Zeichenfläche auf Pointer-Events umgestellt = Finger, Stift und Maus: ein Finger verschiebt, zwei Finger zoomen, Antippen wählt, langes Drücken = Menü (Umbenennen, Duplizieren, Löschen). Handy: Elemente lassen sich nicht ziehen (Finger auf einem Element verschiebt die Fläche - Lage zählt für die Rechnung nicht), Werkzeugleiste zum Wischen, Fläche halbe Höhe ohne Legende, Eigenschaften darunter - Netz laden, Werte ändern, Elemente hinzufügen/verbinden, Ergebnis, Optimierung, PDF/Excel gehen. Tablet: wie PC inkl. Ziehen mit dem Finger |

**Handy ganz raus** (Nutzerentscheid 2026-11-18): Bildvergleich, Canvas, Smart Chart, Etiketten-Generator, TDMS Inspector -
`PHONE_HIDDEN` in `src/media.ts` (Seitenleiste filtert), `PcOnly` in `pages/NotYet.tsx` (Route zeigt den Hinweis). Tablet behält sie.

## Umsetzung (Reihenfolge)

1. Grundgerüst: `responsive.css`, `media.ts` (`useMedia`, `useLongPress`), Shell-Schublade, Dialog-Blatt, Touch-Ersatz
   (Menü „⋯“/langes Drücken, Tooltips per Antippen, Speicherleiste). Damit wird jede Seite schon benutzbar.
2. Prio 1: Backlog, Show Experiment, Yarn Stock, Inventur.
3. Prio 2, dann Prio 3.
4. Pro Screen prüfen in der Browser-Vorschau mit `resize_window` (mobile 375×812, tablet 768×1024, quer) in Modern
   **und** Klassisch; Strg+F-Suche, Tastaturbedienung am PC dürfen sich nicht ändern.

Neue Seiten ab jetzt: gleich mit Handy-Fall bauen (Tabelle → Karten unter 600 px, Menü „⋯“ statt nur Rechtsklick).

## Testen

- **Am PC (am schnellsten):** Chrome F12 → Gerätesymbol (Strg+Umschalt+M) → oben Gerät wählen (iPhone, iPad, „Responsive“).
  Langes Drücken lässt sich dort mit gedrückter Maus nachstellen (Touch-Simulation ist an). Oder einfach das Fenster schmal ziehen:
  unter 1024 px kommt die Schublade.
- **Echtes Android-Handy, ohne den Server zu öffnen:** USB-Debugging am Handy einschalten, per USB an den PC, in Chrome am PC
  `chrome://inspect` → „Port forwarding“ `8000` → `localhost:8000` (bzw. 8010) eintragen. Dann am Handy in Chrome
  `http://localhost:8000` - der Server bleibt auf 127.0.0.1 (Regel Phase 1).
- **iPhone/iPad oder Handy übers WLAN:** geht erst, wenn der Server im Netz erreichbar ist (Test-VM `test`, oder lokal an die
  PC-Adresse binden) - das ist eine Freigabe-Frage (heute nur 127.0.0.1).

## Stand

| Schritt | Stand |
|---|---|
| Konzept | ✅ 2026-11-18 |
| Grundgerüst | ✅ 2026-11-18: `responsive.css`, `media.ts` (`useMedia`, `PHONE`/`TABLET`/`TOUCH`, langes Drücken = `contextmenu` für iOS), Kopfzeile ☰ + Seitentitel + Suche, Seitenleiste als Schublade (Tablet ≤ 1024 px von links; Handy < 600 px klappt sie unter der Kopfzeile nach unten auf, volle Breite, ☰ wird ✕ - Nutzerwunsch; schliesst bei Seitenwechsel/Esc/Tippen daneben), Dialoge auf dem Handy als Vollbild-Blatt mit ✕ (`.m-x` in `Modal` und Schnellsuche), Touch-Grössen |
| Tooltips per Antippen | ✅ 2026-11-19: `components/TapTip.tsx` (im Shell): Finger/Stift tippt auf eine Tabellenzelle oder einen Kopf (`td`/`th`, sonst `[data-tip]`) mit Tooltip → Kasten darunter (oben, wenn kein Platz), folgt beim Scrollen, Tippen daneben oder auf den Kasten schliesst, Seitenwechsel auch. Inhalt = `data-tip` / `data-tip-img` (EditCell: Düse, Spule, Housing-Bild) + `title` (Notizen, Referenz, Ply), ein `title`, der nur den Zelltext wiederholt, zählt nicht. Gelesen in der Capture-Phase, weil derselbe Tipp den Editor öffnet (bearbeitbare Zelle: Editor + Kasten zusammen). Knöpfe/Links/Felder nie. Hover-Kasten von EditCell nur noch für die Maus (`pointerType`). Neue Tooltips: `title` oder `data-tip` auf die Zelle, nichts weiter |
| Speicherleiste unten | ✅ 2026-11-19: Show Experiment bis 1024 px: sobald etwas ungespeichert ist (oder eine Meldung steht), sitzt `.ed-bar` fest unten (Klasse `ed-bar-live` aus `edit.tsx`; Speichern / Rückgängig / Verwerfen, Wiederherstellen nur ab Tablet), Seite bekommt Platz darunter; „Gespeichert“ verschwindet dort nach 4 s. Admin-Tabellen, Manage User und Yarn-Stock-Spulen: der Speichern-Knopf (`.mj-save`) schwebt unten rechts, solange er aktiv ist. PC unverändert |
| Formular-Köpfe | ✅ 2026-11-18 (Nutzerwunsch, lange Titel): `.se-head` (Anfrage-Formular, Create Experiment / Add Series / Add Trials) auf dem Handy - Titel über die ganze Breite neben „←“, übrige Knöpfe in eigener Zeile rechts; Karten mit kleinerem Innenrand |
| Menü + Fenster | ✅ 2026-11-18: Suche, Zuletzt geöffnet, Hilfe, Fresh off the Spool, Glocke und Konto-Menüpunkte schliessen das Menü zuerst (`closeForTool` in `Shell.tsx`); Glocke und Zuletzt-geöffnet hängen auf Handy/Tablet am Seiten-Body (Portal), am PC unverändert |
| Touch-Öffnen | ✅ 2026-11-18: einmal Antippen öffnet Backlog-Karten/Archiv, All Experiments, My Requests (`isTouch`, `tapOnControl`); Backlog auf dem Handy scrollt als Seite |
| Show Experiment | 🟡 2026-11-18 (Nutzerwunsch: Tabelle im Vordergrund, Rest wegklappbar): bis 1024 px Titelzeile ← / Serienname / „Details ▾“; zugeklappt sind Kopf, Notizen, Ansichtsleiste (Plies/Gruppen/Kompakt, Werkzeuge), Schema und Bearbeitungs-Hinweis weg, die Speicherleiste erscheint nur bei Ungespeichertem/Meldung; Reiter einzeilig zum Wischen; Handy: schmalere Zeilentitel. Zelle antippen = bearbeiten (Zahlentastatur bei Zahlen). Fazit-Reiter auf dem Handy (ab 25 Versuchen): „Beste Versuche“ = gewählte als Chips + „Versuche wählen…“ (Blatt mit Suche und Häkchen). Handy: ein Versuch auf einmal - Leiste ◀ Auswahl n/N ▶ + „Alle Versuche“, Wischen über die Tabelle wechselt (Maschinendaten/R&D über `MachineTable onlyTrial`, Labor-Reiter in `SeriesBody`) |
| Report | ✅ 2026-11-18 (Nutzerwunsch): Fenster ≤ 1024 px (Body-Klasse `m-small` aus der Fensterbreite der Web-App, nicht der iframe-Breite - am PC ist der iframe neben der Seitenleiste schmal): Visuals untereinander in voller Breite; oberer Teil (Werkzeugleiste, Serien-Info) und die Einstellzeilen jeder Diagrammkarte hinter „Optionen ▾“ weggeklappt (alles in `backend/app/static/web_bridge.js`, Desktop-Vorlage unverändert); Kopf der Report-Seite einzeilig |
| Dashboards | ✅ 2026-11-18 (Nutzerwunsch: nichts neben dem Dashboard): Liste als Auswahl „Name ▾“ über der Fläche (+ PDF), Visuals untereinander in Lesereihenfolge (Slicer/KPI so hoch wie der Inhalt), Filterbereich hinter „Filter ▾“ als Vollbild (`smart_bridge.js`, nur Nur-lesen-Ansicht) |
| Prio 1 sonst | ✅ 2026-11-18: Backlog-Reiter, Yarn Stock, Inventur (Kamera-Scan), All Experiments, My Requests, Admin-Tabellen, Manage User, Knowledge Base, Fresh off the Spool (Details in der Tabelle oben). Einstellungen, Garnfeinheit, Düsen-ROI, Prozess-Spielwiese, Quick Scan ragen auf dem Handy nicht mehr über den Rand (einspaltig, Tabellen scrollen in sich) - noch nicht einzeln als „voll“ abgenommen |
| Prio 2 | ✅ 2026-11-19: Request-Formular, Request-Popup, Create Experiment, Yarn Count, Jet Advisor (Details in der Tabelle oben). Geprüft in der Handy-Ansicht 375×812 und am PC (1280 px unverändert); nicht auf einem echten Gerät, die Kamera-Aufnahme selbst also noch nicht |
| Prio 3 | ✅ 2026-11-19: YarnScope, Papierkorb, Jet ROI, Process Playground, Quick Scan, Air Supply (Details in der Tabelle oben). Geprüft in der Handy-Ansicht 375×812 (Papierkorb und Quick-Scan-Treffer mit Beispieldaten im Browser, da dev_local leer bzw. die Abfrage sehr langsam war) und am PC 1280 px (unverändert, Air Supply: Ziehen mit der Maus geht) |
| Offen | Alle Screens umgesetzt. Nicht auf echten Geräten geprüft (Handy, Tablet, Stift). Kamera-Scan der Inventur noch nie auf einem echten Android-Handy getestet (Weg siehe „Testen“) |
