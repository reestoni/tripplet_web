# TrippleT Web – Hinweise für Claude Code

Web-Version der TrippleT-Desktop-App (`C:\python\tripplet_project`), gestartet 2026-11-13.
Läuft **parallel** zur Desktop-App auf **derselben MySQL-Datenbank**.

## Sprache

- Zusammenarbeit mit dem Nutzer auf **Deutsch**.
- **Die Web-App ist viersprachig: EN / DE / ES / ZH** (Nutzerwunsch 2026-11-13, anders als die
  Desktop-App). Umschalten per Flaggen auf der Login-Seite und unten in der Seitenleiste
  (`LangFlags` in `src/i18n.tsx`, Wahl in localStorage `tripplet.lang`, sonst Browsersprache).
  **Jeder sichtbare Text** steht in `frontend/src/texts.ts` (`en` definiert die Schlüssel, die
  anderen Sprachen sind dagegen typisiert → fehlender Schlüssel = Build-Fehler) und wird mit
  `t("key", {vars})` aus `useI18n()` geholt – nie Text hart in Komponenten schreiben.
  Das Backend schickt für Meldungen **Codes** (`{"code": ..., "detail": <englisch>}`), die Seite
  übersetzt `<bereich>.err.<code>`. Navigation wird über die Route übersetzt (`nav.<route>`,
  `sec.<Sektion>`), Backlog-Status über die ID (`status.<id>`). Daten aus der DB (Serien-,
  Maschinen-, Garnnamen) werden nicht übersetzt.
- "Backlog" heisst auch auf Deutsch (und Spanisch) "Backlog" (Nutzerentscheid); Chinesisch 待办.

## Rahmen (Nutzerentscheide 2026-11-13)

- **Ziel-Betrieb: Server im Firmennetz (Intranet), nie im Internet.** IT erst für diesen
  späteren Schritt nötig (VM, HTTPS, evtl. Firmen-Login).
- **Phase 1: nur der Nutzer selbst, nur `dev_local`, Server nur auf 127.0.0.1.**
  `backend/app/core.py` verweigert den Start mit jedem anderen `TRIPPLET_MODE`
  (`ALLOWED_MODES`). Erweiterung auf dev/prod nur auf ausdrückliche Freigabe.
- **Logik wird NICHT kopiert.** Das Backend importiert `db/` und die Qt-freien
  Logik-Module direkt aus `tripplet_project` (`TRIPPLET_CORE_PATH`, Default
  `C:\python\tripplet_project`). Steckt benötigte Logik noch in einem Qt-Screen, wird sie
  **dort** in ein Qt-freies Modul gezogen (Desktop nutzt es dann auch), nie hier nachgebaut.
  Bisher so herausgezogen: `db/nav_counts.py` (Badges), `db/user_profile.py` (Login-Profil),
  `feature_access.rules_for()` (Rechte für beliebigen Benutzer), `db/experiment_create.py`
  (Create Experiment / Add Trial Series / Add Lab Machines, 2026-11-13).
  Alle Regeln der Desktop-`CLAUDE.md` zu Schreibpfaden gelten auch hier (Änderungsprotokoll,
  `dy_ratio`, Papierkorb, Plausibilität, `exclude_references_sql`, `execute_insert` …).
- Offline-Modus (SQLite) gibt es im Web nicht (offen, ob je nötig).

## Aufbau

- `backend/` – FastAPI. `app/core.py` (zuerst importieren: Modus-Sperre, sys.path, Benutzer-Proxy),
  `app/user_context.py` (**`app_meta.current_user` ist hier ein Proxy auf eine ContextVar** –
  die Core-Module sehen so den Benutzer *ihrer* Anfrage; nie global setzen, sondern
  `user_context.set_user()`/`reset()`), `app/auth.py` (Login = gleiche Prüfungen wie
  `ui/screen_login.py`, signiertes Session-Cookie (itsdangerous, 12 h), Schlüssel in
  `%LOCALAPPDATA%\TrippleT\web_secret.key`, Profil pro Anfrage aus der DB mit 60-s-Cache,
  `SessionMiddleware` = reines ASGI), `app/nav.py` (Seitenleiste als Daten, Reihenfolge wie
  `sidebar_nav.install_full_sidebar`, Rechte nur über `db/feature_access.py`; `WEB_READY` =
  Routen, die im Web schon gehen – alle anderen zeigen "Not in the web version yet"),
  `app/deps.py` (`current_user`, `require_feature(key)` = gleiche Regel wie Desktop-Feature-Guards – jede neue Route damit schützen), `app/series_lists.py` (`/api/experiments`, `/api/backlog`),
  `app/main.py` (Routen unter `/api/…`, Bilder `/api/img/<name>` direkt aus
  `tripplet_project/assets/images`, gebautes Frontend aus `frontend/dist` mit SPA-Fallback).
