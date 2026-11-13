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
  (Create Experiment / Add Trial Series / Add Lab Machines, 2026-11-13), `db/jets_admin.py` (Manage Jets / New Jet, 2026-11-13), `db/yarn_admin.py` (Manage Yarn / New Yarn, 2026-11-13), `db/yarn_stock.py` (Yarn Stock, 2026-11-13), `db/user_admin.py` (Manage User, 2026-11-13), `ui/process_playground_core.py`, `db/quick_scan.py` (2026-11-13).
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
   "In Garnlager öffnen" im Lagerplatz-Dialog öffnet Yarn Stock in einem neuen Tab (seit 2026-11-13).
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

**Manage Jets** (2026-11-13): `/admin/jets`, `app/admin_jets.py` (`/api/admin/jets…`) auf `db/jets_admin.py`
(aus `main.py`/`screen_manage_jets.py`/`screen_new_jet.py` gezogen, Desktop nutzt es jetzt auch). Seite `ManageJets.tsx`
mit der wiederverwendbaren Tabelle `components/AdminTable.tsx` (eingefrorene Spalten, Filterzeile, Sortierung, FK-Dropdowns,
Bool-Häkchen, gelb = ungespeichert, Strg+S/Strg+C) - gedacht auch für Manage Yarn. Lesen = Feature `manage_jets`,
Schreiben = Admin-Karten-Recht (`jets_admin.can_edit`). Der Browser schickt Spaltennamen + Werte; der Server prüft Spalten
gegen die Tabelle, FK-IDs gegen die Stammlisten und Zahlen gegen den MySQL-Typ (`information_schema`; Tabellenname dort
als Literal, weil `db.connection` Alt-Namen wie `tblDTYJets` -> `tbljets` im SQL-Text umschreibt). Neue Düse schreibt wie
der Desktop alle Formularfelder (leer = NULL; sonst bricht der Default `JetTypeID=0` den FK). Dateien: Ablage
`jets_admin.files_root()` (dev = `C:\ttt\JetFiles`). Spaltenreihenfolge = `db/user_column_order` Schlüssel `manage_jets`
(gleich wie Desktop). Tests `tests/test_admin_jets.py` (Durchlauf schreibt echt und löscht wieder).
Ganzzahl-Spalten lehnen Kommazahlen ab (MySQL würde still runden), gilt für Jets und Yarn.

**Manage Yarn** (2026-11-13): `/admin/yarn`, `app/admin_yarn.py` (`/api/admin/yarn…`) auf `db/yarn_admin.py` (aus
`screen_manage_yarn.py`/`main.py` gezogen, Desktop nutzt es jetzt auch), Seite `ManageYarn.tsx` auf `AdminTable`.
Rechte wie Desktop: alle mit Feature `manage_yarn` bearbeiten/anlegen, MinStock nur Superuser, Löschen nur Admin-Karte.
Jede Speicherung prüft Dubletten (409 `duplicate_identical`/`duplicate_similar` -> "Trotzdem speichern?" -> erneut mit
`confirmed`). "+ Neue Farbe…" (`POST …/colour`, ähnlicher Name -> 409 `colour_similar`, dann `force`). GlobalID ist im Web
bewusst nicht änderbar. Tests `tests/test_admin_yarn.py`.

