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
  `feature_access.rules_for()` (Rechte für beliebigen Benutzer).
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
3. Experiment Requests (Create + My Requests) – erster Schreib-Teil
4. Show Experiment bearbeiten (Undo, Bulk Edit, Notizen, Plausibilität), Create Experiment,
   Add Trial Series, Add Lab Machines
5. Bereits Web-nahes: Knowledge Base, Hilfen, Yarn Count, Dashboards/Report
6. Tools später oder bewusst Desktop-only

## Offene Punkte

- Passwort ändern gibt es im Web noch nicht (Login mit Passwort = Benutzername wird mit
  Hinweis auf die Desktop-App abgewiesen).
- Beim Desktop-Login laufen zusätzlich Draft-Request-Bereinigung und Athena-Token-Reset –
  im Web noch nicht (erst relevant mit Experiment Requests bzw. KI-Funktionen).