- `frontend/` – React + TypeScript + Vite (React Router). `src/api.ts` (fetch-Wrapper, Typen),
  `src/components/Shell.tsx` (Seitenleiste), `src/pages/*`. Farben aus `ui/theme.py` als
  CSS-Variablen in `src/styles.css` (`--accent` = `tblUser.AccentColour`).
  Für die grossen Pivot-Tabellen (Show Experiment) ist AG Grid vorgesehen.

## Ausführen

- Python: `C:\Users\soj\AppData\Local\Programs\Python\Python312\python.exe` (hat FastAPI etc.).
- Entwicklung: `start_dev.ps1` (FastAPI mit Reload auf :8000 + Vite auf :5173, Browser öffnet sich).
- Gebaute Version: `start.ps1` (ein Prozess, http://127.0.0.1:8000).
- Tests Backend: im Ordner `backend/` `python -m pytest` (gegen dev_local; `test_move_real_roundtrip_restores` schreibt echt und stellt danach wieder her).
- Läuft `start_dev.ps1` beim Nutzer, belegt es Port 8000/5173 – für eigene Tests einen anderen Port nehmen (z. B. 8001), nicht seinen Server beenden. Der `--reload` lädt Backend-Änderungen nicht immer zuverlässig neu → nach Backend-Änderungen dem Nutzer Neustart empfehlen.
- Frontend prüfen: im Ordner `frontend/` `npm run build` (Typecheck + Build).
- API-Doku: http://127.0.0.1:8000/api/docs

## Reihenfolge (aus tblUsageLog prod, 90 Tage, Stand 2026-11-13)

Meistgenutzt: Show Experiment (3136 Öffnungen / 7 Benutzer), Backlog (2437/7), Bulk Edit
"fill range" (890/4), Report (869/7), All Experiments (649/6), DTY YarnScope (478/5),
Create Experiment (313/5), Manage Jets (265/6), Manage Yarn (240/5), Yarn Stock (138/6),
My Requests (137/5), Create Experiment Request (87/4). Wenig: Image Compare, TDMS, Canvas,
Label Generator, Jet ROI, Air Supply, Lab Assistant (< 50).

1. ✅ Fundament: Login, Rechte, Seitenleiste, Startskripte (2026-11-13)
2. ✅ All Experiments + Backlog (2026-11-13; Backlog-Karten per Drag & Drop verschiebbar = `POST /api/backlog/move`, Regeln aus `db/backlog_moves.py`, Joker-Maschine fragt per Dialog; noch offen: Prio, Mehrfachauswahl, Kontextmenüs, ER-Popup, Report-Symbol, Status in All Experiments) – offen: Show Experiment **nur lesend**
2b. 🟡 Show Experiment nur lesend (`/series/:id`, `app/series_view.py`, Seite `SeriesView.tsx`, 2026-11-13):
   Kopf, Versuchsspalten (Referenzen amber), Labor-Reiter aus `db/series_tables.LAB_TABS` mit Info-Zeilen
   Jet/Jet Plate/Air Pressure, rot/orange Markierungen, Retest-Punkt; Zeilen-/Reiternamen übersetzt
   (`row.<Desktop-Titel>`, `tab.<key>`). Machine Data seit 2026-11-13: `GET /api/series/{id}/machine?mode=single|compact|groups`
   aus `db/machine_data.py` (`display_text`, `hidden_columns`; Custom-Group- und ungenutzte DTY-Verfahrenszeilen
   ausgeblendet wie im Desktop; Feldnamen aus `tblMachineFields` bleiben bewusst unübersetzt = sprachunabhängig, Nutzerentscheid 2026-11-13; übersetzt nur die festen Zeilen über `row.<Titel>`),
   Komponente `MachineTable.tsx`. Alle Labor-Reiter aus `LAB_TABS` (auch Itemat Lab/Plus, DTYoMat, ATYoMat);
   Düsen-Luftverbrauch lazy: `GET /api/series/{id}/jet-air?unit=Nm3h|lmin` (`JetAirView.tsx`, drei Tabellen).
   Gegen Desktop-Modelle geprüft (alle Reiter, 0 Abweichungen). Dazu (2026-11-13): R&D (`/rd`, gleiche Tabelle),
   Notizen an Werten + Reiter "Notizen", Anhänge (`/attachments`), **DTY-YarnScope** (`app/yarnscope.py` +
   `YarnScopeView.tsx`): Berechnung = `ui/yarnscope/dty_service.py`, Analysen im Speicher (`CACHE_SIZE`, Schlüssel
   Versuch+Datei+Zeit), Ansichten Segmentmittel/Signal (Plotly, lokal aus /report-assets) und Garnspiegel (Canvas),
   "In DB speichern" ab Zugriffsstufe 2 über `svc.save_analysis`. Seit 2026-11-13 auch die drei Trendlinien
   (Mitte Offenstelle–Knoten, Mitte Peak–Tal, Offenstellen-Trend; Rollung Meter/Paare) mit Kennzahlen-Karten und die
   Prozesswelle (Raster, Prozessmittel + Sinus-Fit + Karte): `GET …/segment?open_knot=Meter:1&peak_valley=Paare:10&
   opening=…&wave=0.05` -> `segment_view(..., with_metrics=True)`; Fenster frei 0.1–100 m. **Prozessvergleich**
   (`YarnScopeCompare.tsx`, Knopf in der Versuchsliste): `POST …/yarnscope/compare` {trial_ids 2–6, bin = Raster der
   Prozesswelle, Anzeige-Optionen} -> `run_process_comparison` (analysierte Versuche aus dem Cache, sonst TDMS lesen) +
   `comparison_json`; das Ergebnis bleibt im Server (`_compare_cache`), Optionen zeichnen nur neu; 👁 blendet im Browser aus.
   Tests ohne H: über künstliche Signale (`tests/test_yarnscope.py`). **ATY-YarnScope** (seit 2026-11-13, Reiter
   "YarnScope ATY" wenn `aty_service.series_has_tdms`): `app/yarnscope_aty.py` (`/api/series/{id}/aty…`) auf
   `ui/yarnscope/aty_service.py` + `thickness_classes.py` (eine frühere Sitzung hat beides Qt-frei herausgezogen,
   Desktop-Tab und -Batch nutzen es); Frontend `YarnScopeAty.tsx`: Verteilung (Plotly), Garnspiegel/Gewebe/Gestrick
   (Canvas, schwarz wie im Desktop; Klassen-Farben + Sichtbarkeit im Browser, localStorage `tripplet.aty.*`),
   Vergleich (Haken in der Liste; Radar, 3 Tabellen, Signal & Kern, Histogramme), Speichern = Kern-Analyse ab Stufe 2,
   Batch über `YarnScopeBatch kind="aty"`. Englisch bleiben: Radar-Sätze und Tabellenköpfe des Vergleichs (aus dem
   Desktop-Modul). Tests `tests/test_yarnscope_aty.py` (künstliche ATY-Signale, DB-Schreiben ersetzt). Noch offen: Athena.
3. ✅ Experiment Requests (2026-11-13): `app/requests_api.py` (`/api/requests…`) auf `db/experiment_requests.py` +
   `db/experiment_request_images.py`; Seiten `MyRequests.tsx` (Liste, Filter, Status für Superuser mit
   Begründung/Bestätigung über `StatusDialog`) und `RequestForm.tsx` (neu/bearbeiten aus dem Formular-Schema,
   Pflichtfelder, Änderungsvorschlag prüfen = annehmen/ablehnen, Bilder). Abweichung zum Desktop (bewusst):
   Bilder erst nach dem ersten Speichern - der Desktop legt dafür einen Entwurf an, der beim nächsten Login
   samt Bildern gelöscht wird (Fehler im Desktop, siehe Commit). Feldnamen übersetzt über `rqf.<DB-Spalte>`,
   Status über `rqs.<id>`. Dazu (2026-11-13): ER-Popup nur lesend (`RequestPopup.tsx`, `GET /api/requests/{id}/view`,
   Sichtbarkeit `experiment_requests.can_view`) aus All Experiments, Backlog, Show Experiment und Report;
   Versionsverlauf + Vergleich (`/versions`, `/versions/{alt}/compare`); Experiment zuordnen (Superuser);
   `links_router`: `/api/series/{id}/request`, `/api/series/{id}/reports` (RE-Symbol, `SeriesLinks.tsx`),
   `/api/experiment-series` (Experiment ID -> Serie, Auswahl bei mehreren); Hilfe "Wie funktionieren Requests"
   (`RequestHelp.tsx`). Tests `tests/test_request_links.py`.
4. 🟡 Show Experiment bearbeiten (Undo, Bulk Edit = "Fill row", Notizen, Plausibilität – erledigt, siehe unten);
   ✅ Create Experiment, Add Trial Series, Add Lab Machines (2026-11-13): eine Seite `CreateExperiment.tsx` mit
   `mode` create | addseries | addlab (Routen `/experiments/new`, `/series/new`, `/lab-machines/new`; Reiter wie im
   Desktop mit Haken; `?request=`, `?experiment=`, `?series=`, `?copy=<Serie>` = "Copy TrialSeries" aus dem
   Rechtsklick-Menü). Backend `app/create_api.py` (`/api/create/…`, Rechte = Feature-Keys new_experiment /
   add_series / add_lab_machines) auf `db/experiment_create.py` (aus `ui/screen_create_experiment.py` gezogen,
   Desktop nutzt es jetzt auch: Listen, Ply-Regel `ply_label_for`/`renumber_plies`, Labor-"+" `plan_lab_entries`
   inkl. Itemat-0.0-Grundwert, `create()`/`add_lab_machines()`); Versuche schreibt für alle Wege
   `trial_actions.insert_trials`. Der Browser schickt nur IDs/Werte; Labortabellen und Maschinenfelder nimmt der
   Server aus seinen Katalogen. Meldungen der Regeln als `experiment_create.Message` (Text + `code` + `vars`).
   Bewusst anders als der Desktop: Ply-Neunummerierung nach Löschen folgt der Regel (Desktop zählte stur 1..n,
   jetzt auch dort korrigiert); Legacy-Import verweigert eine schon vorhandene Experiment-ID (`legacy_id_taken`,
   Desktop legte still ein Duplikat an - jetzt auch dort gesperrt). Seit 2026-11-13 ausserdem: **Legacy-Import**
   (`/experiments/legacy`, Strg+Umschalt+J auf Neues Experiment wie der versteckte Desktop-Knopf, Recht =
   new_experiment), **Add trials** (`/series/:id/add-trials`, Knopf "+T" in Show Experiment, Recht =
   `trial_actions.can_edit_trials`; Experiment/Serie/Maschine fest, Labormaschinen der Serie vorbelegt, Ply-Regel
   mit Offset + Serie = `addtrials_setup()`, Schreiben `trial_actions.add_trials`), **"+ Versuch"**
   (Halbfabrikat-Ply: Suche `search_trials`, Garn `get_or_create_shadow_yarn` - beide jetzt in
   `db/experiment_create.py`; eine Serie mit daraus entstandenen Garnen sperrt der Papierkorb),
   **Lagerplätze** per Klick aufs Spulen-Symbol (`/api/create/stock/<garn>`; `load_spools_in_stock`,
   `location_sort_key`, `tube_colour_candidates` jetzt in `db/yarn_spools.py`) und **Drag & Drop** der Düsenzeilen.
   Noch offen: "Open in Yarn Stock" im Lagerplatz-Dialog (Yarn Stock gibt es im Web noch nicht).
   Tests `tests/test_create_api.py` (Durchlauf schreibt echt und räumt per Papierkorb wieder ab).
5. Bereits Web-nahes: Knowledge Base, Hilfen, Yarn Count, Dashboards/Report
6. Tools später oder bewusst Desktop-only

**Bearbeiten in Show Experiment** (2026-11-13): `app/series_edit.py` `POST /api/series/{id}/save`
{edits:[{tab,r,c,value}], mode, unit, confirmed}. Der Browser schickt NUR Ort (Reiter, Datenzeile, Datenspalte)
und Wert; der Server baut den Reiter neu und nimmt die Bindung selbst (nie Tabelle/Feld vom Client),
`series_save.normalize_input` (Housing/Jet = ID), `plausibility.check` -> `{kind:"confirm", warnings}` bis
`confirmed`, dann `series_save.save_series_edits` (Änderungsprotokoll, DY-Ratio, Zeitstempel, Itemat).
Ab Zugriffsstufe 2. Frontend `src/edit.tsx` (`EditProvider` pro Serie mit `key={id}`, `EditCell`; gelb =
ungespeichert, Strg+S, Strg+Z, Warnung beim Verlassen); Ansicht/Einheit sind gesperrt, solange in Machine
Data/Jet Air Ungespeichertes liegt (Zeilen-/Spaltennummern gelten pro Ansicht).

**Hilfe** (2026-11-13): `backend/app/help.py` (`/api/help/screen/<screen>` = Kontext-Hilfe aller Sprachen aus den
Desktop-Textmodulen `ui/widgets/help_texts_*.py` als Bausteine, Skizzen als data-URL; `/api/help/search` = Suche aus
`ui/help_index` inkl. Knowledge-Base-Treffern mit Web-Route und `web_ready`; `/api/help/log` = die Desktop-Events
`help_search_open/_noclick/_noresult`, `help_feedback_up/_down` (Usage Stats -> Help)). **"Ask AI" / "KI fragen"
gibt es im Web bewusst nicht** (Nutzerentscheid 2026-11-13: überall weglassen - auch nicht später ungefragt
einbauen; `tests/test_help.py` prüft, dass es keinen KI-Weg gibt). Frontend `src/components/Help.tsx`:
`HelpHost` im Shell (F1 überall, Seitenleisten-Eintrag "Hilfe (F1)" öffnet die Suche statt einer Seite),
`HelpButton screen=...` (runder "?") auf All Experiments, Backlog, Show Experiment, Report, Create Experiment.
Hilfetexte gibt es nur EN/DE/ES (Desktop-Entscheid): eigene Flaggen im Dialog, Sprache in localStorage
`tripplet.helpLang`, Chinesisch -> Englisch; die Fensterbeschriftung kommt aus `texts.ts` (`help.*`, 4 Sprachen).
Neue Seite mit Desktop-Hilfe: `HelpButton` einbauen und Route in `help.WEB_ROUTES` eintragen. Tests `tests/test_help.py`.

## Offene Punkte

- **Nächste Schritte in dieser Reihenfolge** (Nutzerentscheid 2026-11-13): 1. ✅ F1-Hilfe / Kontext-Hilfe (ohne Ask AI)
  (siehe "Hilfe" unten), 2. ✅ YarnScope ergänzen (Trends/Prozesswelle, Prozessvergleich, ATY + Batch), 3. Manage Jets,
  Manage Yarn, Yarn Stock. **Kleinkram für später** (nicht vergessen): "Open in Yarn Stock" im Lagerplatz-Dialog
  von Create Experiment (sobald Yarn Stock im Web ist), "?"-Knopf auf weiteren Seiten, sobald sie ins Web
  kommen (Manage Yarn/Jets, Yarn Stock, Dashboards, Smart Chart, Process Playground), weitere PARTIAL/MISSING-Zeilen in `PARITY.md`.

- **YarnScope (DTY/ATY) muss ins Web** (Nutzerentscheid 2026-11-13, "schon ziemlich wichtig"): Berechnungen
  Qt-frei teilen, Server rechnet + schickt ausgedünnte Kurven, Plotly zeichnet, Garngraf im Browser neu aus
  Server-Daten. Zuerst DTY, dann ATY. TDMS liegen auf `H:\Technik\TrippleT\YarnScopeTDMS` bzw. `...\ATYtdms`
  (auf dem PC des Nutzers erreichbar).
- **Liste für die IT (späterer Intranet-Server):** VM/Server mit HTTPS; Lesezugriff des Dienstkontos auf die
  Freigaben für YarnScope-TDMS und Serien-Anhänge (Bilder/PDFs, `\\heb-fil-003\heberlein\technik\tripplet\...`
  = `H:\Technik\TrippleT\...`); evtl. Firmen-Login.

- Passwort ändern gibt es im Web noch nicht (Login mit Passwort = Benutzername wird mit
  Hinweis auf die Desktop-App abgewiesen).
- Beim Desktop-Login laufen zusätzlich Draft-Request-Bereinigung und Athena-Token-Reset –
  im Web noch nicht (erst relevant mit Experiment Requests bzw. KI-Funktionen).