**Yarn Stock** (2026-11-13): `/tools/yarn-stock`, `app/yarn_stock_api.py` (`/api/yarn-stock…`) auf `db/yarn_stock.py` (aus
`ui/screen_yarn_stock.py` gezogen, Desktop nutzt es jetzt auch), Seite `YarnStock.tsx`: Übersicht Garn×Batch (Status pro
Garn), Spulen bearbeiten/neu/ausbuchen, Verwendet in, Verlauf (`tblYarnSpoolLog`), "Zu Spule #" (auch Scanner-QR),
Etiketten-Warteschlange + Bogen-PDF (Vorlage "Default"; PDF markiert die Warteschlange als gedruckt, wie Desktop),
Gestell-Suche, Excel-Exporte, Glocken-Meldungen beim Laden. Schreiben ab Stufe 2, MinStock nur Superuser.
`?yarn=&charge=` springt zu einer Batch ("In Garnlager öffnen" aus dem Lagerplatz-Dialog von Create Experiment, neuer Tab).
Tests `tests/test_yarn_stock.py` (Durchlauf mit Test-Batch, räumt Spulen/Log/Warteschlange ab).
**Inventur** (2026-11-13): `/tools/yarn-stock/stock-take` (Knopf "Inventur…" in der Gestell-Suche, `?rack=` = Vorgabe für
"ohne Runde"), `app/stock_take_api.py` auf `db/stock_take.py` (dazu neu Qt-frei: `move_spool`, `restock_spool`,
`discard_missing`, `tile_columns`, `export_excel_bytes`; Desktop-Dialoge nutzen sie). Seite `StockTake.tsx`: Kacheln pro
Platz, Ergebnisse, Excel; Superuser starten/schliessen Runden und lassen Plätze aus; Prüfen ab Stufe 2 (Scan-Ansicht:
Umlagern/Wieder-Einlagern sofort, Fehlende nur beim Abschluss auf Klick ausbuchen). Die Scan-Liste hält der Browser
(wie der Desktop-Dialog), den Scan-Text wertet der Server aus (`/parse`). Tests `tests/test_stock_take_api.py` (echte
Test-Runde mit Test-Spulen auf ZZ97, wird übersprungen, wenn eine echte Runde offen ist; räumt alles ab).
**Manage User** (2026-11-13, nur Superuser): `/superuser/users`, `app/user_admin_api.py` auf `db/user_admin.py` (aus
`ui/screen_manage_user.py` gezogen) + `db/feature_access.py` ("Access…"-Matrix). Passwortspalten kommen nie in die Seite;
neu/zurücksetzen = Argon2. Bewusst nicht im Web: API-Key/Tokens (KI). Strenger als Desktop: Benutzernamen eindeutig und
höchstens so lang wie die Spalte (`UserName` ist auf dev_local VARCHAR(5)!), eigenes Konto nicht löschbar.
Tests `tests/test_user_admin.py` (Test-Benutzer wird angelegt und gelöscht, Zugriffsregeln danach exakt wiederhergestellt).

**Smart Chart / Dashboards** (2026-11-13, erste Werkzeuge): `/tools/smart-chart` (`?view=<id>`), `/tools/dashboards`.
Nutzerentscheid: die Desktop-Seite `ui/smart_dashboard_html.py` (Power-BI-Editor, Plotly) wird **eingebettet**, nicht neu
gebaut - iframe `/api/smart/page?sid=…`, `backend/app/static/smart_bridge.js` ersetzt qwebchannel (Seiten-Aufrufe -> `POST
/api/smart/<sid>/call`, Antwort = "Kommandos" = Seitenfunktionen init/renderResults/setSpec/…; Dialog-Aufrufe -> postMessage
an React). Die Dashboard-Fläche bleibt dadurch Englisch wie im Desktop (bewusst); Rahmen + Dialoge (Filter, berechnetes
Feld, Farbe, Fairness, Ansicht öffnen/speichern/teilen, PDF-Frage) sind React und 4-sprachig. Logik der Qt-Brücke Qt-frei in
`ui/smart_dashboard_core.py` (`DashboardSession` + Filter-/Formel-Helfer; Desktop-Widget und -Dialoge nutzen es jetzt
auch). Backend `app/smart_chart_api.py`: eine Sitzung pro offener Seite (sid vom Browser, an den Benutzer gebunden, max 40,
6 h), Versuche einmal pro Prozess geladen, Feldwerte geteilt, berechnete Felder pro Sitzung (`_SharedCache`). Rechte:
Feature `smart_chart`; Dashboards (nur lesend) auch mit `dashboards`. Tests `tests/test_smart_chart.py` (gespeicherte
Ansicht wird angelegt und gelöscht), Desktop `tests/test_smart_dashboard_core.py`.
Verbesserungen (Nutzerentscheid 2026-11-13, beide Apps): Ergebnis-Cache pro Visual in `DashboardSession.result`
(Schlüssel = Visual ohne Lage + Filter + Klicks + Ply + Formeln; Reload leert ihn); Referenzmuster wahlweise
(`TrialDataset(include_refs=)`, Feld "Reference sample", Häkchen im Filterbereich der Seite, `refs` in der Ansicht; Web hält zwei
Versuchsbestände mit gleichem Katalog); Formelvorschau auch über die gefilterten Versuche; Formeln aus anderen Dashboards
übernehmen (`calc_library`); Ordner (`folder` in ConfigJSON) und Favoriten (`DisplaySettings.smart_favs`, `group_views`);
`ConfigJSON` MEDIUMTEXT auf dev_local per `tools/smart_chart_views_migration.py` (dev/prod noch TEXT - nur auf Freigabe,
`config_limit()` richtet sich nach der Spalte). Nur Web: ungespeicherte Änderungen (`summary.dirty`, Punkt im Titel), Entwurf
in localStorage `tripplet.smart.draft` (pro Benutzer) mit "Wiederherstellen" (`/restore`), Warnung beim Verlassen.

