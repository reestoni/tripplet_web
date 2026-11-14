# TrippleT Web – Installation auf der VM und Entwicklungsablauf

Stand 2026-11-14. Skripte in `deploy/`. Noch **nicht freigeschaltet**: Die Web-App startet nur mit
`dev_local` (`ALLOWED_MODES` in `backend/app/core.py`). Für den Betrieb auf der VM gegen `dev` bzw. `prod`
wird diese Zeile auf ausdrückliche Freigabe erweitert.

## Überblick

```
Browser (Firmennetz)
   │  https://tripplet.heberlein.local        https://tripplet-test.heberlein.local
   ▼
┌──────────────────────── Windows-VM ────────────────────────────────────────┐
│ Caddy (oder IIS)  :443  HTTPS, Zertifikat der Firmen-CA                    │
│     │ 127.0.0.1:8000                     │ 127.0.0.1:8100                  │
│ Dienst TrippleTWeb-prod              Dienst TrippleTWeb-test               │
│   TRIPPLET_MODE=prod                   TRIPPLET_MODE=dev                   │
│   Release A                            Release B (neuer, wird getestet)    │
│ C:\TrippleTWeb\releases\<Release>\{core, web}   (mehrere nebeneinander)    │
└────────────┬───────────────────────────────┬───────────────────────────────┘
             ▼                               ▼
     MySQL prod / dev (10.50.212.60)   Fileserver \\heb-fil-003\heberlein (= H:)
```

- Die App lauscht nur auf 127.0.0.1. Von aussen erreichbar ist nur der HTTPS-Proxy auf derselben VM.
- **Ein Prozess pro Instanz, mit Absicht.** Offene Papierkorb-Vorschauen, Smart-Chart-Sitzungen und
  YarnScope-Analysen leben im Serverprozess. Für ca. 10 Benutzer reicht das gut.
- Ein Release enthält **beide** Repos im committeten Stand: `core` = tripplet_project, `web` = tripplet_web
  inkl. gebautem Frontend. Der Server braucht deshalb weder Git noch Node, nur Python.

## Was die IT bereitstellen muss

