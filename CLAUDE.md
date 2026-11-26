# TrippleT Web – Hinweise für Claude Code

Web-Version der TrippleT-Desktop-App (`C:\python\tripplet_project`), gestartet 2026-11-13.
Läuft **parallel** zur Desktop-App auf **derselben MySQL-Datenbank**.

## Sprache

- Zusammenarbeit mit dem Nutzer auf **Deutsch**.
- **Die Web-App ist viersprachig: EN / DE / ES / ZH** (Nutzerwunsch 2026-11-13, anders als die
  Desktop-App). Umschalten per Flaggen auf der Login-Seite und im Konto-Menü unten in der Seitenleiste
  (`LangFlags` in `src/i18n.tsx`, Wahl in localStorage `tripplet.lang`, sonst Browsersprache).
  **Jeder sichtbare Text** steht in `frontend/src/texts.ts` (`en` definiert die Schlüssel, die
  anderen Sprachen sind dagegen typisiert → fehlender Schlüssel = Build-Fehler) und wird mit
  `t("key", {vars})` aus `useI18n()` geholt – nie Text hart in Komponenten schreiben.
  Das Backend schickt für Meldungen **Codes** (`{"code": ..., "detail": <englisch>}`), die Seite
  übersetzt `<bereich>.err.<code>`. Navigation wird über die Route übersetzt (`nav.<route>`,
  `sec.<Sektion>`), Backlog-Status über die ID (`status.<id>`). Daten aus der DB (Serien-,
  Maschinen-, Garnnamen) werden nicht übersetzt.
- "Backlog" heisst auch auf Deutsch (und Spanisch) "Backlog" (Nutzerentscheid); Chinesisch 待办.

## Ab 2026-11-26: NUR NOCH die Web-App weiterentwickeln

**Nutzerentscheid 2026-11-26:** Die Web-App wird gepusht; neue Features und Korrekturen nur noch im Web. Die Desktop-App bleibt, wie sie
ist (keine neuen Screens/Widgets, keine Desktop-Zwillinge, `PARITY.md` nicht mehr nachführen). Gemeinsame Qt-freie Logik darf weiter
in `tripplet_project` entstehen (das Backend importiert sie) - dann dort committen und pushen, aber den Desktop nicht brechen.
Fresh off the Spool weiter in `ui/widgets/whats_new_texts.py`. Der Abschnitt unten gilt nur noch historisch.

## (Historisch) Grundregel 2026-11-14 bis 2026-11-25: jedes neue Feature in BEIDEN Apps

**Ziel (Nutzerentscheid 2026-11-14):** Die Web-App ersetzt den Desktop. Sind alle Tests gut, wird die
Desktop-App eingestellt. **Bis dahin muss jedes neue Feature und jede Änderung an bestehenden Funktionen
in beiden Apps umgesetzt werden** (Desktop `C:\python\tripplet_project` + Web), auch wenn der Nutzer
nur eine App nennt. Weg wie bisher: Logik Qt-frei in `tripplet_project` (beide nutzen sie), dann Desktop-
Oberfläche und Web-Seite (4 Sprachen); `PARITY.md` nachführen. Fehlerkorrekturen ebenfalls in beiden.
Ausnahmen nur, wenn der Nutzer es ausdrücklich sagt (z. B. bewusst nicht im Web: KI, Usage Stats; bewusst nur im Web: Links kopieren).

**Ausrollen (Plan 2026-11-14):** Windows-VM im Firmennetz als Dienst hinter HTTPS (IIS/Caddy, Firmen-CA),
zuerst gegen `dev` mit 1–2 Testpersonen, dann `prod`, Desktop eine Zeit parallel. Dateien bleiben auf dem
Fileserver (H: = `\\heb-fil-003\heberlein\technik\tripplet\...`; der Dienst braucht UNC-Pfade per
Umgebungsvariable + Lesen/Schreiben fürs Dienstkonto). Freischalten von dev/prod nur auf ausdrückliche Freigabe.

**Git / GitHub** (Nutzerentscheid 2026-11-14): beide Repos haben `origin` = privates GitHub (`reestoni/tripplet_project`, `reestoni/tripplet_web`). **Nach jedem Commit sofort pushen** (aktueller Zweig; Desktop arbeitet auf `ref-comparison`, Web auf `main`) - GitHub ist die Sicherung gegen Totalverlust. Fehlgeschlagenen Push melden. Zugangsdaten nie einchecken (`db_secrets.json`, `secrets.enc` sind ignoriert).

## Rahmen (Nutzerentscheide 2026-11-13)

- **Ziel-Betrieb: Server im Firmennetz (Intranet), nie im Internet.** IT erst für diesen
  späteren Schritt nötig (VM, HTTPS, evtl. Firmen-Login).