**Werkzeuge** (ab 2026-11-13 eins nach dem anderen, Nutzerentscheid; Reihenfolge Yarn Count, Jet ROI, Air Supply, Image
Compare, Label Generator, TDMS Inspector, Canvas, Process Playground, Requirement Hub):
- Yarn Count Converter `/tools/yarn-count`: `app/yarn_count_api.py` auf `ui/yarn_count.py` (neu `filament_values`, Desktop nutzt
  es), Seite `YarnCount.tsx`, letzte Eingabe in localStorage `tripplet.yarnCount`. Einheiten-/Materialnamen bleiben technisch (EN).
- Jet ROI Calculator `/tools/jet-roi`: `app/jet_roi_api.py` auf `ui/jet_roi.py` (Konstanten, Luftformel, Prozessfilter,
  `validate_single`/`calculate_single`/`calculate_multi`, Diagrammreihen, PDF-Berichte - aus `screen_nozzle_calculator.py`
  gezogen, Desktop rechnet jetzt darüber; Vergleich alt/neu identisch). Seite `JetRoi.tsx` (Einzel + Mehrfach, Plotly, PDF).
- Air Supply Network `/tools/air-supply`: `app/air_supply_api.py` auf `ui/air_network.py` (Physik, Node/NetworkGraph + Solver,
  Optimierer, Betriebskosten, Quellen-/Tabellen-Zusammenfassung, gespeicherte Netze tblAirNetwork*, PDF/Excel - aus
  `screen_air_supply.py` gezogen; Desktop ergänzt nur `Node.rect/center` (Qt), Ergebnisse alt/neu identisch). Das Web legt die
  Tabellen nie an (`ENSURE_TABLES = False`). Seite `AirSupply.tsx`: SVG-Editor (Ziehen auf 20er-Raster, Verbinden, Rechtsklick
  Umbenennen/Duplizieren/Löschen, Verbindung entfernen, Zoom/Verschieben, Strg+Z, Reiter), jede Änderung löst `/solve` aus.
  Knotenbeschriftungen kommen vom gemeinsamen Modul (EN).
- Image Compare `/tools/image-compare`: `app/image_compare_api.py` auf `db/image_compare.py` (Serien/Bilder/ATY-Radar) und
  `ui/doc_render.py` (VK4/PDF/Excel/Word als PIL-Bild; aus `screen_image_compare.py` gezogen, Canvas hat dieselben Helfer noch
  dupliziert). Serienbilder nur über `series_attachments.file_for_download`; lokale Dateien = Upload in einen Temp-Ordner pro
  Benutzer (1 Tag). Raster, Werkzeuge (Pfeil, Ellipse, Rechteck, Freihand, Text, Markieren, Nummer, Radierer, Verschieben),
  Farben/Dicken, Rückgängig pro Feld, Rasterlinien, ATY-Radar (verschieb-/skalierbar), Zoom/Pan, Felder tauschen per Ziehen,
  Strg+V, PNG-Export (Feld / alle), Projektdatei `.ttcompare` (Web: Serienbild per ID; lokale Pfade bleiben leer).
  Bewusst anders: Drehen per Doppelklick dreht nur die Ansicht (der Desktop schreibt das Bild auf die Freigabe zurück).