1. **VM** mit Windows Server 2022, 4 Kerne, 16 GB RAM, 100 GB Platte.
2. **Python 3.12** (64 bit) auf der VM, dazu `nssm.exe` (nssm.cc) und `caddy.exe` (caddyserver.com) nach
   `C:\TrippleTWeb\tools\`. Statt Caddy geht auch IIS mit ARR, falls die IT das lieber hat.
3. **Dienstkonto** in der Domäne, z. B. `HEB\svc-tripplet`:
   - Lesen + Schreiben auf `\\heb-fil-003\heberlein\Technik\TrippleT` (Anhänge, Request-Bilder,
     Düsen- und Top-Plate-Dateien);
   - Lesen auf `...\TrippleT\YarnScopeTDMS`, `...\TrippleT\ATYtdms`, `\\heb-fil-003\heberlein\Technik\YarnScope\models`.
4. **Firewall:** VM → MySQL 10.50.212.60:3306. Clients im Firmennetz → VM:443.
5. **DNS-Namen** `tripplet` und `tripplet-test` auf die VM, mit **Zertifikaten** der Firmen-CA.
6. **DB-Konto für den Web-Dienst.** Empfohlen ist ein eigenes Konto mit den gleichen Rechten wie das
   Desktop-Konto. Es wird von dir mit `encrypt_db_secrets.py` in `db_secrets.enc` geschrieben.
7. **Python-Pakete aus dem Internet (PyPI):** einmalig bei der Installation und bei neuen Paketversionen.
   Alternativ einen internen Proxy/Spiegel eintragen.

## Einmalige Installation

1. Auf deinem PC ein Release bauen:

   ```powershell
   C:\python\tripplet_web\deploy\build_release.ps1
   ```

   Das Skript prüft, dass in beiden Repos alles committet ist. Dann laufen die Backend-Tests, das Frontend
   wird gebaut, und es entsteht `C:\python\tripplet_releases\tripplet-web_<Datum>_<Commit>.zip`. Mit
   `-OutDir "\\...\TrippleTWeb\releases"` geht das ZIP direkt auf eine Freigabe, die die VM sieht.
2. Auf der VM die Zugangsdaten ablegen. Diese gehören nie in ein Release:
   - `C:\ProgramData\TrippleT\db_secrets.enc`
   - `C:\ProgramData\TrippleT\secrets.enc` (Master-Key)

   Danach die Rechte des Ordners auf Administratoren und das Dienstkonto beschränken.
3. Auf der VM in einer PowerShell als Administrator, aus dem entpackten ZIP heraus
   (`web\deploy\server\install.ps1`):

   ```powershell
   .\install.ps1 -Instance test -Port 8100 -Zip D:\drop\tripplet-web_....zip -ServiceUser "HEB\svc-tripplet"
   ```

   Das legt Folgendes an:
   - `C:\TrippleTWeb\venv` (Python-Pakete),
   - `instances\test\web.env`,
   - den Dienst `TrippleTWeb-test`,

   und installiert anschliessend das Release.
4. `C:\TrippleTWeb\instances\test\web.env` prüfen: Modus `dev`, Port, Laufwerk H:, eventuell
   Testordner. Danach `Restart-Service TrippleTWeb-test`.
5. Caddy einrichten: `deploy\server\Caddyfile.example` nach `C:\TrippleTWeb\Caddyfile` kopieren, Namen und
   Zertifikate anpassen, dann als Dienst starten (`nssm install Caddy ...`).
6. Später die echte Instanz gleich anlegen. `web.env` steht dann auf `prod`, ohne Instanzname:

   ```powershell
   .\install.ps1 -Instance prod -Port 8000 -Zip ... -ServiceUser "HEB\svc-tripplet"
   ```

**Laufwerk H:** In der DB stehen Anhang-Ordner als `H:\Technik\TrippleT\...`. Ein Dienst sieht die
H:-Verbindung der Benutzer nicht. Deshalb verbindet `run_server.ps1` H: für den Dienstprozess selbst
(`TRIPPLET_MAP_DRIVE=H:=\\heb-fil-003\heberlein`, mit den Rechten des Dienstkontos). Neue Ablageorte lassen
sich zusätzlich pro Ordner über `TRIPPLET_DIR_*` setzen (`db/file_roots.py`). Die Daten bleiben auf dem
Fileserver: Dort sind sie gesichert, und Desktop und Web sehen denselben Stand.

**Test-Instanz und Dateien:** Mit `TRIPPLET_MODE=dev` gilt Folgendes:
- Neue Uploads gehen standardmässig nach `C:\ttt\...` auf der VM. Das ist ein Testordner, den du in `web.env`
  umbiegen kannst.
- Vorhandene Anhänge aus der kopierten DB werden weiterhin von H: gelesen.
- So kommt nichts aus dem Test in die echte Ablage.

## Neue Version ausliefern

```powershell
# 1. PC: committen (beide Repos), Release bauen
C:\python\tripplet_web\deploy\build_release.ps1 -OutDir \\...\TrippleTWeb\releases
# 2. VM: erst auf die Test-Instanz
C:\TrippleTWeb\scripts\update.ps1 -Instance test -Zip \\...\releases\tripplet-web_20261120-1600_abc1234.zip
# 3. testen auf https://tripplet-test...  -> gut? Dasselbe Release auf prod:
C:\TrippleTWeb\scripts\update.ps1 -Instance prod -Release tripplet-web_20261120-1600_abc1234
# Problem? In Sekunden zurück:
C:\TrippleTWeb\scripts\update.ps1 -Instance prod -Rollback
# Übersicht
C:\TrippleTWeb\scripts\update.ps1 -List
```

`update.ps1` erledigt Folgendes:
- Es entpackt das Release neben die alten.
- Es installiert geänderte Python-Pakete.
- Es merkt sich die vorige Version, startet den Dienst neu und wartet auf `/api/health`.
- Es behält die letzten 8 Releases.

Die Benutzer merken davon einen Neustart von 10–20 s. Am besten über Mittag oder abends ausliefern.
Ungespeicherte Eingaben in einer offenen Seite bleiben im Browser erhalten. Offene Smart-Chart-Sitzungen
oder YarnScope-Analysen müssen danach neu geladen werden.

Welche Version läuft: Fährt man in der Seitenleiste mit der Maus über „HEBERLEIN · WEB …“, erscheint ein
Tooltip mit Datum und beiden Commits. Dieselben Angaben liefert `https://.../api/health`.

## Entwickeln, ohne dass die Benutzer betroffen sind

Drei Stufen. Erst wenn eine Stufe gut ist, geht es zur nächsten:

