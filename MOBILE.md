# TrippleT Web – Tablet & Mobile (Konzept, 2026-11-18)

Nutzerentscheid 2026-11-18: **alle Screens** werden auch für Tablet und Handy durchdacht – wo nötig abgespeckt.
Nur Web (keine Desktop-Entsprechung, wie das Tempo-Kapitel). Voraussetzung im Betrieb: Firmen-WLAN/VPN (IT-Liste).

## Grundregeln

- **Breiten:** Handy `< 600 px`, Tablet `600–1024 px`, darüber Desktop wie heute. Touch zusätzlich über
  `@media (pointer: coarse)` (Tablet quer kann breiter als 1024 sein und ist trotzdem Touch).
- **Eine Datei** `src/responsive.css` für Layout + Touch, gilt in allen Darstellungen (Klassisch/Modern/Nacht/Blaupause).
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
| Backlog | `/backlog` | voll | abgespeckt | 1 | Spalten als Reiter (eine Status-Spalte sichtbar, wischen), Karte antippen = Show Experiment, „⋯“ = Verschieben nach… (gleiche Regeln/Dialoge inkl. Joker, Fazit-Frage) |
| Show Experiment | `/series/:id` | voll | abgespeckt | 1 | Kopf einklappbar, Reiter als waagrecht scrollbare Leiste; Tabelle: eine Versuchsspalte breit + Wechsel ◀ V3 ▶ **oder** quer gedreht volle Tabelle; Werte eintragen ja (Speicherleiste unten), Bulk Edit/Fill Row nur Tablet+; Notizen, Anhänge (Kamera-Upload!), Fazit voll |
| Yarn Stock | `/tools/yarn-stock` | voll | abgespeckt | 1 | Suche + „Zu Spule #“/Scan oben, Garn→Batch→Spulen als aufklappbare Liste, Spule bearbeiten/ausbuchen voll; Excel-Export/Etikettenbogen Tablet+ |
| Inventur | `/tools/yarn-stock/stock-take` | voll | voll | 1 | Scan-Ansicht ist der Handy-Fall: grosses Scanfeld, Kamera-QR (BarcodeDetector, sonst Feld), Kacheln 2-spaltig |
| Schnellsuche, Glocke, Zuletzt | (Shell) | voll | voll | 1 | Vollbild-Blatt |
| Einstellungen | `/settings` | voll | voll | 1 | eine Spalte |
| All Experiments | `/experiments` | voll | abgespeckt | 2 | Kartenliste statt Tabelle (ID, Titel, Maschine, Status, Fazit-Punkt), Filter als Blatt; Spaltenwahl Tablet+ |
| My Requests | `/requests` | voll | voll | 2 | Kartenliste, Status ändern über „⋯“ |
| Request-Formular | `/requests/new`, `/:id` | voll | voll | 2 | eine Spalte; Bilder per Kamera; Versionsvergleich untereinander |
| Request-Popup | (Dialog) | voll | voll | 2 | Vollbild-Blatt |
| Report | `/series/:id/report` | voll | lesend | 2 | Desktop-Vorlage im iframe: Diagramme untereinander, PDF-Knopf; Bearbeiten der Beobachtungen Tablet+ |
| Create Experiment / Add Series / Add Lab / Add Trials / Legacy | `/experiments/new` … | voll | abgespeckt | 2 | Reiter als Schritte (Weiter/Zurück), Düsenzeilen als Karten mit ▲▼ statt Ziehen; Legacy-Import nur Tablet+ (Hinweis) |
| Knowledge Base + Hilfe (F1) | `/knowledge-base` | voll | voll | 2 | Liste → Artikel (zwei Ebenen statt Split), Skizzen zoombar |
| Fresh off the Spool | (Dialog) | voll | voll | 2 | Vollbild-Blatt |
| Yarn Count | `/tools/yarn-count` | voll | voll | 2 | eine Spalte, Zahlen-Tastatur (`inputmode="decimal"`) |
| Jet Advisor | `/tools/jet-advisor` | voll | abgespeckt | 2 | Formular als Blatt, Rangliste als Karten (Düse, Einstellung, Chance); Details aufklappen |
| DTY/ATY-YarnScope | Reiter in Show Experiment | voll | lesend | 3 | gespeicherte/berechnete Ansichten untereinander (Plotly passt Breite an), Garnspiegel waagrecht scrollbar; Prozessvergleich/Batch Tablet+ |
| Manage Jets / Yarn / Stammtabellen / Projekte | `/admin/…` | voll | abgespeckt | 3 | Liste mit Suche → Detailformular pro Zeile (statt breiter Tabelle), Speichern unten; neue Düse/Garn ja; Spaltenreihenfolge/Mehrfachkopie Tablet+ |
| Manage User | `/superuser/users` | voll | abgespeckt | 3 | Liste → Detail; Access-Matrix Tablet+ |
| Papierkorb | `/superuser/recycle-bin` | voll | voll | 3 | Kartenliste, Aktionen über „⋯“ mit Bestätigung |
| Dashboards | `/tools/dashboards` | voll | lesend | 3 | Visuals untereinander (Desktop-Fläche im iframe, Breite anpassen) |
| Smart Chart (Editor) | `/tools/smart-chart` | abgespeckt | lesend | 3 | Tablet: Bearbeiten ohne Ziehen-zum-Vergrössern (Feldliste als Blatt); Handy: gespeicherte Ansicht öffnen + Filter, kein Editor |
| Jet ROI | `/tools/jet-roi` | voll | abgespeckt | 3 | Einzelrechnung voll, Mehrfach als Karten, PDF ja |
| Process Playground | `/tools/process-playground` | voll | abgespeckt | 3 | Regler untereinander, Diagramm darüber |
| Requirement Hub / Quick Scan | `/tools/requirement-hub…` | voll | abgespeckt | 3 | Regeln als Liste, Ergebnis als Karten; Regelsatz bearbeiten Tablet+ |
| TDMS Inspector | `/tools/tdms-inspector` | voll | lesend | 3 | Upload ja (Datei-Auswahl), Ansicht wie YarnScope lesend |
| Image Compare | `/tools/image-compare` | abgespeckt | lesend | 3 | Tablet: 1–2 Felder, Zeichnen mit Finger/Stift, Zoom mit zwei Fingern; Handy: Bilder nebeneinander/übereinander ansehen |
| Canvas | `/tools/canvas` | abgespeckt | lesend | 3 | Tablet: Stift/Finger, Zwei-Finger-Zoom/Pan; Handy: Brett ansehen + zoomen |
| Label Generator | `/tools/label-generator` | abgespeckt | lesend | 3 | Tablet: Elemente als Liste + Eigenschaften-Blatt, Drucken ja; Handy: Vorschau + Drucken eines gespeicherten Entwurfs |
| Air Supply | `/tools/air-supply` | abgespeckt | lesend | 3 | Tablet: Editor mit Touch (Ziehen, langes Drücken = Menü); Handy: gespeichertes Netz + Ergebnistabelle ansehen |

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
| Grundgerüst | ✅ 2026-11-18: `responsive.css`, `media.ts` (`useMedia`, `PHONE`/`TABLET`/`TOUCH`, langes Drücken = `contextmenu` für iOS), Kopfzeile ☰ + Seitentitel + Suche, Seitenleiste als Schublade (Tablet ≤ 1024 px von links; Handy < 600 px klappt sie unter der Kopfzeile nach unten auf, volle Breite, ☰ wird ✕ - Nutzerwunsch; schliesst bei Seitenwechsel/Esc/Tippen daneben), Dialoge auf dem Handy als Vollbild-Blatt mit ✕ (`.m-x` in `Modal` und Schnellsuche), Touch-Grössen. Offen daraus: Tooltips per Antippen, Speicherleiste unten |
| Touch-Öffnen | ✅ 2026-11-18: einmal Antippen öffnet Backlog-Karten/Archiv, All Experiments, My Requests (`isTouch`, `tapOnControl`); Backlog auf dem Handy scrollt als Seite |
| Show Experiment | 🟡 2026-11-18 (Nutzerwunsch: Tabelle im Vordergrund, Rest wegklappbar): bis 1024 px Titelzeile ← / Serienname / „Details ▾“; zugeklappt sind Kopf, Notizen, Ansichtsleiste (Plies/Gruppen/Kompakt, Werkzeuge), Schema und Bearbeitungs-Hinweis weg, die Speicherleiste erscheint nur bei Ungespeichertem/Meldung; Reiter einzeilig zum Wischen; Handy: schmalere Zeilentitel. Zelle antippen = bearbeiten (Zahlentastatur bei Zahlen). Handy: ein Versuch auf einmal - Leiste ◀ Auswahl n/N ▶ + „Alle Versuche“, Wischen über die Tabelle wechselt (Maschinendaten/R&D über `MachineTable onlyTrial`, Labor-Reiter in `SeriesBody`) |
| Report | ✅ 2026-11-18 (Nutzerwunsch): Fenster ≤ 1024 px (Body-Klasse `m-small` aus der Fensterbreite der Web-App, nicht der iframe-Breite - am PC ist der iframe neben der Seitenleiste schmal): Visuals untereinander in voller Breite; oberer Teil (Werkzeugleiste, Serien-Info) und die Einstellzeilen jeder Diagrammkarte hinter „Optionen ▾“ weggeklappt (alles in `backend/app/static/web_bridge.js`, Desktop-Vorlage unverändert); Kopf der Report-Seite einzeilig |
| Dashboards | ✅ 2026-11-18 (Nutzerwunsch: nichts neben dem Dashboard): Liste als Auswahl „Name ▾“ über der Fläche (+ PDF), Visuals untereinander in Lesereihenfolge (Slicer/KPI so hoch wie der Inhalt), Filterbereich hinter „Filter ▾“ als Vollbild (`smart_bridge.js`, nur Nur-lesen-Ansicht) |
| Prio 1 sonst | offen (Backlog-Spalten als Reiter, Yarn Stock, Inventur) |