- Label Generator `/tools/label-generator`: `app/label_generator_api.py` auf `ui/label_designer.py` (Elemente, Entwürfe
  tblLabelDesign, `make_draw_cell`, Vorschau-PNG, Serien-/Versuchsdaten, Etikettenliste `build_items`; aus dem Screen gezogen)
  und `db/label_sheets.py` (Bogen "CustomLabel"). Seite `LabelGenerator.tsx`: Zeichenfläche 8 px/mm mit 10-mm-Raster/Lineal,
  Ziehen/Grösse (0.5 mm), Anker-Gruppen, Text-Teile (fest/Feld/laufende Nummer), Tabellen, Logo, Druckdialog mit Startplatz.
  Etikettengrösse wird wie im Desktop sofort ins Bogen-Template geschrieben. Das Web legt tblLabelDesign nie an.
- TDMS Inspector `/tools/tdms-inspector`: `app/tdms_inspector.py` - Upload in einen Temp-Ordner pro Benutzer (1 Tag, max 1 GB),
  die Datei bekommt eine NEGATIVE Seriennummer; `app/yarnscope.py`/`yarnscope_aty.py` beantworten solche Nummern mit einem
  Pseudo-Versuch 0 (Analyse ohne TrialID, nur für den hochladenden Benutzer); Speichern/Batch/Vergleich verweigert (`inspector`).
  Seite `TdmsInspector.tsx` nutzt `YarnScopeView`/`YarnScopeAty` mit `inspector` (blendet Batch/Vergleich/Speichern aus).
  Desktop unverändert (der Screen war schon nur eine Hülle um die YarnScope-Reiter).
- Canvas `/tools/canvas`: Seite `Canvas.tsx` (eine Zeichenfläche, Bilder/PDF-Seiten verschieben, Strg+Mausrad skaliert ein Bild,
  Doppelklick dreht/rastet 90°, Werkzeuge/Farben/Undo wie Bildvergleich - `drawAnno` usw. aus `ImageCompare.tsx` exportiert,
  Hintergrundfarbe, Raster, PNG-Export, `.ttcanvas`-Projekt). Backend = Routen von `image_compare_api.py` (für Features
  image_compare ODER canvas) + `/canvas-series` und PDFs der Serie. Desktop: `screen_canvas.py` nutzt jetzt `ui/doc_render.py`
  und `db/image_compare.py` (`fetch_canvas_series_groups`, `fetch_pdfs_for_series`) statt eigener Kopien (-570 Zeilen).
  Drehung im Web um die Bildmitte (Desktop um die linke obere Ecke).
- Process Playground `/tools/process-playground` (`?trial=` = Rechtsklick "V<n> in der Prozess-Spielwiese öffnen" in Show
  Experiment, nur DTY-Maschinen, Flag `playground` in `/api/series/{id}`): `app/process_playground_api.py` auf `ui/dty_whatif.py` +
  neu `ui/process_playground_core.py` (Kombinationsliste, Startpunkte, Reglerbereiche, `new_settings`, Aussagen/Grundlage,
  Warnungen als Codes, Vorschläge, Diagrammdaten, `trial_start`, `series_is_dty`; Desktop-Screen nutzt es). Versuche einmal pro
  Prozess geladen (Neu laden/F5), Modell-Fits pro Kombination gecacht. Seite `ProcessPlayground.tsx` (Plotly). Aussagen,
  "Grundlage", Start-Hinweise und die Vorschlags-Meldung kommen englisch aus dem gemeinsamen Modul.