| Stufe | Wo | Datenbank | Wer |
|---|---|---|---|
| 1. Entwickeln | dein PC, `start_dev.ps1` | `dev_local` (lokale Kopie) | du (+ Claude) |
| 2. Test | VM, Instanz `test` | `dev` | du + 1–2 Testpersonen |
| 3. Betrieb | VM, Instanz `prod` | `prod` | alle |

- **Die Benutzer sehen nur, was du mit `update.ps1 -Instance prod` auslieferst.** Was auf deinem PC passiert,
  auch Commits, ändert auf der VM nichts. Jedes Release bringt seine eigene Kopie von `tripplet_project` mit,
  deshalb wirkt auch eine Desktop-Änderung im gemeinsamen Code erst mit dem nächsten Web-Release.
- **Git:** `main` = Stand, der ausgeliefert werden kann. Grössere Arbeiten in einem Zweig
  (`feature/<name>`, in beiden Repos gleich benannt), erst nach dem Test auf `main` zusammenführen. Releases
  nur von `main` bauen. Empfehlung: beide Repos zusätzlich auf einen Git-Server der Firma oder als
  Bare-Repo auf eine Freigabe pushen. Heute liegen sie nur auf deinem PC.
- **Dringende Korrektur (Hotfix):** von `main` aus korrigieren, Release bauen, kurz auf `test`, dann `prod`.
  Ein Feature-Zweig, der noch nicht fertig ist, bleibt davon unberührt.
- **Datenbank-Änderungen sind der heikle Teil.** Desktop, Web-Test und Web-Prod laufen eventuell gleichzeitig
  in verschiedenen Versionen auf derselben DB. Deshalb gilt:
  - Schemaänderungen nur **ergänzend**: neue Spalte mit Default, neue Tabelle, Spalte vergrössern.
  - Spalten umbenennen oder löschen erst, wenn keine alte Version sie mehr braucht.
  - Reihenfolge: erst `dev_local`, dann `dev` (Test-Instanz), dann `prod`, jeweils mit deiner Freigabe.
  - Das Release, das die neue Spalte nutzt, kommt erst nach der Schemaänderung auf prod.
- **Bis der Desktop eingestellt wird**, kommt jedes Feature in beide Apps (siehe `CLAUDE.md`). Für die
  Desktop-Benutzer gilt weiter der bisherige Weg (exe-Build). Die Web-Benutzer bekommen die Änderung mit
  dem nächsten Release.
- **Testpersonen** arbeiten auf `tripplet-test`. Der Badge in der Seitenleiste zeigt dort „TEST · DEV · <DB>“.
  Was dort geschrieben wird, landet nur in der dev-DB.

## Wartung

- **Logs:** `C:\TrippleTWeb\instances\<name>\logs\service.log` (wird bei 10 MB rotiert).
- **Langsame Seiten finden:** Anfragen über 800 ms stehen im Log als `slow request <ms>: GET /api/... -> 200`
  (Schwelle `TRIPPLET_WEB_SLOW_MS` in `web.env`). Jede Antwort trägt ausserdem den Header `Server-Timing`
  (Browser: F12 → Netzwerk → Anfrage → Timing).
- **Dienst:** `Restart-Service TrippleTWeb-prod`. Der Dienst startet nach einem Absturz von selbst neu
  und läuft nach einem VM-Neustart automatisch wieder.
- **Zu sichern:**
  - `C:\ProgramData\TrippleT\`
  - `C:\TrippleTWeb\instances\*\web.env`
  - `C:\TrippleTWeb\instances\*\data\web_secret.key`

  Geht der Sitzungsschlüssel verloren, müssen sich alle neu anmelden, sonst passiert nichts. Alles andere
  lässt sich aus einem Release-ZIP neu aufbauen.
- **Temporäre Uploads** (TDMS Inspector bis 1 GB, Bildvergleich) liegen in `instances\<name>\data\tmp`
  und werden nach einem Tag gelöscht.

## Noch offen (Freigaben)

- `ALLOWED_MODES` in `backend/app/core.py` um `dev` und später `prod` erweitern. Das macht Claude erst auf
  ausdrückliche Freigabe.
- `ConfigJSON` (Smart-Chart-Ansichten) auf dev/prod auf MEDIUMTEXT umstellen
  (`tools/smart_chart_views_migration.py`). Das ist optional.
- Firmen-Login (Windows-Anmeldung) später möglich. Bis dahin gilt die TrippleT-Anmeldung wie im Desktop.