- **Phase 1: nur der Nutzer selbst, nur `dev_local`, Server nur auf 127.0.0.1.**
  `backend/app/core.py` verweigert den Start mit jedem anderen `TRIPPLET_MODE`
  (`ALLOWED_MODES`). Erweiterung auf dev/prod nur auf ausdrückliche Freigabe.
  **Ausnahme seit 2026-11-16 (Nutzerfreigabe, schreibend):** lokale Prod-Tests mit `start_prod.ps1` - Port 8010, nur
  127.0.0.1, `TRIPPLET_MODE=prod` wirkt nur zusammen mit `TRIPPLET_WEB_ALLOW_PROD=1` (sonst Startverweigerung), eigenes
  Cookie `tripplet_session_prod` (Cookies unterscheiden keine Ports), rotes Abzeichen "LOCAL · PROD · tripplet"
  (`TRIPPLET_WEB_INSTANCE=local`). `start_dev.ps1` bleibt dev_local; Tests sind fest auf dev_local (`conftest.py`
  entfernt den Schalter, `tests/test_core_mode.py`). `dev` bleibt gesperrt.
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
- Gegen die PRODUKTIONS-DB: `start_prod.ps1` (baut das Frontend, ein Prozess, http://127.0.0.1:8010; alles Gespeicherte ist echt).
- Tests Backend: im Ordner `backend/` `python -m pytest` (gegen dev_local; `test_move_real_roundtrip_restores` schreibt echt und stellt danach wieder her).
- Läuft `start_dev.ps1` beim Nutzer, belegt es Port 8000/5173 – für eigene Tests einen anderen Port nehmen (z. B. 8001), nicht seinen Server beenden. Der `--reload` lädt Backend-Änderungen nicht immer zuverlässig neu → nach Backend-Änderungen dem Nutzer Neustart empfehlen.
- Frontend prüfen: im Ordner `frontend/` `npm run build` (Typecheck + Build).
- API-Doku: http://127.0.0.1:8000/api/docs
- **Ausliefern auf die VM:** `DEPLOY.md` + `deploy/` (`build_release.ps1` auf dem PC baut ein ZIP aus dem committeten
  Stand beider Repos + `frontend/dist`; auf der VM `deploy/server/install.ps1` einmalig, `update.ps1` pro Release,
  Instanzen `test` (dev-DB, :8100) und `prod` (:8000) als NSSM-Dienste hinter HTTPS, ein Worker). Server-Einstellungen
  per Umgebungsvariable (`web.env`): `TRIPPLET_WEB_HTTPS` (Secure-Cookie), `TRIPPLET_WEB_INSTANCE` (Badge),
  `TRIPPLET_WEB_SECRET_PATH`, `TRIPPLET_DB_POOL_SIZE`, `TRIPPLET_MASTER_KEY_PATH`, Ablageorte `TRIPPLET_DIR_*`
  (`db/file_roots.py` im Desktop-Repo - neue Ablageorte immer dort eintragen, nie `H:` fest in Code schreiben).
- **Tempo** (2026-11-14, nur Web-Technik, keine Desktop-Entsprechung): `app/speed.py` - gzip nur für Text (JSON/JS/CSS/HTML/SVG;
  Jets 660 KB -> 42 KB), `Server-Timing`-Header + Log `slow request` ab `TRIPPLET_WEB_SLOW_MS` (800), `/assets` ein Jahr
  im Browser-Cache (Dateinamen mit Hash), `index.html` nie. Frontend: selten genutzte Seiten laden erst beim Öffnen
  (`lazyPage()` in `App.tsx`, bei fehlender alter Datei nach einem Release einmal neu laden); Backlog, All Experiments,
  Show Experiment, Create Experiment und Settings bleiben im Hauptpaket. `AdminTable` zeichnet ab 150 Zeilen nur den
  sichtbaren Ausschnitt (Abstandszeilen oben/unten, gemessene Zeilenhöhen inkl. aufgeklappter Details) - Browser-Suche
  (Strg+F) findet dort nur Sichtbares, dafür gibt es die Filterzeile. Neue Seiten in `App.tsx` als `lazyPage` eintragen.

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
   (`RequestHelp.tsx`). In Create Experiment öffnet das ER-Symbol die Anfrage als schwebendes, verschiebbares Fenster
   (`FloatingWindow`, `RequestIcon floating`; nicht modal, Formular bleibt bedienbar, Grösse unten rechts ziehbar, wie im Desktop). Tests `tests/test_request_links.py`.
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
Ab Zugriffsstufe 2. **Speicher-Konflikte** (2026-11-16, beide Apps): jede Änderung schickt `orig` (Wert wie geladen, bei
Auswahlzeilen die ID); der Server prüft vor der Plausibilität mit `series_save.find_conflicts` (aktueller DB-Wert vs. geladen,
gleiche Eingabe des anderen = kein Konflikt, wer/wann aus tblChangeLog) -> `{kind:"conflict", cells}`; Dialog "Inzwischen geändert":
abbrechen / ihre behalten (meine Änderungen dieser Zellen verwerfen, neu laden) / meine trotzdem speichern (`overwrite`).
Desktop: `PivotEditModel._loaded` (set_cell) + `conflict_items()`, `ShowExperimentScreen._confirm_no_conflicts` vor der Plausibilität.
Frontend `src/edit.tsx` (`EditProvider` pro Serie mit `key={id}`, `EditCell`; gelb =
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
`ConfigJSON` MEDIUMTEXT auf dev_local per `tools/smart_chart_views_migration.py` (prod seit 2026-11-16 auch; dev hat die Tabelle nicht,
`config_limit()` richtet sich nach der Spalte). Dashboards (Nur-lesen, beide Apps, Nutzerentscheid 2026-11-18) zeigen den Umschalter Report/Model nicht - das Modell gibt es nur in Smart Chart zum Erstellen (`.ro #views` + `setView` in `ui/smart_dashboard_html.py`). Nur Web: ungespeicherte Änderungen (`summary.dirty`, Punkt im Titel), Entwurf
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
- **Canvas-Bretter in der DB** (2026-11-14, beide Apps): `db/canvas_boards.py` + Tabelle `tblCanvasBoard` (angelegt nur über
  `tools/canvas_board_migration.py`, dev_local, dev und prod angelegt 2026-11-16). App-neutrales Brett-Format (Mittelpunkt/Grösse/Winkel,
  Quellen `series_image`/`series_pdf` per ID oder `file` = Datei beim Brett unter `file_roots` `CANVAS_FILES`/<BrettID>/). Optional an eine
  Serie gehängt, für alle mit Canvas sichtbar, Speichern ab Stufe 2, Löschen Ersteller/Superuser, Versionsprüfung (409 `conflict`).
  Web `app/canvas_api.py` (`/api/canvas/boards…`; Uploads/Zwischenablage werden beim Speichern zu Brett-Dateien), Seite speichert
  automatisch 4 s nach der letzten Änderung, `?board=` / `?series=`; Knopf "Brett (n)" in Show Experiment (`boards` in `/api/series/{id}`).
  Desktop: Brett-Leiste über der Canvas-Toolbar (Titel, Boards…, Save Strg+S, Kopie, Löschen, Autosave alle 2 s), Knopf "🖼 Board" in
  Show Experiment (`app_meta.open_canvas_board`). Alte .ttcanvas-Dateien: Web "Datei importieren", Desktop weiter Save/Load project.
  Tests: Desktop `test_canvas_boards.py`, `test_canvas_screen_boards.py`; Web `test_canvas_boards_api.py`.
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
- **Jet Advisor / Düsen-Berater** `/tools/jet-advisor` (2026-11-15, beide Apps, Nutzerwunsch): Ziele (Punkte/m, CV, Stabilität
  0.3-1.3, je min/max) + Garn (vorhandenes oder Material/Endtiter/Filamente) + Filter (Düsentyp z. B. nur Standard, Hersteller,
  Gruppe, Titerbereich der Düse, Grenzen für Druck/OF/Speed) -> Rangliste der Düsen mit Einstellung, Fenster, Vorhersage ± Streuung,
  Chance, Luft (Formel aus `ui/jet_roi.py`), Grundlage (Serien-Links, "In der Prozess-Spielwiese öffnen" über `?trial=`).
  Logik `ui/jet_advisor.py` (Variante A, Nutzerentscheid: transparent, nie extrapolieren): ähnliche Garne (Log-Abstand Endtiter
  1.3x / Filamente 1.5x = 1), pro Garn/Düse die Fits von `dty_whatif` + gemessene Einstellungen, P(alle Ziele) normal, Gleichstand
  = Sicherheitsabstand oder wenig Luft. Feature `jet_advisor` (Stufe 0). Web `app/jet_advisor_api.py` (ein `Advisor` pro Prozess,
  Neu laden), Seite `JetAdvisor.tsx` (Formular in localStorage `tripplet.jetAdvisor`). Desktop `ui/screen_jet_advisor.py`.
  Dabei korrigiert (beide Apps, auch Prozess-Spielwiese): Punkte/m = 0 heisst "nicht gemessen" (`dty_whatif.clean_rows`).
  Hilfe (beide Apps, EN/DE/ES/ZH, Reiter "Wie mache ich…?", "Wie entschieden wird", "Bildschirm"): `ui/widgets/help_texts_jet_advisor.py`
  + Skizze `assets/images/help_jet_advisor.svg`, in `help_index.SOURCES` und `help.WEB_ROUTES`; Web `HelpButton screen="jet_advisor"`.
  Tests: Desktop `test_jet_advisor.py`, `test_screen_jet_advisor.py`; Web `test_jet_advisor_api.py`.
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
**Projekte** (2026-11-16, beide Apps, Nutzerwunsch: vorher nirgends bearbeitbar): `/admin/projects`, `KINDS["projects"]` = `tblProject`
(Nummer, Name, Process, ProcessDescription), Feature `projects` (Admin, Stufe 1). Spalte `UsedBy` (Experimente + Anfragen, nur Anzeige);
Projektnummer eindeutig (`NumberTaken` -> 409 `number_taken`); benutzte Projekte nicht löschbar (`InUse` -> 409 `in_use`).
Desktop `ui/screen_manage_projects.py` (Unterklasse des Order-Type-Screens, der jetzt `_KIND` als Klassenattribut hat), Eintrag "Projects"
in der Admin-Sektion. Tests: Desktop `test_manage_projects.py`, Web `test_admin_master.py::test_projects_rules`.

**Superuser: Papierkorb** (2026-11-13): Papierkorb
`/superuser/recycle-bin` (`RecycleBin.tsx`) über `app/recycle_bin_api.py` auf `db/recycle_bin.py` (neu `preview_start`/`preview_back`/
`preview_delete`, auch von `ui/recycle_preview.py` genutzt): Wiederherstellen, endgültig löschen, Vorschau = Serie vorübergehend
zurück, Show Experiment nur lesend mit Banner (`recycle_preview` in `/api/series/{id}`, nur für den Superuser, der sie geöffnet hat):
endgültig wiederherstellen / zurück (Originaldatum) / endgültig löschen; Seite verlassen = zurück (wie Tab schliessen). Offene
Vorschauen leben im Serverprozess - nach einem Neustart bleibt die Serie einfach wiederhergestellt (wie Absturz im Desktop).
**Lab Assistant** (KI-Chat, keine KI im Web) und **Usage Stats** (Nutzerentscheid 2026-11-13: im Web nicht nötig) sind bewusst
nicht im Web und fehlen in der Seitenleiste wie Offline Sync. Tests `tests/test_recycle_bin_api.py` (echte Testserie, wird endgültig gelöscht).

**Aufbau der Seitenleiste** (Nutzerwunsch 2026-11-14, `components/Shell.tsx`, Symbole `components/SidebarIcons.tsx`):
oben Suchleiste ("Suchen… Ctrl F") + Uhr-Knopf "Zuletzt geöffnet", darunter nur die Sektionen; unten eine Symbolzeile
(Knowledge Base, Hilfe F1, Fresh off the Spool, Glocke = die `PINNED`-Einträge aus `nav.py` + die zwei Fenster) und die
Konto-Karte (Initialen, voller Name, Zugriffsrecht; Klick = Menü mit Einstellungen, Sprache/Flaggen, Abmelden).
Eingeklappt: nur Symbole, Werkzeuge 2x2. Neue Fuss-Funktionen als Symbol in die Werkzeugzeile, nicht als weitere Zeile.

**Seitenleiste: Glocke, Suche, Zuletzt geöffnet, Seitenprotokoll** (2026-11-13): Glocke im Seitenleisten-Fuss
(`components/Notifications.tsx`, `app/notifications_api.py` auf `ui/notifications.py`; nur eigene Meldungen, Zähler alle 2 min,
bei Fokus und nach Yarn-Stock-Laden über das Ereignis `tripplet:bell`). Schnellsuche Strg+F / "Suche" (`components/QuickSearch.tsx`,
`app/search_api.py` auf `db/quick_search.py`). "Zuletzt geöffnet" = dieselbe Liste wie im Desktop (`DisplaySettings.recent_series`,
`push_recent`; Show Experiment meldet `POST /api/recent`, nicht bei Papierkorb-Vorschau). `ScreenLog` schreibt pro Seitenaufruf
`screen_open` mit dem Desktop-Klassennamen (die Desktop-Usage-Stats zählen beide Apps zusammen; Zuordnung `SCREENS` in `QuickSearch.tsx`).

**Fresh off the Spool** (2026-11-13): `components/WhatsNew.tsx` (Funken-Symbol im Seitenleisten-Fuss, öffnet sich nach dem Login einmal von
selbst, wenn die neueste Version ungesehen ist), `app/whats_new_api.py` auf `ui/whats_new_data.py` + `ui/widgets/whats_new_texts.py`
(EN/DE/ES/ZH seit 2026-11-16, Flaggen wie die Hilfe). "Gesehen" = `DisplaySettings.whats_new_seen` wie im Desktop. Skizzen über
`/api/whats-new/sketch/<name>`. Kein PDF-Knopf (Browser-Druck).

**Login-Sperre** (2026-11-14, beide Apps): `db/login_guard.py` - nach 5 falschen Passwörtern für einen Benutzernamen innerhalb 15 Min. ist er 15 Min. gesperrt (ab dem letzten Fehlversuch); Erfolg setzt zurück. Gezählt in `tblUsageLog` (EventType `security`, `login_failed`/`login_ok`, Username klein) mit DB-Zeit, Desktop und Web zusammen; auch das alte Passwort beim Passwortwechsel (`user_account.PW_LOCKED`). Fehler beim Log = niemand gesperrt. Web: 429 `locked` {minutes}, 401 `invalid` {left}.

**Profilbild** (2026-11-14, beide Apps): freiwillig, Datei statt DB-Spalte - `db/user_avatar.py` (Desktop-Repo; Ordner
`file_roots` `USER_AVATARS`, dev `C:\ttt\UserAvatars`, prod `H:\Technik\TrippleT\UserAvatars`, `<UserID>.png`, jeder Upload
wird quadratisch auf 256 px PNG gebracht). Web: Abschnitt "Profilbild" in `/settings` (sofort gespeichert, `POST/DELETE
/api/settings/avatar`), Bild `GET /api/avatar/<id>?v=<version>`, `/api/me` -> `avatar` (Version, 0 = keins), Konto-Karte zeigt es
(Ereignis `tripplet:avatar`). Desktop: Gruppe "Profile picture" im Settings-Dialog (mit Save gespeichert), rund in der Fusszeile.

**Darstellung Klassisch / Modern** (2026-11-16, nur Web, Nutzerwunsch: Facelift umschaltbar, Original bleibt): `styles.css` = Klassisch,
bleibt unverändert; `src/theme-modern.css` wirkt nur unter `html[data-theme="modern"]` (gesetzt in `display.tsx` aus
`DisplaySettings.theme`, Wahl in `/settings` -> Darstellung, sofort gespeichert über `/api/settings/prefs`, pro Benutzer; Desktop ignoriert
den Wert). Schrift Inter lokal mitgeliefert (`@fontsource-variable/inter`, kein Internet nötig). Neue Gestaltung immer ins Modern-Thema
(Selektor mit `html[data-theme="modern"]` beginnen), nie Klassisch verändern; Funktionen/Masse, auf die Code baut, nicht ändern.
Stand Schritt 1: Grundgerüst (Farben, Schrift, Fokusrahmen, Scrollbalken), Seitenleiste hell (dunkles Logo `LOGO_BLACK`), Knöpfe,
Felder, Karten, Dialoge, Tabellenköpfe, Backlog. Schritt 2: Show Experiment (unterstrichene Reiter, Speicherleiste, Pivot-Tabellen
feiner, Akzent bleibt) und All Experiments (Filter-Pillen); Modern etwas kleinere Schrift (Inter 13.5 px), damit Listen gleich kompakt bleiben. Schritt 3: Panels/Karten der Werkzeuge,
Segment-Schalter (`.jr-seg`, `.ja-seg`), innere Reiter, Admin-Tabellen, Glocke/Zuletzt-Menü, Login-Karte. Symbole für Admin-/Superuser-Einträge
(`nav.WEB_ICONS`, Bilder `sb_*.png` im Desktop-Repo) in beiden Darstellungen, nur Web (Desktop-Seitenleiste unverändert).
**Tablet & Mobile** (Nutzerentscheid 2026-11-18, nur Web): alle Screens werden auch für Tablet/Handy gebaut, teils
abgespeckt - Konzept, Regeln (Breiten, `responsive.css`, Touch-Ersatz für Rechtsklick/Hover/Strg+S/Ziehen) und Stand pro
Screen in `MOBILE.md`. Neue Seiten gleich mit Handy-Fall bauen.
**Darstellung Nacht** (2026-11-16, nur Web): dunkles Thema = Modern + dunkle Schicht (`html[data-theme="modern"][data-night]`,
`DisplaySettings.theme = "night"`). `src/theme-night.css` wird ERZEUGT von `frontend/tools/gen_night_css.py` (dunkle Zwillinge aller
festen hellen Farben aus `styles.css`/`theme-modern.css`) + Handteil `frontend/tools/night_hand.css` (Tokens, Leuchten des Akzents,
Glas-Dialoge, Monospace-Zahlen in Pivot-Tabellen, Prozess-Schema). **Nach Änderungen an styles.css/theme-modern.css den Generator neu
laufen lassen**; Handregeln nur in `night_hand.css`. Diagramme: `Plot` in `YarnScopeView.tsx` legt im Nacht-Modus ein dunkles Layout darunter.
Bleiben hell: Smart-Chart-Fläche und Report (Desktop-Vorlagen im iframe), Bilder.
**Darstellung Blaupause** (2026-11-16, nur Web): technische Zeichnung (blaues Papier mit 10/50-px-Raster, weisse Linien, Schrift Bahnschrift,
doppelte Rahmen, Beschriftungen in Grossbuchstaben; Akzentfarbe wirkt hier kaum, Linien sind weiss). Gleicher Weg wie Nacht:
`html[data-blueprint]`, `DisplaySettings.theme = "blueprint"`, `src/theme-blueprint.css` vom selben Generator (`PROFILES` in
`gen_night_css.py`) + Handteil `frontend/tools/blueprint_hand.css`; Diagramm-Farben `DARK_PLOT` in `YarnScopeView.tsx`.
**Darstellung Heberlein** (2026-11-20, nur Web, Nutzerwunsch): Hausstil hell - Seitenleiste/Handy-Kopfzeile Dunkelblau #1B232C mit
grüner Linie, Akzent fest #1D983A (die persönliche Akzentfarbe gilt hier bewusst nicht), Tabellenköpfe #E7EFE8, Text #666666, Schrift
Glober Book/xBold per `local()` (auf Firmen-PCs installiert, Kauf-Schrift - nie mitliefern; sonst Inter). Modern + Schicht
`html[data-heberlein]`, `DisplaySettings.theme = "heberlein"`, `src/theme-heberlein.css` **von Hand** (hell, nicht im Generator);
Tablet/Handy-Teil am Ende der Datei (Kopfzeile, Schublade, feste Leisten, Vollbild-Blätter mit dunkelblauer Titelzeile).
**Automatische YarnScope-Analyse** (2026-11-20, Nutzerwunsch, nur Server - der Desktop sieht die Ergebnisse, seine Glocke kennt die
Meldung): `app/yarnscope_auto.py`, Thread beim Start (`main.py` startup), alle `TRIPPLET_AUTO_ANALYSE_MIN` (10) Min. Ordner DTY+ATY lesen;
eine Datei zählt, wenn sie höchstens `…_DAYS` (14) alt und seit `…_SETTLE_MIN` (5) unverändert ist und ihr Versuch (Zuordnung wie der Reiter:
`trial_files`/`find_tdms`, nie Referenzmuster) noch KEINE Analyse hat (`ANALYSED_SQL`) - nie überschreiben. Dann gleiche Analyse + Speichern
wie "In DB speichern" (DTY `analyse_trial`+`save_analysis`, ATY `analyse_core_file`+`save_db_row`) auf dem Batch-Executor (eins nach dem
anderen), gespeichert als Backlog-Besitzer der Serie (sonst erster Superuser), Glocke `yarnscope_auto_dty`/`_aty` an ihn (Klick = Reiter).
Fehlgeschlagene Datei erst wieder, wenn sie sich ändert. **Sicherheit:** nur mit `TRIPPLET_WEB_AUTO_ANALYSE=1` UND (Modus prod ODER beide
`TRIPPLET_YARNSCOPE_*_DIR` gesetzt) - die TDMS auf H: gehören zu prod (Test-Instanz gegen dev würde fremde Serien treffen). An in
`start_prod.ps1`; auf der VM nur in der prod-`web.env`. Status für Superuser: `GET /api/yarnscope/auto-status`. Durchlauf ~1 s (erst die
analysierten Versuche per Abfrage, Dateisuche nur für den Rest). Tests `tests/test_yarnscope_auto.py` (tmp-Ordner, nichts in der DB).
**Versuche kopieren: Labormaschinen wählen** (2026-11-20, beide Apps): Schritt 3 im Kopier-Dialog, nur Maschinen der gewählten Versuche, alle
angehakt = wie bisher; `trial_actions.lab_tables_of_trials`, `copy_trials(..., lab_tables=)` -> `clone_lab_rows_for_trial(tables=)`; Web schickt
`labs` nur bei Abwahl, Server prüft gegen die Liste (nie freie Tabellennamen). Dabei korrigiert (beide): Kopien bekommen in Labor-Tabellen keinen
alten `Timestamp` mehr.
**PDF-Import mit Fortschritt** (2026-11-20, nur Web, Nutzerwunsch; der Desktop hat schon einen Fortschrittsdialog): `POST
/api/series/{id}/pdf-import/start` -> Hintergrund-Job (ein Import gleichzeitig, wartende zeigen "Wartet…") über dieselben Hooks wie
der Desktop (`on_pdf_start`/`on_pdf_end` Statimat, `progress_for` = OCR-Seite Itemat); `GET …/pdf-import/job/<id>` (nur für den
Starter), Dialog pollt alle 0.7 s (`ImportProgress` in `SeriesTools.tsx`). Das alte direkte `POST …/pdf-import` bleibt.
**YarnScope messen statt Sensoft** (2026-11-20, beide Apps, Machbarkeit für F&E - Validierung mit Garn steht noch aus): Knopf "📏 Messen"
in Show Experiment. Logik `ui/yarnscope/sensor_measure.py` (Desktop-Repo): NI USB-6211 ("Dev1"/"Dev2", eine pro Laptop) über `nidaqmx`
(nur beim Messen importiert; `pip nidaqmx` + NI-DAQmx-Treiber), Anschlüsse C1 = ai1/ai9, C2 = ai4/ai12, RSE ±10 V, Frequenz = Geschwindigkeit
/ 0.25 mm (Box rundet: 20 MHz / ganzzahlig), Kalibrierung der Sensoptic-`.dat` (µm = a + b·V), TDMS genau wie Sensoft (Gruppe "Rohdaten",
x/y-Achse, Parameter-Tabelle, Name `<Serie>_<Versuch>_<TTMMJJ_HHMM>.tdms`) + Eigenschaften `TrippleT.*` (echte Frequenz, Kopf, Box-Seriennr.,
Versuch, Leerwert) -> automatische Analyse nimmt sie. Sensoren = Köpfe aus den Sensoft-Konfigurationen des Benutzers
(`…\LabVIEW Data\Sensoft\Config Data\Configurations ATY\*.ini`, zuletzt geänderte zuerst). Probelauf 2026-11-20 ohne Garn = Sensoft (X −53.3/−53.8 µm,
Y 521.6/521.6 µm); Sensofts "Nullen" ändert die gespeicherten Werte nicht -> hier nur "Leerwert prüfen". Vorhandene Datei: 409 `exists`, "Neu messen"
verschiebt die alte nach `_replaced\` (nie löschen). Geschwindigkeit = Winder-Geschwindigkeit des Versuchs (Nutzerangabe 2026-11-20,
`default_speed`: Speed Shaft 2 × (1 − Winder % / 100) wie das Prozess-Schema; prod 466 V70: 800 m/min, 4.5 % -> 764 = Sensoft-Dateien; ATY ohne
Vorschlag). Nach einer Messung ist der nächste Versuch gewählt, der Knopf heisst dann "2. V002 messen" (wie Sensofts Hochzählen).
**Messfenster nicht modal + Leerwert gemerkt** (2026-11-23, beide Apps, Nutzerwunsch: zwischen den Versuchen in die Tabelle tippen, nicht jedes
Mal neu nullen): Desktop `dlg.show()` (ein Fenster pro Serie, `_RUNNING` hält laufende Mess-Threads am Leben, auch wenn der Screen zugeht), Web
`FloatingWindow` (Klasse `ms-float`). `sensor_measure.zero_check` merkt sich jeden Leerwert pro (Box, Kopf, Anschluss) im Prozess,
`remembered_zero(box, head, connector, second)` gibt ihn zurück, bis neu geprüft wird oder die Box getrennt war (seit 2026-11-24 auf der Platte, s. u.); Web: `zeros` in den
Setup-Antworten, `useKeptZero` wählt den passenden. Auch im TDMS Inspector. Nach einer Messung wird NICHT neu aufgebaut (Tabelle sprang an den Anfang): Desktop
`on_measured` -> nur `_build_yarnscope_tab`/`_build_aty_yarnscope_tab`, Web nur die Seitendaten (`reload`, wie nach dem Speichern) + `ysKey` für offene YarnScope-Reiter; Schliessen tut nichts mehr.
**Automatisch messen beim Speichern der Spannung** (2026-11-24, beide Apps, Nutzerwunsch): Häkchen im Messfenster (aus als Standard; Desktop
QSettings `SensorMeasure/auto_tension`, Web localStorage `tripplet.sensorMeasure.auto`, Knopf zeigt "· Auto ●"). Speichern mit Spannung vor/nach der
Düse (`series_save.jet_tension_trial_ids`, nur wenn Machine Data wirklich gespeichert -> `tension_trials` in `save_series_edits`/Web-Speicherantwort)
-> `ui/yarnscope/auto_measure.decide`: genau EIN Versuch, mit DTYoMat-Zeile (`tblLaborDTYoMat`); keine TDMS -> sofort messen, TDMS da -> zuerst fragen
(dann `replace`, alte Datei nach `_replaced`); mehrere Versuche -> Hinweis, nichts gemessen. Das Speichern wird nie blockiert. Desktop
`ShowExperimentScreen._auto_measure_after_save` -> `SensorMeasureDialog.auto_measure(trial_id, replace)`; Web `GET /api/series/{id}/sensor/auto?trials=&kind=`,
`SeriesView.autoAfterSave` -> Messfenster mit `auto` (n = neue Anforderung). Leerwert vorher prüfen (sonst fragt das Fenster wie gewohnt).
Tests: Desktop `test_auto_measure.py`, `test_series_save.py`; Web `test_sensor_api.py::test_auto_decision_after_tension_save`.
Web `app/sensor_api.py` (`/api/series/{id}/sensor/setup|zero|measure|job/<id>[/cancel]`, ein Job gleichzeitig, Browser schickt nur Versuchs-ID,
Sensor-Schlüssel, Box-Name): **der Server misst** - geht nur, solange er auf dem Laptop mit der Box läuft (auf der VM: später ein Helfer).
Frontend `components/SensorMeasure.tsx`. Desktop `ui/widgets/sensor_measure_dialog.py`. Tests: Desktop `test_sensor_measure.py`, Web
`test_sensor_api.py` (simulierte Box, tmp-Ordner).
**Freie Messung im TDMS Inspector** (2026-11-23, beide Apps, Nutzerwunsch für die Validierung): Knopf "📏 Messen…" - eigener Name (z. B.
`99999_34`, `sensor_measure.check_name`: Buchstaben/Ziffern/`_ . -`/Leerzeichen, max. 60) + Geschwindigkeit von Hand, ohne Serie/DB.
`measure_free()` schreibt nach `<DTY|ATY-Ordner>\_manual\<Name>_<TTMMJJ_HHMM>.tdms` (gleiche Minute -> Sekunden dazu, nie überschreiben);
die automatische Analyse und die YarnScope-Reiter lesen nur den Ordner selbst -> nie einem echten Versuch zugeordnet. Danach öffnet der
Inspector die Datei und der Name zählt hoch (`next_name`: 99999_34 -> 99999_35). Web: `sensor_api.inspector_router`
(`/api/tdms-inspector/sensor/setup|zero|measure|job/<id>[/cancel]`, Feature `tdms_inspector` + Stufe 2), die Datei wird mit
`tdms_inspector.register()` geöffnet (`own: False` - das Aufräumen nach einem Tag vergisst sie nur, löscht sie nie), Dialog
`FreeMeasureDialog`. Desktop: `SensorMeasureDialog(free=True, on_measured=…)`, `TdmsInspectorScreen._open_path`. Schreibrecht prüft der
Dialog selbst (`read_only` unter Stufe 2).
**Zwei Sensoren gleichzeitig + Geschwindigkeit** (2026-11-23, beide Apps, Nutzerwunsch): in beiden Mess-Dialogen "2. Sensor gleichzeitig"
(nur Köpfe am ANDEREN Anschluss derselben Box) + Abstand (mm, nicht fest, leer = nur Verzögerung; Vorgabe `sensor_pair.DEFAULT_DISTANCE_MM` = 160 mm = Testaufbau des Nutzers "ca. 16 cm", Web bekommt sie über `default_distance_mm` in den Setup-Antworten). EINE Task für alle Kanäle (`_record`),
also gleicher Takt. Dateien: Hauptsensor wie gehabt (= Datei des Versuchs), der zweite gleichnamig in `<Ordner>\_C1|_C2\` (von Analyse/Reitern
nicht gesehen); im Inspector beide in `_manual` mit `_C1`/`_C2` im Namen. Eigenschaften `TrippleT.Pair*` (Partnerdatei, Abstand,
Verzögerung, Speed). Auswertung `ui/yarnscope/sensor_pair.py`: Verzögerung = Maximum der normierten Kreuzkorrelation (FFT, vorher ~20 cm
gleitendes Mittel abgezogen, Parabel zwischen den Punkten), vertraut wenn `MIN_CORR` 0.3 ODER die Spitze `MIN_Z` 8-fach aus dem Rauschen der Korrelation >50 mm daneben ragt (`reliable()`; seit 2026-11-23: der OBD an C2 sieht das Garn schwach, Übereinstimmung fiel unter 0.3 bei exakt 160.0 mm Verzögerung -> Speed ging verloren; gleiches Garn z 12-17 bis corr 0.04, fremdes Garn z ~3); Speed = Abstand / Verzögerung, ohne Abstand Abstand aus der
eingestellten Geschwindigkeit; Speed pro 10 m; gleiche Knoten: `dty_analysis.knot_runs` (= genau die YarnScope-Erkennung) beider Signale,
verschoben, gepaart (Toleranz halbe Median-Knotenlänge) -> % gemeinsam, nur in einem, Längenunterschied. Geprüft an echten Daten: verschiedene
Garnstücke corr 0.03; echtes Signal verschoben + Rauschen = Verzögerung/Speed exakt, 96 % gleiche Knoten (die übrigen 4 % = Unsicherheit der
Erkennung allein durch Rauschen). Web: `second` (Sensor-Schlüssel) + `distance` in `/sensor/zero|measure` (Zero misst beide), Antworten ohne
Server-Pfade (`_no_paths`), Inspector öffnet beide Dateien; Frontend `SecondFields`/`PairResult` in `SensorMeasure.tsx`. Desktop:
`cb_second`/`sp_distance`, `pair_text()`. Grenze: 250 kS/s für alle Kanäle (1+2 Achsen bis ~1'250 m/min, 2+2 bis ~930). Tests: Desktop
`test_sensor_pair.py`, `test_sensor_measure.py`; Web `test_sensor_api.py`.
**YarnScope Live** (2026-11-23, beide Apps, Nutzerwunsch "Mini-Dashboard"): Werkzeug `/tools/yarnscope-live` (Web-Seite `YarnScopeLive.tsx`,
`app/sensor_live_api.py`: `/api/yarnscope-live/setup|start|state?since=|stop`, Feature `tdms_inspector`, Start ab Stufe 2, Stopp nur Starter
oder Superuser; Seitenleiste nach TDMS Inspector) bzw. Desktop eigenes Fenster `ui/widgets/sensor_live_window.py` (Seitenleiste Werkzeuge,
`main._go_yarnscope_live`; der Callback `on_yarnscope_live` läuft durch `_sidebar_nav_kwargs` und die Konstruktoren von Home/Backlog/All
Experiments/Show Experiment). Logik `ui/yarnscope/sensor_live.py`: Start/Stopp von Hand, Dauer-Aufnahme `Daq.stream` (CONTINUOUS, 20 s Puffer),
alle `window_m` (30 m) eine Zeile: Knoten/m + CV (Start-zu-Start) pro Sensor mit `analyze_series` (~0.3 s für 30 m), mit 2. Sensor Verzögerung,
Übereinstimmung, Speed (mit Abstand) bzw. Abstand aus Speed; Analyse in eigenem Faden. Speichern (Häkchen, Standard an) stückweise als TDMS-Segmente
nach `_manual` (`.part` während der Messung, Parameter-Tabelle als letztes Segment), höchstens `SAVE_LIMIT_M` 5000 m, danach nur Anzeige. Eine
Live-Sitzung pro Prozess, hält `_measuring`. **Speed selbst messen** (Nutzerwunsch 2026-11-23, Häkchen, Standard an sobald 2. Sensor + Abstand): keine Geschwindigkeit eingeben - die Box liest mit fester Frequenz (`AUTO_RATE_MAX` 80 kHz/Kanal, mit 4 Kanälen weniger), jede Sekunde (`BLOCK_S`) Verzögerung -> Speed, damit jeder Sensor per `np.interp` auf genau 0.25 mm umgerechnet (Position über die Blöcke weitergeführt) -> Analyse und gespeicherte TDMS wie jede YarnScope-Datei, auch wenn die Maschine schwankt; Block ohne Übereinstimmung nimmt den letzten Speed. Datei: Geschwindigkeit = mittlerer gemessener Speed, `TrippleT.AutoSpeed`, `SampleRateHz`, `MeasuredSpeedMean`. Ohne 2. Sensor/Abstand -> 400 `auto_needs_two`. Simulation (700 -> 760 m/min, 160 mm): Speed exakt gefunden, Knoten/m 159.4-160.5 bei Wahrheit 159.7. Tests: Desktop `test_sensor_live.py` (simulierte Dauer-Box, Fenster, Konstruktoren), Web
`test_sensor_live_api.py`.
**Merken + Versuch aus dem Live-Dashboard** (2026-11-24, beide Apps, Nutzerwunsch: beim Einstellen einer Düse nichts eintippen): "📌 Merken" hält
ohne Eingabe die letzten N m (`BOOKMARK_M` 100, `BOOKMARK_RANGE` 5-300, im Dashboard änderbar) aller Sensoren im Speicher fest (Ringpuffer
`LiveSession._buffer`, float32, `BUFFER_M`; Auto-Speed schon auf 0.25 mm) + Knoten/m/CV dieser Strecke; höchstens `MAX_BOOKMARKS` 20, weg beim
nächsten Live-Start / Neustart. Nichts wird geschrieben. An einer Merk-Zeile "Versuch anlegen…" = `ui/yarnscope/live_trial.create`: Vorlage der
Serie (Vorgabe höchste Versuchsnummer) wird wie "Versuche kopieren" kopiert (`trial_actions.copy_trials`, nur die Standard-Kopierfelder: Düse,
Druck, OF, Speed …; nur geänderte Werte, Prüfung `trial_copy.validate_overrides` - nutzt jetzt auch der Web-Kopierdialog), TDMS NUR wenn angehakt:
`<Serie>_<Versuch>_<TTMMJJ_HHMM>.tdms` im DTY/ATY-Ordner der Live-Messung (alte Datei der Nummer -> `_replaced` über `sensor_measure.move_replaced`),
2. Sensor wie "Messen" in `_C1|_C2`. "Als Datei…" = `live_trial.save_file` nach `_manual`. Serie: zuletzt geöffnete oder Nummer tippen
(`live_trial.series_info`). Web: `/api/yarnscope-live/bookmark` (POST), `/bookmark/{id}/label|trial|file`, DELETE `/bookmark/{id}`,
`/trial-setup?series=` (Recht Versuche bearbeiten); Seite: Merken-Leiste + Liste + Fähnchen in den Diagrammen, Dialoge `LiveTrialDialog`,
`BookmarkFileDialog`. Desktop: Leiste + Tabelle im Live-Fenster, `LiveTrialDialog`. Tests: Desktop `test_live_trial.py`, Web
`test_sensor_live_api.py::test_bookmark_and_trial_from_it` (Kopie ersetzt, keine DB-Schreibzugriffe).
**Leerwert dauerhaft + automatische Messung wertet aus** (2026-11-24, beide Apps, Nutzerwunsch): der letzte Leerwert pro (Box, Kopf, Anschluss) liegt in
`%LOCALAPPDATA%\TrippleT\sensor_zero.json` (`sensor_measure._zero_path`, Tests: `TRIPPLET_SENSOR_ZERO_PATH`), egal ob Messfenster, Live, Desktop oder
Web-Server; keine Altersgrenze mehr. Ungültig, wenn `list_boxes()` die Box nicht mehr findet oder eine andere Seriennummer sieht (`note_boxes` -> "lost");
ein abgesteckter Kopf an angeschlossener Box ist nicht erkennbar. Zeitstempel mit Mikrosekunden. Automatische Messung (Spannung gespeichert) wird danach
sofort ausgewertet und gespeichert (`auto_measure.analyse_and_save` = DTY `analyse_trial`+`save_analysis`, ATY `analyse_core_file`+`save_db_row`),
das Messfenster schliesst sich: Desktop `SensorMeasureDialog._pending_analysis` -> `_auto_finished` -> `on_auto_done` (DTYoMat-Reiter neu, ausser
ungespeichert), Web `analyse: true` im Mess-Job -> `result.analysis`, `onAutoDone` (Meldung, Fenster zu). Web nimmt den gemerkten Leerwert auch ohne
`zero` aus dem Browser.
**Live: volle Grösse, CV-Kachel, Leerwert** (2026-11-24, beide Apps, Nutzerwunsch): jedes Diagramm hat ⤢ -> volle Grösse (Web Overlay
`.yl-bigchart`, Esc/✕; Desktop `_set_focus(key)` blendet Kacheln/Tabellen aus, auch Doppelklick aufs Diagramm), CV pro Sensor als eigene Kachel
(Desktop-Kacheln: 2 pro Sensor + Speed an Index 2n). Leerwert vor dem Start: Web `POST /api/yarnscope-live/zero` + `zeros` in `/setup`
(`useKeptZero`/`ZeroInfo` aus `SensorMeasure.tsx`), Desktop Knopf im Live-Fenster; derselbe gemerkte Wert wie im Messfenster
(`sensor_measure.remembered_zero`), `LiveSession.zero` -> `TrippleT.EmptyX/Y_um` in den Live- und Merk-Dateien; Start ohne Leerwert fragt.
**Versuch ohne Merk-Zeile** (2026-11-24, beide Apps): Knopf "Versuch anlegen… (ohne TDMS)" in der Merken-Leiste, auch ohne Live-Messung - derselbe
Dialog ohne TDMS-Häkchen; Web `POST /api/yarnscope-live/trial` (nie eine Datei, `save_tdms` wird ignoriert), Desktop `LiveTrialDialog(None, None, …)`.
**Garndicke in Live** (2026-11-24, beide Apps): mit Leerwert pro Abschnitt `d_um` (Mittel), `d_bulk` (Offenstellen/Bausch), `d_knot` (Knoten) =
Signal minus Leerwert (`sensor_live.zero_offset` = Mittel der Achsen-Leerwerte des Sensors, `thickness()` trennt mit `dty_analysis.knot_runs`); ohne
Leerwert None. Kachel "Dicke" pro Sensor, Diagramm (Bausch durchgezogen, Knoten gepunktet, ⤢), Tabellenspalten; auch in Merk-Zeilen. Begründung:
Kalibrierung hat Achsen-Versatz (PXL 3-121 leer X −53 / Y +522 µm), 466_12 nach Abzug X 183.5 / Y 174.6 µm. Nicht validiert (Hinweis im Tooltip).
Desktop-Kacheln jetzt 3 pro Sensor + Speed an Index 3n.
**Mehrere Versuche auf einmal** (2026-11-24, beide Apps, Nutzerwunsch z. B. Platte 1 und Platte 2): Dialog "Versuche anlegen…" mit einer Spalte pro
neuem Versuch ("+ Versuch" übernimmt die letzte Spalte, ✕ entfernt), pro Spalte optional "TDMS aus Merk-Zeile" (jede Merk-Zeile höchstens einmal).
`live_trial.create_many` prüft alles vor der ersten Kopie (`no_items`, `too_many` > 20, `bookmark_twice`, Werte mit `n`), dann EIN `copy_trials` mit
allen Plänen; `create()` = `create_many` mit einem Eintrag. Web `POST /api/yarnscope-live/trials` {series_id, template_id, items:[{values, bookmark}]}.
**Live-Messung wieder laden** (2026-11-24, beide Apps): am Ende eines gespeicherten Laufs schreibt `LiveSession._write_side_file` neben die Haupt-TDMS
`<Datei>.live.json` (alle Zeilen, Sensoren, Merk-Zeilen, Leerwert) -> `sensor_live.load_saved(file, kind)` zeigt exakt dieselben Kurven (state "loaded").
Ohne Zusatzdatei (ältere Läufe) wird neu ausgewertet (gleiche Abschnitte, Leerwert aus `TrippleT.EmptyX/Y_um`; Speed pro Abschnitt nur bei fester Frequenz,
bei Auto-Speed nur Mittelwert) und die Zusatzdatei danach geschrieben. `saved_runs(kind)` listet `_manual` (Zusatzdateien + TDMS mit `TrippleT.Live`, ohne
Partner-/Merk-Dateien); Dateiname geprüft (`_check_file`). Web `GET /api/yarnscope-live/saved`, `POST /saved/load` (sofort `view` oder `job_id`),
`GET /saved/job/{id}`; Seite: "Messung laden…", Banner "Geladen … / Zurück zur Live-Ansicht", Polling pausiert. Desktop: `LoadRunDialog` (Fortschritt über
`_Job`), `SensorLiveWindow._loaded`/`_view()`.
**Live: Pause + Protokoll** (2026-11-25, beide Apps, Nutzerwunsch "wie eine kleine Doku", Variante B): "⏸ Pause"/"▶ Weiter" in derselben Messung
und Datei (`LiveSession.pause/resume`: keine Meter, nichts in Datei/Merk-Puffer, angefangenes Fenster verworfen über den Queue-Marker `_RESET`; Pause =
eine Meterstelle, grau gestrichelt). Maschine vor dem Start wählen (`machine_id`); "✎ Änderung…" pausiert NICHT und trägt beim aktuellen Meter ein:
Machine-Data-Felder der Maschine (`live_log.field_catalog`: Housing/Jet/Jet Plate/Air + `tblMachineFields`, Dropdowns über `machine_data.lookup_map`,
Prüfung wie Kopieren `trial_copy.normalize_value`), freie Felder (Name ≤ 40, Wert ≤ 60), Notiz; alter -> neuer Wert, Löschen rechnet die alten Werte neu.
Logik `ui/yarnscope/live_log.py` (`LiveLog`, `summary`); `pauses`/`machine`/`changes` in `view()` und in der Zusatzdatei (nach dem Lauf neu geschrieben),
`load_saved` zeigt sie wieder. Blaue Linien + Kurztext in den Diagrammen, Liste "Protokoll". Web `/api/yarnscope-live/pause|resume|fields?machine=|machine|change`,
DELETE `/change/{id}` (Pause/Weiter nur Starter oder Superuser, Protokoll ab Recht Versuche bearbeiten); Seite `ChangeDialog` in `YarnScopeLive.tsx`. Desktop
Knopf + Maschine + Protokoll-Tabelle in `sensor_live_window.py`, `ChangeDialog`. Tests: Desktop `test_sensor_live.py::test_pause_resume_and_change_log`,
`::test_desktop_pause_and_change_dialog`; Web `test_sensor_live_api.py::test_pause_and_change_log`. Idee offen: Versuchswerte aus dem Protokoll vorbelegen.

**Einstellungen** (2026-11-13): `/settings` (Konto-Menü im Seitenleisten-Fuss), `app/settings_api.py` auf `db/user_account.py` +
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
Hilfetexte gibt es seit 2026-11-16 in EN/DE/ES/ZH (Nutzerwunsch: Chinesisch nicht nur teilweise; gilt auch für Fresh off
the Spool): eigene Flaggen im Dialog, Sprache in localStorage `tripplet.helpLang`; die Fensterbeschriftung kommt aus `texts.ts`
(`help.*`). Neue/geänderte Hilfetexte immer in allen 4 Sprachen; Prüfung `python tools/check_help_translations.py zh` (Desktop-Repo,
vergleicht Struktur, Platzhalter, Skizzen und Knopf-Marker mit Englisch). Hilfesuche mit Chinesisch: `help_index.tokens` zerlegt
chinesischen Text in Zwei-Zeichen-Stücke (kein Leerzeichen zwischen Wörtern).
Neue Seite mit Desktop-Hilfe: `HelpButton` einbauen und Route in `help.WEB_ROUTES` eintragen. Tests `tests/test_help.py`.

## Offene Punkte

- ✅ **DB-Änderungen auf dev/prod am 2026-11-16 ausgeführt** (Nutzerfreigabe): `tblCanvasBoard` und `tblSeriesConclusion` auf dev +
  prod angelegt, `tblSmartChartView.ConfigJSON` auf prod MEDIUMTEXT (dev hat keine `tblSmartChartView` - dort übersprungen).
  Neue DB-Änderungen: Migrationsskript unter `tools/` (status/apply/rollback, `--target`, `TRIPPLET_MODE`), zuerst dev_local,
  dev/prod nur auf ausdrückliche Freigabe; hier auflisten. Ordner auf der Freigabe legen die Apps selbst an (UserAvatars, CanvasFiles).

- **Nächste Schritte in dieser Reihenfolge** (Nutzerentscheid 2026-11-13): 1. ✅ F1-Hilfe / Kontext-Hilfe (ohne Ask AI)
  (siehe "Hilfe" unten), 2. ✅ YarnScope ergänzen (Trends/Prozesswelle, Prozessvergleich, ATY + Batch), 3. ✅ Manage Jets, ✅ Manage Yarn, ✅ Yarn Stock + Inventur + Hilfe (siehe unten). Danach (Nutzerentscheid
  2026-11-13): ✅ PARITY aufgeräumt, ✅ Lücken Backlog/All Experiments/Show Experiment, ✅ Manage User, ✅ Settings, dann
  nacheinander die Werkzeuge (✅ alle, zuletzt Process Playground und Requirement Hub, 2026-11-13). **Kleinkram für später** (nicht vergessen): weitere PARTIAL/MISSING-Zeilen in `PARITY.md`.

**Fazit pro Serie** (2026-11-14, beide Apps, Nutzerwunsch): `db/series_conclusion.py` + Tabelle `tblSeriesConclusion` (eine Zeile pro
Serie, nur über `tools/series_conclusion_migration.py`, dev_local, dev und prod angelegt 2026-11-16). Nicht an einen Statuswechsel gebunden
("Done" = bereit zur Auswertung). Felder: eigenes Ziel (nur ohne Experiment-Anfrage; mit Anfrage werden Titel/Versuchsgrund/Aufgabe/
Beurteilung gezeigt), Ergebnis achieved/partly/not_achieved/open, Kurzfazit (300 Z.), beste Versuche, Erkenntnisse, Empfehlung
follow_up/release/discard + Text. Schreiben ab Stufe 2, Änderungsprotokoll (Source `conclusion`), erstes Speichern = Glocke an den
Request-Ersteller (Typ `series_conclusion`, Klick -> `?tab=conclusion`). Papierkorb nimmt es über `TrialSeriesID` automatisch mit.
Web: `app/conclusion_api.py` (GET/PUT `/api/series/{id}/conclusion`), Reiter "Fazit" (`components/ConclusionTab.tsx`, bleibt nach dem
ersten Öffnen gemountet, `extraLeaveGuard` in `edit.tsx` fragt beim Verlassen), Punkt/gestrichelter Ring (Done ohne Fazit) auf Backlog-Karten,
Spalten Ergebnis/Fazit + Filter in All Experiments, Feld "Fazit" in der Schnellsuche (`quick_search._search(..., conclusions)`),
Ergebnisse im Request-Popup (`for_request`), Archivieren ohne Fazit: `POST /api/backlog/move` -> 409 `no_conclusion`, erneut mit
`ignore_conclusion`. Desktop: `ui/widgets/conclusion_tab.py` (Reiter "Conclusion" rechts von Notes), Backlog-Karte, All Experiments
(Spalten 10/11 + Filter), Quick Search 5. Feld, Request-Popup, Hinweis beim Archivieren. Tests: Desktop `test_series_conclusion.py`,
Web `test_conclusion_api.py`.
**Fazit im Report** (2026-11-16, beide Apps über die gemeinsame Report-Seite): Knopf "✅ Conclusion" in `ui/report_html_template.py`
zeigt die Fazits aller Serien der Seite (Haupt- + Vergleichsserien) über den Diagrammen; Slot `loadConclusions` ->
`series_conclusion.for_report()` (Desktop `screen_report.py` @Slot, Web `web_bridge.js` + Prüfung in `report.py`: nur Liste von
höchstens 20 Ganzzahlen). Ein/aus wird in `queryConfig.showConclusion` des Reports gespeichert (keine DB-Änderung). PDF: die Seite
schickt nur `conclusionSeries` (IDs), `build_report_pdf` liest die Fazits frisch aus der DB (`report_text`), Abschnitt nach "Observations".
**Effektive Knoten im Report** (2026-11-20, beide Apps über `ui/report_queries.py`): Y-Achsen "FPm effective@0.3/0.6/1.0/1.3cN/dtex" (FP/m,
Schlüssel `fpm_eff_03…13`) = FP/m bei 0 × Stability(t) / 100, beim Lesen gerechnet (`effective_fpm_values`, virtuelles Feld
`FPmEffective`, Itemat Lab, sonst Plus) - auch wo das gespeicherte FPm der Kraft-Zeile fehlt (~870 Lab-Messungen 2026). Keine Zeilen in
`tblSmartChartAxis`: `with_effective_fpm_axes()` hängt sie in `_load_axes_from_db` hinter die Stability-Achsen; Smart Chart
(`trial_explorer`, `computed: fpm_effective`) bekommt sie mit. Tests Desktop `test_report_effective_fpm.py`.

**Links, Live-Backlog, Tooltips** (2026-11-14): Links **nur im Web** (Nutzerentscheid 2026-11-14: im Desktop nicht nötig) -
`frontend/src/links.ts` (`/series/<id>?tab=<key>&trial=<id>`, `/series/<id>/report?report=<id>`, `/tools/canvas?board=<id>`; Reiter-Schlüssel
machine/rd/notes + `LAB_TABS`): "🔗 Link" in Show Experiment, "Link zu V… kopieren" im Versuchsmenü, "Link kopieren" im Rechtsklick von
Backlog/All Experiments, Report, Canvas-Brett; Show Experiment liest `?tab=`/`?trial=` (Spalte leuchtet, `flashTrial`).
Backlog aktualisiert sich selbst (beide Apps): `series_overview.backlog_fingerprint()` (~3 ms), Web pollt `GET /api/backlog/stamp` alle 30 s +
beim Zurückkommen in den Tab, Desktop `BacklogScreen._live_check` (QTimer 30 s); neu geladen wird nur bei Änderung, nicht beim Ziehen/offenem
Dialog/Menü.
Tooltips Düse/Spule in Machine Data/R&D jetzt als schneller Kasten (`EditCell hoverTip` -> `HoverImage`, 0,25 s) statt Browser-`title`.

- **YarnScope (DTY/ATY) muss ins Web** (Nutzerentscheid 2026-11-13, "schon ziemlich wichtig"): Berechnungen
  Qt-frei teilen, Server rechnet + schickt ausgedünnte Kurven, Plotly zeichnet, Garngraf im Browser neu aus
  Server-Daten. Zuerst DTY, dann ATY. TDMS liegen auf `H:\Technik\TrippleT\YarnScopeTDMS` bzw. `...\ATYtdms`
  (auf dem PC des Nutzers erreichbar).
- **Liste für die IT (späterer Intranet-Server):** VM/Server mit HTTPS; Lesezugriff des Dienstkontos auf die
  Freigaben für YarnScope-TDMS und Serien-Anhänge (Bilder/PDFs, `\\heb-fil-003\heberlein\technik\tripplet\...`
  = `H:\Technik\TrippleT\...`); evtl. Firmen-Login.

- Beim Desktop-Login laufen zusätzlich Draft-Request-Bereinigung und Athena-Token-Reset –
  im Web noch nicht (erst relevant mit Experiment Requests bzw. KI-Funktionen).