- Requirement Hub `/tools/requirement-hub` (Karte) + Quick Scan `/tools/requirement-hub/quick-scan` (`QuickScan.tsx`, beide
  Seiten in einer Datei): `app/quick_scan_api.py` (`/api/quick-scan/…`, Feature requirement_hub) auf neu `db/quick_scan.py`
  (aus `ui/screen_quick_scan.py` gezogen: Felder, Lookup-Optionen, Ad-hoc-Felder, `QuickScanEvaluator`, Score, Regelsätze;
  Desktop nutzt es). **Sicherheit:** Tabellen-/Spaltennamen landen im SQL-Text - der Browser schickt nur Feld-Referenzen
  (`field_id` oder Ad-hoc Tabelle+Spalte), `quick_scan.resolve_field` prüft gegen Whitelist + information_schema.
  Kein Athena-Berater (keine KI im Web). Korrigiert in beiden Apps: geladene Regelsätze behalten ihre Reihenfolge
  (gewichtete Regeln tragen die Richtung in sort_order = n*10+Code); Lookup-Auswahlen werden ohne Werte gespeichert
  (Desktop brach das Speichern ab).

**Admin-Stammtabellen** (2026-11-13): Order Type `/admin/order-types`, Product Groups `/admin/product-groups`, Material
`/admin/material`, Top Plates `/admin/top-plates` - eine Seite `ManageMaster.tsx` (`kind`) auf `AdminTable`, Backend
`app/admin_master.py` (`/api/admin/master/<kind>…`) auf neu `db/master_tables.py` (aus den drei Desktop-Screens und den
Top-Plate-Funktionen in `main.py`/`screen_new_top_plate.py` gezogen, Desktop nutzt es). Lesen = Feature der Tabelle, Schreiben =
Admin-Karte. Material: "In Garn verwendet" klappt die Garne auf; Top Plates: Neu/Kopieren mit eindeutigem Namen, Dateien (die
Dateiliste `JetFiles` aus `ManageJets.tsx` mit `base`). Korrigiert in beiden Apps: "New" ohne AUTO_INCREMENT auf der ID
(dev_local `tblBestellungstyp`) vergibt MAX+1 statt abzubrechen. Tests `tests/test_admin_master.py`.

**Superuser: Papierkorb** (2026-11-13): Papierkorb
`/superuser/recycle-bin` (`RecycleBin.tsx`) über `app/recycle_bin_api.py` auf `db/recycle_bin.py` (neu `preview_start`/`preview_back`/
`preview_delete`, auch von `ui/recycle_preview.py` genutzt): Wiederherstellen, endgültig löschen, Vorschau = Serie vorübergehend
zurück, Show Experiment nur lesend mit Banner (`recycle_preview` in `/api/series/{id}`, nur für den Superuser, der sie geöffnet hat):
endgültig wiederherstellen / zurück (Originaldatum) / endgültig löschen; Seite verlassen = zurück (wie Tab schliessen). Offene
Vorschauen leben im Serverprozess - nach einem Neustart bleibt die Serie einfach wiederhergestellt (wie Absturz im Desktop).
**Lab Assistant** (KI-Chat, keine KI im Web) und **Usage Stats** (Nutzerentscheid 2026-11-13: im Web nicht nötig) sind bewusst
nicht im Web und fehlen in der Seitenleiste wie Offline Sync. Tests `tests/test_recycle_bin_api.py` (echte Testserie, wird endgültig gelöscht).

**Seitenleiste: Glocke, Suche, Zuletzt geöffnet, Seitenprotokoll** (2026-11-13): Glocke im Seitenleisten-Fuss
(`components/Notifications.tsx`, `app/notifications_api.py` auf `ui/notifications.py`; nur eigene Meldungen, Zähler alle 2 min,
bei Fokus und nach Yarn-Stock-Laden über das Ereignis `tripplet:bell`). Schnellsuche Strg+F / "Suche" (`components/QuickSearch.tsx`,
`app/search_api.py` auf `db/quick_search.py`). "Zuletzt geöffnet" = dieselbe Liste wie im Desktop (`DisplaySettings.recent_series`,
`push_recent`; Show Experiment meldet `POST /api/recent`, nicht bei Papierkorb-Vorschau). `ScreenLog` schreibt pro Seitenaufruf
`screen_open` mit dem Desktop-Klassennamen (die Desktop-Usage-Stats zählen beide Apps zusammen; Zuordnung `SCREENS` in `QuickSearch.tsx`).

**Fresh off the Spool** (2026-11-13): `components/WhatsNew.tsx` (🧵 im Seitenleisten-Fuss, öffnet sich nach dem Login einmal von
selbst, wenn die neueste Version ungesehen ist), `app/whats_new_api.py` auf `ui/whats_new_data.py` + `ui/widgets/whats_new_texts.py`
(EN/DE/ES, Flaggen wie die Hilfe, Chinesisch -> Englisch). "Gesehen" = `DisplaySettings.whats_new_seen` wie im Desktop. Skizzen über
`/api/whats-new/sketch/<name>`. Kein PDF-Knopf (Browser-Druck).

**Einstellungen** (2026-11-13): `/settings` (⚙ im Seitenleisten-Fuss), `app/settings_api.py` auf `db/user_account.py` +
`db/display_settings.py` - gleiche gespeicherte Werte wie der Desktop (Begrüssung, Startbildschirm, Akzentfarbe,
`tblUser.DisplaySettings`). Tabellen-Optionen in `src/display.tsx` (`DisplayProvider` aus `/api/me` -> `display`): Kontrast,
Fadenkreuz + Lesezeile (folgen dem Ereignis `tripplet:cell-focus` aus `edit.tsx`), Warnsymbole, Farbenblind-Farben,
Tabellen-Zoom Strg+Mausrad (`--tscale`, still gespeichert über `/api/settings/prefs`). Textgrösse = Browser-Zoom (bewusst,
CSS-Zoom der ganzen Seite verschiebt Kontextmenüs). Passwort ändern (`/api/settings/password`) und Pflicht-Wechsel beim
Login, wenn Passwort = Benutzername (`/api/auth/initial-password`, danach angemeldet). Tests `tests/test_settings.py`
(nur auf einem Test-Benutzer, der angelegt und gelöscht wird).

**Yarn-Stock-Hilfe** (2026-11-13): eigenes Desktop-Format (`ui/widgets/yarn_stock_help_dialog.py` + `yarn_stock_help_texts.py`)
-> `help._yarn_stock_help()` baut daraus Reiter/Bausteine für den normalen Hilfe-Dialog (`EXTRA_HELP`); "?" auf Yarn Stock,
Inventur springt auf Reiter `stocktake`. Knopfnamen in den Texten bleiben die englischen des Desktops.

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
  (siehe "Hilfe" unten), 2. ✅ YarnScope ergänzen (Trends/Prozesswelle, Prozessvergleich, ATY + Batch), 3. ✅ Manage Jets, ✅ Manage Yarn, ✅ Yarn Stock + Inventur + Hilfe (siehe unten). Danach (Nutzerentscheid
  2026-11-13): ✅ PARITY aufgeräumt, ✅ Lücken Backlog/All Experiments/Show Experiment, ✅ Manage User, ✅ Settings, dann
  nacheinander die Werkzeuge (✅ alle, zuletzt Process Playground und Requirement Hub, 2026-11-13). **Kleinkram für später** (nicht vergessen): "?"-Knopf auf weiteren
  Seiten, sobald sie ins Web kommen (Dashboards, Smart Chart, Process Playground), weitere PARTIAL/MISSING-Zeilen in `PARITY.md`.

- **YarnScope (DTY/ATY) muss ins Web** (Nutzerentscheid 2026-11-13, "schon ziemlich wichtig"): Berechnungen
  Qt-frei teilen, Server rechnet + schickt ausgedünnte Kurven, Plotly zeichnet, Garngraf im Browser neu aus
  Server-Daten. Zuerst DTY, dann ATY. TDMS liegen auf `H:\Technik\TrippleT\YarnScopeTDMS` bzw. `...\ATYtdms`
  (auf dem PC des Nutzers erreichbar).
- **Liste für die IT (späterer Intranet-Server):** VM/Server mit HTTPS; Lesezugriff des Dienstkontos auf die
  Freigaben für YarnScope-TDMS und Serien-Anhänge (Bilder/PDFs, `\\heb-fil-003\heberlein\technik\tripplet\...`
  = `H:\Technik\TrippleT\...`); evtl. Firmen-Login.

- Beim Desktop-Login laufen zusätzlich Draft-Request-Bereinigung und Athena-Token-Reset –
  im Web noch nicht (erst relevant mit Experiment Requests bzw. KI-Funktionen).
