# Feature parity: TrippleT desktop vs. web

Status 2026-11-13 (snapshot of both working trees incl. uncommitted Qt-free modules in
`tripplet_project/db/`: `series_actions`, `series_yarns`, `trial_actions`, `trial_copy`,
`trial_labels`, `label_sheets`, `lab_pdf_import`). Read-only comparison, nothing was run.

Legend: **DONE** = in the web (file cited) · **PARTIAL** = exists, something missing ·
**MISSING** = not in the web. "Qt-free" = logic already importable from `tripplet_project`
(no PySide6); "Qt" = still inside a Qt file, extract first (desktop rule: never re-implement in the web).

## Summary

| Screen | Done | Partial | Missing | Not in web (on purpose) | Rows |
|---|---|---|---|---|---|
| 1. All Experiments | 22 | 0 | 0 | 0 | 22 |
| 2. Backlog | 31 | 0 | 0 | 1 | 32 |
| 3. Show Experiment | 94 | 3 | 1 | 1 | 99 |
| 4. Report from Show Experiment | 11 | 0 | 0 | 0 | 11 |
| 5. YarnScope | 18 | 0 | 0 | 0 | 18 |
| 6. Experiment Requests | 22 | 2 | 2 | 0 | 26 |
| 7. Login, sidebar, account | 19 | 0 | 0 | 2 | 21 |
| 8. Create Experiment / Add Trial Series / Add Lab Machines | 16 | 0 | 0 | 0 | 16 |
| 9. Manage Jets / New Jet | 14 | 0 | 0 | 0 | 14 |
| 10. Manage Yarn / New Yarn | 12 | 0 | 1 | 1 | 14 |
| 11. Yarn Stock | 16 | 0 | 0 | 0 | 16 |
| 12. Manage User | 7 | 0 | 0 | 1 | 8 |
| 13. Smart Chart / Dashboards | 22 | 1 | 0 | 0 | 23 |
| 14. Tools | 9 | 0 | 0 | 0 | 9 |
| 15. Admin master tables | 4 | 0 | 0 | 0 | 4 |
| 16. Superuser pages | 1 | 0 | 0 | 2 | 3 |
| **Total** | 318 | 6 | 4 | 8 | 336 |

Most important gaps (judgement, updated 2026-11-14): none blocking - jet / spool / housing tooltips are in (quick tooltip box since 2026-11-14), all tools, Admin and Superuser pages too. Athena (AI advisor) stays out like "Ask AI" (web CLAUDE.md).

Desktop paths are relative to `C:\python\tripplet_project`, web paths to `C:\python\tripplet_web`
(`fe/` = `frontend/src/`, `be/` = `backend/app/`).

---

## 1. All Experiments (`ui/screen_all_experiments.py` → `fe/pages/AllExperiments.tsx`)

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Machine filter buttons (All, AFK, eAFK, …) | `_build_ui` / `_on_filter` | **DONE** | chips from `db/series_overview.MACHINE_FILTERS` via `be/series_lists.py` |
| Filter Experiment ID (text) | `_on_expid_filter_change` | **DONE** | client-side |
| Filter Trial Series Name (text) | `_on_series_filter_change` | **DONE** | client-side |
| Columns ExpID/Name/Machine/Created/Owner/Status/AM/ER/NT/RE | `_load_data` | **DONE** | `db/series_overview.all_experiments_rows` |
| Header click = sort asc/desc + indicator | `_on_header_clicked` | **DONE** | same sort keys as `_sort_key` |
| Double-click row opens Show Experiment | `_on_cell_double_clicked` | **DONE** | navigate `/series/:id` |
| Ctrl+double-click = open in new tab | `_open_in_new_window` | **DONE** | Ctrl/Cmd+double-click or middle click → new browser tab (`openSeriesFrom`) |
| Status column = editable dropdown (role-filtered list, saves at once, joker-machine prompt) | `_create_status_combobox` / `_on_status_combo_changed` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| "Copy TrialSeries" button (enabled on row selection) | `_on_copy_trialseries` | **DONE** | right-click menu "Copy trial series…" → `/series/new?copy=<id>` (experiment + jet rows prefilled, 2026-11-13) |
| AM icon + tooltip "Has attachments" | `_set_attach_cell` | **DONE** | |
| ER icon click → read-only Experiment Request popup | `_set_er_cell` / `open_experiment_request_popup` | **DONE** | `RequestIcon` → `fe/components/RequestPopup.tsx` (fields, images, version history) |
| NT icon "Has notes" | `_set_notes_cell` | **DONE** | |
| RE icon click → saved Smart Chart report (Ctrl = new tab) | `_set_report_cell` / `_open_report_icon_for_series` | **DONE** | `ReportIcon` (`fe/components/SeriesLinks.tsx`), Ctrl = new tab |
| Context menu: Open in New Tab / Open in New Window | `_on_table_context_menu` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context menu: Copy link | – | **WEB ONLY** | user decision 2026-11-14 |
| Context menu: Rename Trial Series… (level ≥ 2, prefix kept) | `_rename_trialseries_at_row`, `RenameTrialSeriesDialog` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context menu: Reassign Yarn… (superuser; per ply, add/delete ply, conflicts) | `_reassign_yarn_at_row` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context menu: Change Machine… (superuser) | `_reassign_machine_at_row` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context menu: Delete Trial Series… (recycle bin, mover rights) | `_delete_trialseries_at_row` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Menu entries disabled by permission | `_on_table_context_menu` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Help button "How does All Experiments work?" (EN/DE/ES) | `_open_help` | **DONE** | `HelpButton screen="all_experiments"` |
| Size-dependent scaling, name column fills width | `_update_scale` / `_fit_name_column` | **DONE** | CSS layout |
| Reload on show + sidebar refresh | `showEvent` / `_refresh_sidebar` | **DONE** | load on mount |

## 2. Backlog (`ui/screen_backlog.py` → `fe/pages/Backlog.tsx`)

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Status columns Backlog / In Progress / Done / To Be Cleaned with counts | `_make_card` / `_fill_table` | **DONE** | `db/series_overview.backlog_rows` |
| Card: name + "ExpID • Machine • Status • Prio • Owner" | `CardRowDelegate.paint` | **DONE** | |
| Owner colour stripe (not in Backlog/To Be Cleaned/Archived) | `CardRowDelegate.paint` | **DONE** | `be/series_lists.OWNER_COLOUR_STATUSES` |
| RETEST badge + tooltip with open retest flags | `_fill_table` / `paint` | **DONE** | `series_overview.retest_flags_map` |
| AM / ER / NT / RE icons on card | `paint` | **DONE** | display only (`fe/components/Icons.tsx`) |
| ER icon click → read-only request popup | `BacklogDnDTable.mousePressEvent` | **DONE** | `SeriesIcons` → `RequestIcon` |
| RE icon click → saved report (Ctrl = new tab) | `mousePressEvent` / `_open_report_icon_for_series` | **DONE** | `SeriesIcons` → `ReportIcon` |
| Double-click card opens Show Experiment | `_on_cell_double_clicked` | **DONE** | |
| Ctrl+double-click = new tab | `_on_cell_double_clicked` | **DONE** | Ctrl/Cmd+double-click or middle click → new browser tab |
| Drag & drop card to another status | `startDrag` / `dropEvent` / `_handle_dnd_move` | **DONE** | `POST /api/backlog/move`, `db/backlog_moves` incl. `after_move` (Done notifications) |
| Joker machine → choose real machine | `MachineSelectDialog` | **DONE** | modal in `Backlog.tsx` |
| Rule violation messages | `_handle_dnd_move` | **DONE** | toast `bl.err.<code>` |
| Drop target highlight / drag feedback | `_set_drop_highlight` / `_build_drag_pixmap` | **DONE** | CSS classes |
| Multi-select cards (Ctrl/Shift+click) + move several, one confirmation, summary of failures | `_handle_dnd_move_many` | **DONE** | Ctrl/Shift+click selects in one column; dragging moves all, one confirmation, joker machine asked per card, summary of failures (same `/api/backlog/move` per card) |
| Context: Open in New Tab / New Window | `_open_context_menu` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context: Copy link | – | **WEB ONLY** | `fe/links.ts`, user decision 2026-11-14: links only in the web |
| Live update (reload when someone else changed the Backlog, every 30 s) | `_live_check` (QTimer) | **DONE** | both apps 2026-11-14, `series_overview.backlog_fingerprint`, `GET /api/backlog/stamp`; not while dragging / dialog open |
| Context: Change priority… (0-999) | `_ctx_change_prio` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context: Change status… (role-filtered list) | `_ctx_change_status` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context: Rename trial series… | `_ctx_rename_trialseries` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context: Reassign yarn… (superuser) | `_ctx_reassign_yarn` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context: Change machine… (superuser) | `_ctx_reassign_machine` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context: Delete trial series… | `_ctx_delete_trialseries` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Archived: search | `ArchivedPanel._on_search` | **DONE** | |
| Archived: Year › XX accordion with counts (open while searching) | `_YearGroup` / `_XxGroup` | **DONE** | |
| Archived: double-click open | `_ArchivedSeriesRow.mouseDoubleClickEvent` | **DONE** | |
| Archived: drag back (superuser rules) / drop onto Archived | `_ArchivedSeriesRow.mouseMoveEvent` / `ArchivedPanel.dropEvent` | **DONE** | server checks rules |
| Archived: context menu Open / New Tab / New Window | `_ArchivedSeriesRow.contextMenuEvent` | **DONE** | series menu: Open / Open in new tab / Open in new window |
| Expand a column to full screen (⤢) + Close | `_expand_card` / `_collapse_card` | **DONE** | ⤢ in the column header, ✕ back |
| Welcome message from DB with first name | `_refresh_welcome_message` / `_fetch_welcome_message_from_db` | **DONE** | `/api/backlog` → `welcome` (`db/user_account.load_welcome_message`); default greeting translated |
| Help button "How does the Backlog work?" | `_open_help` | **DONE** | `HelpButton screen="backlog"` |
| Athena sleeping-owl easter egg (5 %) | `_spawn_sleeping_athena` | **NOT IN WEB** | belongs to Athena (AI), which stays out of the web like "Ask AI" |
| Wide/narrow board arrangement | `_arrange_board` | **DONE** | CSS |
| Reload on show; sidebar badge refresh after move | `showEvent` | **DONE** | `tripplet:nav-changed` event |

## 3. Show Experiment (`ui/screen_show_experiment.py` + extracted modules → `fe/pages/SeriesView.tsx`, `fe/components/*`, `fe/edit.tsx`)

### 3a. Header & toolbar

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Series title, machine, status, owner, created, trial count | `_build_ui` / `_load_record_inner` | **DONE** | `be/series_view.py` |
| TrialSeriesID label, machine info label | `_build_ui` | **DONE** | header `se-sid` (click copies the ID) |
| Material line (plies/yarns) with stock symbol; hover = stock tooltip, click = storage locations | `_load_materials_summary` / `_on_material_label_link_hovered/_activated` | **DONE** | `MaterialLine` in `SeriesView.tsx`; `/api/series/{id}/materials` (`db/yarn_spools.series_materials` + `load_stock_summary`), click → `StockDialog` (spools of the series bold) |
| Experiment Request icon → read-only popup (+ images, version history) | `_open_experiment_request_popup`, `_ExperimentRequestReadOnlyDialog` | **DONE** | `RequestIcon` in the header |
| Save button "Save (n)" + Ctrl+S | `_save_all` / `_sc_save` / `keyPressEvent` | **DONE** | `fe/edit.tsx`, `POST /api/series/{id}/save` → `db/series_save` |
| Plausibility check before saving (confirm) | `_confirm_plausible_values` | **DONE** | `db/plausibility.check` |
| Undo Ctrl+Z | `_UndoManager` / `_init_undo` | **DONE** | `fe/edit.tsx` |
| Redo Ctrl+Y / Ctrl+Shift+Z | `_init_undo` | **DONE** | `fe/edit.tsx` |
| Discard unsaved | Save/Discard/Cancel prompt | **DONE** | "Discard" button |
| Unsaved mark on tab (dot) | `_apply_unsaved_tab_mark` | **DONE** | `dirty-dot` on the tab |
| Prompt Save/Discard/Cancel on leaving (tab close, back, series switch, logout, exit) | `confirm_close_with_unsaved` / `_back_all_experiments` / `closeEvent` | **PARTIAL** | `confirmLeave()` + link guard in `edit.tsx` (OK/Cancel instead of Save/Discard/Cancel; browser back not guarded) |
| Refresh ↻ / F5 | `_on_refresh` | **DONE** | button ↻ + F5 in `SeriesView.tsx` (2026-11-16): reloads every table, keeps the tab, asks if unsaved |
| Back to list | `_back_all_experiments` | **DONE** | back arrow (`navigate(-1)`) |
| Show attached images (gallery) | `_open_series_images_dialog` | **DONE** | `Attachments.tsx`: upload, rename, delete, big view with prev/next, zoom, fit, 100 %, rotate, save as |
| Show attached PDFs | `_open_series_pdfs_dialog` | **DONE** | `Attachments.tsx`: upload, rename, delete, open |
| Upload images | `_upload_series_images` / `_insert_trialseries_image_row` | **DONE** | `be/uploads.py`, `fe/components/Attachments.tsx`, `db/series_uploads.py` (2026-11-13) |
| Garnspiegel CV analysis of uploaded images | `_analyze_and_save_garnspiegel` | **DONE** | `db/series_uploads.analyze_garnspiegel` on upload (2026-11-13) |
| Upload PDFs | `_upload_series_pdfs` / `_insert_trialseries_pdf_row` | **DONE** | `be/uploads.py` (2026-11-13) |
| Statimat import (from attached PDFs, preview, write, change log) | `_statimat_import` (`screen_show_experiment_pdf_import.py`) | **DONE** | `fe/components/SeriesTools.tsx` PdfImportDialog, `be/series_tools.pdf_import` (write access like the desktop buttons) |
| Itemat import | `_itemat_import` | **DONE** | same as Statimat |
| Report button | `_open_report` | **DONE** | `/series/:id/report` |
| Saved reports dropdown + "Go!" | `_refresh_saved_reports_dropdown` / `_open_selected_saved_report` | **DONE** | `SavedReports` in the header (only with saved reports; Ctrl+click = new tab) |
| Print trial labels (V-numbers, range) → PDF | `_on_print_trial_labels` | **DONE** | LabelsDialog (range, start cell, template, save template) → PDF in new tab |
| Add empty trial (→ Create Experiment "add trials") | `_add_empty_trial` | **DONE** | "+T" button in the Machine Data tool bar (2026-11-13) |
| "+ Ref" add reference sample | `_add_reference_sample` | **DONE** | header button + trial menu |
| "vs Ref / Target" compare dialog (criteria, tolerances, own targets, saved sets, only-passing filter) | `_open_ref_compare` (`ui/ref_compare_dialog.py`) | **DONE** | RefCompareDialog, `be/series_tools.ref_compare` (same `ui/ref_compare.py`); "Only trials that meet all criteria" filter |
| "Copy trials" button / dialog (block/row repeat, field overrides) | `_on_copy_trials_button` (`ui/copy_trials_dialog.py`) | **DONE** | CopyTrialsDialog, `be/series_tools.copy_trials_ep` |
| "Yarns…" dialog (plies of the series: add ply, trial output, change yarn, ends, remove) | `_open_series_yarns` (`ui/series_yarns_dialog.py`) | **DONE** | YarnsDialog, `be/series_tools.yarns_apply`; "+ Trial output" = `/yarns/trial-search` + `/yarns/trial-output` (`get_or_create_shadow_yarn`) |
| Help button (EN/DE/ES) | `_open_help` | **DONE** | `HelpButton screen="show_experiment"` |
| Read-only for access level ≤ 1 | `_get_access_level` / `_sync_save_button_access` | **DONE** | `canWrite = accessLevel >= 2` |
| Recycle-bin preview mode (read-only series) | `set_recycle_preview` | **DONE** | banner + read only via `recycle_preview` (2026-11-13) |

### 3b. Tabs

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Machine Data: Single Plies / Groups / Compact | `_build_machine_tab` / `_on_view_mode_changed` (`ui/machine_tab.py`) | **DONE** | `fe/components/MachineTable.tsx`, `db/machine_data.build_machine_data` |
| Machine Data "Show:" column filter (checkboxes) | `_apply_mat_column_filter` | **DONE** | |
| Two header rows (trial span, ply with yarn colour) | `machine_tab` spans | **DONE** | |
| Unused DTY process rows hidden | `machine_row_visibility.apply` | **DONE** | `md.process_hidden_rows` |
| Custom Group row hidden by default, toggle | `_toggle_custom_group_row` | **DONE** | |
| R&D Machine Data tab | `_build_rd_machine_tab` | **DONE** | `GET /api/series/{id}/rd` |
| DTY/ATY Schema panel ("Schema" button, stations, speeds, merge warnings, click station = highlight rows) | `ui/dty_schema_panel.py`, `ui/aty_schema.py` | **DONE** | `fe/components/SchemaPanel.tsx`, `be/schema.py`, `db/machine_schema.py` (2026-11-13; KB opens as page, not popup) |
| All lab tabs (Titer, Statimat M/DS, Waterbath, EKB, 3x Shrinkage, Rapid 600, Itemat Lab/Plus, DTYoMat, ATYoMat) | `_ensure_*_tab` / `_build_*_tab` | **DONE** | `db/series_tables.LAB_TABS` |
| Info rows Jet / Jet Plate / Air Pressure on lab tabs | `_get_jet_info_rows` | **DONE** | `series_tables.jet_info_rows` |
| Red/orange CV-limit alerts + legend | `cell_alert` / `cv_limit_alert` | **DONE** | |
| Titer alert carried to Statimat DS | `_apply_titer_alert_to_stat_ds` | **DONE** | assumed via `LAB_TABS` (web CLAUDE.md: 0 deviations) |
| Retest flag: dot on tab + header tooltip | `_apply_lab_retest_flags` | **DONE** | |
| Retest banner above lab table | `_make_retest_banner` | **DONE** | `se-retest` banner from the tab's `retest` list (`series_view._flags`) |
| Itemat recompute after save | `_recompute_itemat_intermingling` / `_recompute_itemat_plus` | **DONE** | server `series_save.save_series_edits` |
| Jet Air Consumption: 3 grids, unit Nm³/h ↔ l/min, editable | `_build_jet_air_tab` / `_on_jet_air_unit_changed` | **DONE** | `fe/components/JetAirView.tsx` |
| Jet Air: "Sync physical jets" | `_sync_jet_air_physical_jets` | **DONE** | `/jet-air/sync-plan` + `/jet-air/sync` on `db/jet_air_sync`; only with no unsaved jet air values |
| Jet Air: "Apply to all" for atm / temperature | `_fill_all_jet_air` | **DONE** | `JetAirView` fill field per grid (marks the cells unsaved) |
| Notes tab: series free-text notes, auto-save | `_load_notes` / `_on_notes_text_changed` / `_save_notes` | **DONE** | `SeriesNotes` in SeriesView (auto-save 1.5 s + blur) |
| Notes tab: list of all notes on values | `cell_notes_ui` (Notes tab list) | **DONE** | `SeriesView.tsx` notes table |
| Athena (AI advisor) tab: wake, chat, reset | `ui/advisor_tab.py` | **NOT IN WEB** | AI stays out of the web (user decision 2026-11-13, like "Ask AI") |
| DTY YarnScope tab | `ui/dty_yarnscope_tab.py` | **DONE** | see section 5 |
| ATY YarnScope tab | `ui/aty_yarnscope_tab.py` | **DONE** | see section 5 |
| Last tab remembered | `_remember_tab` / `_restore_last_tab` | **DONE** | localStorage |
| Lazy tab population | `_defer_or_populate` | **DONE** | jet air lazy |

### 3c. Editing & selection

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Edit values (text, dropdown rows Housing/Jet/lookups) | `PivotEditModel.setData`, delegates | **DONE** | `EditCell` in `fe/edit.tsx` |
| Input validation / normalisation (air pressure rule, IDs), invalid cells marked | `_validate_and_normalize` | **DONE** | `db/series_save.normalize_input` |
| Yellow unsaved cells | `_set_dirty_value` | **DONE** | |
| Excel-like keys (Enter/F2/typing/arrows/Tab/Esc) | `_GridView.keyPressEvent` | **DONE** | |
| Copy Ctrl+C (TSV) | `_enable_copy_for_table` | **DONE** | |
| Paste Ctrl+V (block / one value into selection) | `_enable_paste_for_table` | **DONE** | |
| Delete/Backspace clears selection | `_clear_selected_cells` | **DONE** | |
| Range selection (Shift / Ctrl) | Qt selection | **DONE** | |
| Groups view writes all plies of the group, orange if different | `GroupCellBinding` | **DONE** | server binding + `cell_alerts` (assumed) |
| Change log, DY ratio, tension timestamps, multi-ply tracking on save | `_save_all` / `_stamp_trial_timestamp` / `_track_multi_ply` | **DONE** | `db/series_save.save_series_edits` |
| Zoom Ctrl+wheel / Ctrl+± / Ctrl+0 | `FrozenFirstColumnTable` shortcuts | **PARTIAL** | browser zoom only |
| Display prefs: text size, contrast stripes, crosshair | `display_prefs` / `_pass_display_to_model` | **DONE** | `fe/display.tsx` (contrast, crosshair, reading bar, warning symbols, colour-blind colours, Ctrl+wheel table zoom) from `tblUser.DisplaySettings` via `be/settings_api.py`; text size = browser zoom |
| Save conflicts (cell changed by someone else since loading) | `_confirm_no_conflicts` + `series_save.find_conflicts` | **DONE** | `edit.tsx` dialog, `orig` per edit, `overwrite` (2026-11-16) |
| Read bar (parameter + value of current cell, warning) | `read_bar_text` | **DONE** | `display.tsx` ReadBar (desktop style, ! Warning / ! Check), Settings "Lesezeile" |
| Frozen first column / header while scrolling | `FrozenFirstColumnTable` | **DONE** | sticky CSS (assumed in styles.css) |

### 3d. Context menus

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Value: Add note… / Notes (n)… (add, edit own, delete own/superuser) | `cell_notes_ui.add_cell_note_actions` | **DONE** | `NotesDialog`, `be/series_actions.py` → `db/cell_notes` |
| Value: Change history… (superuser), "whole series" checkbox | `_add_cell_history_action`, `change_history_dialog.py` | **DONE** | `HistoryDialog` → `db/change_log` |
| Value / row title / lab header: "Learn more in Knowledge Base" | `kb_links.add_action` / `machine_cell_target` / `table_target` | **DONE** | row title / cell / lab cells → `kbItem` (new tab); routes from `ui/kb_links` via `series_view.kb_url` (DTY Process cell by value); Manage Yarn Material / Garntyp too |
| Value / row title (Machine, R&D): Fill row… (trial range, plies) | `_fill_machine_row_from_title` / `FillDialog` | **DONE** | `db/series_save.fill_range_edits` |
| Row title: Hide row / Hide n rows / Show hidden here / Show all | `machine_row_visibility.add_context_actions` | **DONE** | web stores in localStorage, desktop in QSettings (not shared) |
| "n rows hidden" button with menu | `btn_hidden_rows` | **DONE** | |
| Row title: Show/Hide Custom Group | `_toggle_custom_group_row` | **DONE** | |
| Ply header (row 2) right-click → Yarns dialog | `_manage_plies_for_col_spec_idx` | **DONE** | MachineTable ply row → Yarns… |
| Trial header: click / Ctrl / Shift = select trials | `_GridView.mousePressEvent` | **DONE** | `seriesMenus.clickTrial` |
| Trial header: Add note to Vn / Notes on Vn | `cell_notes_ui.add_trial_note_action` | **DONE** | |
| Trial header: Copy trials… | `_on_trial_header_menu` / `_multiply_trial_from_col_spec_idx` | **DONE** | trial menu (selected trials preselected) |
| Trial header: Open Vn in Process Playground… | `_process_playground_available` | **DONE** | `playground` flag in `/api/series/{id}` (DTY machine + feature, `process_playground_core.series_is_dty`) -> `/tools/process-playground?trial=` |
| Trial header: Add reference sample… | `_add_reference_sample` | **DONE** | trial menu |
| Trial header: Mark Vn as reference / Rename reference / Turn into normal trial | `_set_reference_flag` / `_rename_reference_sample` | **DONE** | trial menu |
| Trial header (ref): Compare trials with this reference… | `_open_ref_compare` | **DONE** | trial header menu `tl.cmpWithRef` |
| Trial header: Delete Vn / Delete n selected trials (blocked if unsaved) | `_delete_trials` / `_trial_delete_blocker` | **DONE** | `DeleteTrialsDialog` → `recycle_bin.delete_trials` |
| Lab trial header: Flag Vn for retest… (superuser) | `_on_lab_header_context_menu` / `_mark_trial_for_retest` | **DONE** | `RetestDialog` → `db/retest_flags` |
| Series change history (trial header menu) | `change_history_dialog` (series checkbox) | **DONE** | web extra entry |
| Compare dialog double-click → jump to trial in Machine Data | `_show_trial_in_machine_data` | **DONE** | `RefCompareDialog onJump` → Machine Data tab, column scrolled into view |
| DTY schema station right-click → KB, double-click | `dty_schema_panel` | **DONE** | `SchemaPanel` (right-click = KB page of the station) |

### 3e. Tooltips & markers

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Reference columns amber, name tooltip | `_apply_reference_columns` | **DONE** | |
| Violet note triangle + note tooltip | `_GridView` / `notes_at` | **DONE** | `has-note` class + `notesTip` |
| Ply header tooltip + yarn colour box | `header_rows["colours"]`, `colour_tooltip` | **DONE** | `MachineTable.tsx` |
| Generic cell tooltips (`md.cell_tooltips`) | `machine_tab` | **DONE** | `cell.tip` |
| Jet tooltip (jet details on JetID rows) | `jets_tooltip_map` | **DONE** | `machine_data` sends `tip` from `jets_lookup.tooltip_map` |
| Spool row tooltips (single plies) | `md.spool_tooltips` | **DONE** | via `md.cell_tooltips` (`db/machine_data`) |
| Housing row: picture tooltip | `_HousingImageTooltipFilter` / `_RDHousingTooltipFilter` | **DONE** | `img` on housing cells → `/api/housing-image/{id}` |
| Copy link to series + open tab / to a trial column (header button, trial right-click); link opens tab and flashes the trial | – | **WEB ONLY** | `fe/links.ts`, also saved reports and Canvas boards; user decision 2026-11-14: not in the desktop |
| Live OF speed tooltip | `machine_tab` ("live OF speed tooltip") | **DONE** | `of_base` per cell, computed live from the typed OF (`ofSpeedTip`); since 2026-11-16 also in Machine Data (RDSetting 2) in both apps |
| Retest flag tooltip on header | `_apply_lab_retest_flags` | **DONE** | |
| Single-ply-trial merge cells locked with tooltip | `machine_tab` | **DONE** | non-editable cells (no tooltip text) |

## 4. Report from Show Experiment (`ui/screen_report.py` mode series → `fe/pages/SeriesReport.tsx`, `be/report.py`)

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Whole report page (charts, layout, X/X2 axes, notes, references, drill-down, free fields) | `report_html_template.py` | **DONE** | same page in iframe, slots via `db/report_service.handle` + `be/static/web_bridge.js` |
| All bridge slots (series list/data, visual query, report save/load/delete, layout + PDF templates, free fields) | `_ReportBridge` | **DONE** | `rs.SLOTS`; free-field / query inputs hardened in `be/report.py` |
| Add image (file picker) | `addImage` (QFileDialog) | **DONE** | browser file input |
| Copy chart image to clipboard | `copyImageToClipboard` | **DONE** | `navigator.clipboard` (needs secure context on intranet) |
| Export PDF | `exportPdf` (save dialog) | **DONE** | server `rs.build_report_pdf`, download |
| JS error reporting | `jsError` (message box) | **DONE** | logged on server |
| Open a saved report directly | `load_series(initial_report_id)` | **DONE** | `?report=` |
| Experiment Request icon in report header → popup | `_refresh_experiment_request_link` / `_open_experiment_request_popup` | **DONE** | `RequestIcon` in the report header |
| Help button "How does the Report work?" | `_open_help` | **DONE** | `HelpButton screen="report"` |
| Back to Show Experiment | `_go_back` | **DONE** | |
| Open report in new tab (Ctrl+click from lists) | `main._open_report_in_new_tab` | **DONE** | `ReportIcon` (Ctrl / middle click = new tab) |

## 5. YarnScope (`ui/dty_yarnscope_tab.py`, `ui/aty_yarnscope_tab.py` → `fe/components/YarnScopeView.tsx`, `YarnScopeBatch.tsx`, `be/yarnscope.py`)

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| DTY: trial list with file / analysed state | `_ys_populate_trial_list` | **DONE** | `dty_service.trial_files` |
| DTY: Analyse trial (▶ Analyse) | `_ys_on_analyze` | **DONE** | analyses on click |
| DTY: metric cards (FP/m, CV, KL, OL, A/B/C) + A/B/C pie | `_ys_update_metrics` | **DONE** | |
| DTY: Save to DB (level ≥ 2) | `_ys_on_save` | **DONE** | `dty_service.save_analysis` |
| DTY: ⚡ Batch (only pending, save, stop, progress, result table) | `_ys_open_batch` | **DONE** | `YarnScopeBatch.tsx` |
| DTY: Segmentmittel plot (open/knot segments, thresholds) | `_ys_draw_plots` | **DONE** | `dty_service.segment_view_json` |
| DTY: Signal plot | `_ys_draw_signal` | **DONE** | |
| DTY: Garnspiegel | `_ys_draw_garnspiegel` | **DONE** | canvas |
| DTY: Start [m] / Window [m] | `ctrl_row` | **DONE** | window free 0.1–100 m like the desktop spin box (presets as suggestions) |
| DTY: trend "Mitte Offenstelle–Knoten" + rolling mode/amount | `_ys_chk_delta_trend` | **DONE** | `segment?open_knot=Meter:1` → `segment_view(open_knot=...)` |
| DTY: trend "Mitte Peak–Tal" + rolling | `_ys_chk_peak_valley_trend` | **DONE** | `segment?peak_valley=Paare:10` |
| DTY: "Open spot trend" + rolling | `_ys_chk_opening_trend` | **DONE** | `segment?opening=...` |
| DTY: trend metric cards | `_ys_update_trend_metric_card` | **DONE** | `segment_view(with_metrics=True)` → `trends[k].metrics` |
| DTY: "Analyse process wave" + raster [m] + card | `_ys_chk_process_wave` / `_ys_update_process_wave_card` | **DONE** | `segment?wave=0.05` → process mean + sine fit + card (`process_wave_reality_check` is not used by the desktop tab either) |
| DTY: Prozessvergleich (2-6 trials, normalise, process mean, drift lines, open trend, show/hide trial, colours) | `_ys_run_process_comparison` / `_ys_draw_process_comparison` | **DONE** | `fe/components/YarnScopeCompare.tsx`, `POST …/yarnscope/compare` (result kept server-side, options only redraw) |
| DTY: auto-refresh when tab shown / refresh | `_ys_update_auto_refresh_state` / `_ys_on_refresh` | **DONE** | reload on open |
| ATY YarnScope (Distribution, Garnspiegel, Fabric, Knitted, Compare, radar, signal cards, hover) | `ui/aty_yarnscope_tab.py` | **DONE** | `fe/components/YarnScopeAty.tsx` (tab "YarnScope ATY"), `be/yarnscope_aty.py` on `ui/yarnscope/aty_service.py`; radar sentences and the Compare table headers stay English (generated by the desktop module) |
| ATY batch | `ui/screen_aty_batch.py` | **DONE** | series-locked like the desktop button (`YarnScopeBatch kind="aty"`); the hidden multi-series insider mode (Ctrl+Shift+J) is not in the web |

## 6. Experiment Requests (`ui/screen_my_requests.py`, `ui/screen_create_experiment_request.py` → `fe/pages/MyRequests.tsx`, `RequestForm.tsx`, `fe/components/StatusDialog.tsx`, `be/requests_api.py`)

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| List (ID, title, project, due date, owner for superusers, status, experiment ID) | `refresh` | **DONE** | `db/experiment_requests` |
| Search / status / project / owner filters | `_build_filter_row` / `_apply_filters` | **DONE** | |
| "Reset filters" button | `_reset_filters` | **DONE** | `MyRequests.tsx` `resetFilters` |
| "Show details" (long free-text columns) | `_toggle_detail_columns` | **DONE** | `MyRequests.tsx` details toggle |
| Refresh button | `refresh` | **DONE** | browser reload / reload on filter |
| Help "?" | `show_experiment_request_help` | **DONE** | `fe/components/RequestHelp.tsx` |
| Pending change Δ / NEW markers, row tooltip | `refresh` | **DONE** | |
| Double-click open (user → own pending copy; superuser with pending → review) | `_open_selected_request` | **DONE** | `open_id` / review card in `RequestForm.tsx` |
| Status dropdown (superuser) with denial reason / confirmation, owner notification | `_update_request_status` / `_notify_owner*` | **DONE** | `set_status` + `StatusDialog`; notify via `db/experiment_requests.notify_owner` (verify it is called on the web path) |
| Click Experiment ID → series picker → Show Experiment | `_on_cell_clicked` / `_open_experiment_series` | **DONE** | `/api/experiment-series`, picker when several |
| Context: Assign experiment… (superuser, status Approved) | `_assign_experiment_to_request` | **DONE** | `AssignDialog` in `MyRequests.tsx` |
| Context: Review Changes… (side by side, accept/reject) | `_review_pending_change` | **DONE** | review card in `RequestForm.tsx` |
| Context: View/edit change proposal… | `_on_context_menu` | **DONE** | right-click menu (Review / View proposal) |
| Context: View version history… (all users, own requests) | `show_version_history` (`ui/widgets/experiment_request_version_history.py`) | **DONE** | `VersionHistory` (`RequestPopup.tsx`) |
| Form from schema, required fields marked, FK dropdowns, dates | `_load_schema_and_build_form` / `_mark_required_fields` | **DONE** | |
| Save (new / edit / proposal for normal users / unchanged) | `_save` | **DONE** | |
| Denial banner | form | **DONE** | |
| Unsaved-changes prompt when leaving the form | `_has_unsaved_changes` | **DONE** | `RequestForm.tsx` (beforeunload + link guard) |
| "History…" button on the form | `_open_version_history` | **DONE** | `RequestForm.tsx` |
| Upload images | `_upload_images` | **PARTIAL** | only after first save (deliberate, see web CLAUDE.md) |
| Image viewer: zoom, rotate, list | `ExperimentRequestImagesDialog` | **DONE** | image viewer in `RequestPopup.tsx` |
| Image rename / batch rename / save as | `_rename_original_filename` / `BatchRenameDialog` / `_save_as_file` | **PARTIAL** | rename in the viewer; batch rename missing; save as = browser |
| Image delete (own / superuser) | `_delete_selected` | **DONE** | |
| Request PDFs dialog | `ExperimentRequestPdfsDialog` | **MISSING** | check whether still used on desktop |
| Read-only request popup from lists / Show Experiment / Report | `_ExperimentRequestReadOnlyDialog` | **DONE** | `RequestIcon` everywhere |
| Draft cleanup at login | `main.py` login flow | **MISSING** | web CLAUDE.md: not needed while web saves before images |

## 7. Login, sidebar, account (`ui/screen_login.py`, `main.py`, `ui/widgets/sidebar*.py` → `fe/pages/Login.tsx`, `fe/components/Shell.tsx`, `be/auth.py`, `be/nav.py`)

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Login user + password, inactive user, wrong password | `_attempt_login` | **DONE** | same checks in `be/auth.py` |
| Password = username → forced change | `_attempt_login` | **DONE** | login page shows the change form, `POST /api/auth/initial-password` (`db/user_account.change_password`), then logged in |
| "Change Password" | `ui/screen_change_pw.py` | **DONE** | Settings page, `POST /api/settings/password`, codes from `db/user_account` |
| Landing screen from Settings ("start") | `_go_landing` | **DONE** | `be/start_page.py` (web routes only) |
| Sidebar sections, collapse, narrow mode (logo click) | `sidebar.py` / `install_full_sidebar` | **DONE** | localStorage |
| Feature access (hide items) | `feature_access` / `_allowed` | **DONE** | `be/nav.py`, `require_feature` |
| Badges (Backlog, approved requests) | `nav_counts` | **DONE** | |
| Click on the "New Experiment" badge = preview of the approved requests + Create experiment | `_show_request_preview_dialog` | **DONE** | `RequestPreviewHost` (RequestPopup.tsx), `GET /api/requests/preview`, shared `experiment_requests.requests_by_status` (2026-11-16) |
| Browser tab title "<page> – TrippleT" | (window title) | **DONE** | Shell + `pageTitle.ts` (Show Experiment: experiment ID – series) |
| Ctrl+click sidebar = new tab | `_wire_tab_capable_click` | **DONE** | browser (NavLink) |
| Notifications bell + panel (mark read, click opens series) | `notification_panel.py`, `ui/notifications.py` | **DONE** | `fe/components/Notifications.tsx`, `be/notifications_api.py` on `ui/notifications.py` (own notifications only), 2026-11-13 |
| Search (Ctrl+F quick search) | `main.py` `_sc_search` | **DONE** | `fe/components/QuickSearch.tsx`, `be/search_api.py` on `db/quick_search.py`, 2026-11-13 |
| Recent series menu | `show_recent_menu` | **DONE** | same list as the desktop (`DisplaySettings.recent_series`, `push_recent`), 2026-11-13 |
| Knowledge Base | `screen_onboarding.py` | **DONE** | `pages/KnowledgeBase.tsx`, `backend/app/kb.py` (same HTML pages, tree, scene tabs, quiz → usage log, open:/tool: links). Popup from app cells (kb_popup) still missing, see Show Experiment |
| Help (F1) search | `help_search.py` | **DONE** | `fe/components/Help.tsx` (`HelpHost` in the Shell: F1 + sidebar entry), `be/help.py` on `ui/help_index`, `ui/kb_search`; same help_* usage events. KB hits navigate to the KB page (desktop: popup) |
| Ask AI in the help search | `help_ai.py` | **NOT IN WEB** | deliberately left out (user decision 2026-11-13) |
| Settings (text size, contrast, crosshair, start screen) | `display_prefs` / `user_settings_dialog` | **DONE** | `fe/pages/Settings.tsx` (⚙ in the sidebar footer) on `be/settings_api.py`: welcome, start screen, accent, table options; same stored values as desktop; text size = browser zoom |
| Accent colour picker | `pick_accent_colour` | **DONE** | Settings page, live preview + "Default green" |
| "Fresh off the Spool" (What's new) + auto popup after login | `ui/whats_new.py` | **DONE** | `fe/components/WhatsNew.tsx`, `be/whats_new_api.py` on `ui/whats_new_data.py` (versions, tabs, search, sketches, auto popup, seen = same value as desktop; no PDF button - browser print), 2026-11-13 |
| Log Out | `on_logout` | **DONE** | |
| Mode/DB banner (non-prod), version | footer / title | **DONE** | |
| Usage tracking of screen opens (`currentChanged` hook) | `main.py` | **DONE** | `ScreenLog` logs the desktop screen name per page (`/api/screen-open`), 2026-11-13 |
| Athena token reset at login | `main.py` | **NOT IN WEB (on purpose)** | no AI in the web |

## 8. Create Experiment / Add Trial Series / Add Lab Machines (`ui/screen_create_experiment.py` → `fe/pages/CreateExperiment.tsx`, `be/create_api.py`, logic `db/experiment_create.py`) – added 2026-11-13

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Tabs General / Material / Jet / Machine / Lab Machines with tick icons, Save only when all ticked | `_check_*` | **DONE** | checks in the page; server re-checks (`_check_save`) |
| General: product group, order type, experiment request (red border while open requests exist), project (locked to the request's), auto number, series name, backlog status (joker = Backlog, locked), priority | `_build_ui`, `_load_*`, `_sync_project_from_request` | **DONE** | `experiment_create.product_groups/order_types/projects/open_requests/request_project/next_experiment_number` |
| ER icon of the chosen request (popup) | `_open_selected_experiment_request_popup` | **DONE** | `RequestIcon` (modal, not non-modal) |
| Material tree by yarn group + search, colour square, stock symbol, ends, yarn use, spool choice | `_load_yarns`, `_add_material`, `SpoolPickerDialog` | **DONE** | `yarn_tree()`, `ply_label_for()`, `/api/create/spools` |
| Click on stock symbol → stock locations dialog | `_on_material_tree_clicked` | **DONE** | `StockDialog`, `/api/create/stock`; data in `db/yarn_spools.py`. "Open in Yarn Stock" opens a new tab (keeps the form) |
| "+ Trial" (output of another trial as ply, shadow yarn) | `_add_trial_ply`, `get_or_create_shadow_yarn` | **DONE** | `TrialPicker`; `experiment_create.search_trials` / `get_or_create_shadow_yarn` |
| Remove a ply row → renumber | `_on_yarn_delete_row` | **DONE** | `renumber_plies()` (follows the ply rule; desktop fixed the same way) |
| Jet tree by group with geometry/titer columns, header sort, search (name + development name) | `_load_jets`, `_on_jet_header_clicked` | **DONE** | `jet_tree()` |
| Housing, plates 1–20 (each 0–100), air pressure; table edit plates/pressure, copy selected, up/down, drag & drop | `_add_jet_row`, `_on_jet_item_changed`, `_copy_selected_jet_rows`, `_move_jet_row` | **DONE** | |
| Machine tab: fields of the machine (RDSetting 0), groups with gap, dropdown / int / double / S-Z rules | `_on_machine_changed` | **DONE** | `machine_fields()`, `machine_field_values()` |
| Lab machines: Itemat tensions + 0.0 baseline, SeriesFreeform list (Jet Air), value, once per value; baseline only removable last | `_add_lab_machine`, `_delete_lab_row` | **DONE** | `plan_lab_entries()`, `can_delete_lab_entry()` |
| Save create / add series (one transaction, request → status 4, series "NN name", joker flags) | `_on_save` | **DONE** | `experiment_create.create()` + `trial_actions.insert_trials()` |
| Add Lab Machines: experiment + series + trial checkboxes (select all), save with skip of existing rows, waterbath ×3, Jet Air rows | `_save_addlabmachines` | **DONE** | `add_lab_machines()` |
| Legacy import (typed experiment ID) | mode `legacy` | **DONE** | `/experiments/legacy`, Ctrl+Shift+J; existing IDs refused (`legacy_id_taken`, desktop too) |
| Add trials (from Show Experiment) | mode `addtrials` | **DONE** | "+T" → `/series/:id/add-trials`, `addtrials_setup()` + `trial_actions.add_trials` |
| Context help "How does Create Experiment work?" | `_open_help` | **DONE** | `HelpButton` → `ScreenHelp` (also All Experiments, Backlog, Show Experiment, Report) |

## 9. Manage Jets / New Jet (`ui/screen_manage_jets.py`, `ui/screen_new_jet.py`, `main.py` jet functions → `fe/pages/ManageJets.tsx`, `fe/components/AdminTable.tsx`, `be/admin_jets.py`, logic `db/jets_admin.py`) – added 2026-11-13

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Table of all jets, ID + Jet frozen, files column after Jet, UsedInTrial computed | `reload_data`, `_load_jets_data` | **DONE** | `jets_admin.load_jets()` |
| CreatedBy / CreationDate only for superusers | `_AUDIT_COLS` | **DONE** | server drops the columns below level 4 |
| Search field (Jet + Bemerkungen) | `_on_search_changed` | **DONE** | no highlighting of the hit inside the cell |
| Header filter menu (text / numeric range) | `FilterHeaderView._on_context_menu` | **DONE (different)** | filter row under the header: text = contains, numbers also `<5`, `>=2`, `1..3` |
| Sort by header click | proxy `lessThan` | **DONE** | empty values last |
| Edit cells, FK columns as dropdown, bool as checkbox, dirty marking, Save Changes | `JetsTableModel.setData`, `FKComboDelegate`, `save_changes` | **DONE** | server checks columns, FK ids and numbers (`bad_value`); Ctrl+S |
| Read-only without Admin card right (buttons disabled, "View in Form") | `_apply_read_only_ui`, `_require_admin_box_write` | **DONE** | `jets_admin.can_edit` |
| New Jet / Copy / Edit in Form (two-column form, FK "+" quick add, unique name) | `NewJetScreen`, `_quick_add_fk_value`, `_is_jet_name_available` | **DONE** | modal `JetForm`; new jet writes all form fields like `_collect_values` |
| Files tab (list, upload, open, delete, image preview) | `NewJetScreen._load_files/_upload_file/_open_file/_delete_file` | **DONE** | `jets_admin.list_files/add_file/remove_file/file_path`; files open in a new tab |
| Delete selected jets (confirm) | `_on_delete` | **DONE** | Ctrl/Shift multi-select |
| UsedInTrial ▸ → series rows → trials (yarn, OF, speed) | `_expand_jet_row`, `_fetch_jet_usage` | **DONE** | `jets_admin.jet_usage()`; series label links to Show Experiment |
| Columns… dialog (drag & drop, "Save layout" per user) | `ColumnOrderDialog`, `_save_column_order_now` | **DONE** | same `db/user_column_order` key `manage_jets` as the desktop |
| Copy selection (Ctrl+C) | `copy_selection_to_clipboard` | **DONE** | selected rows as TSV |
| Context help | `_open_help` | **DONE** | `HelpButton screen="manage_jets"` |

## 10. Manage Yarn / New Yarn (`ui/screen_manage_yarn.py`, `ui/screen_new_yarn.py`, `main.py` yarn form callbacks → `fe/pages/ManageYarn.tsx`, `be/admin_yarn.py`, logic `db/yarn_admin.py`) – added 2026-11-13

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Table of catalogue yarns (no shadow yarns), UsedInTrial + StockKg computed, DPF computed | `_load_yarn`, `YarnTableModel` | **DONE** | `yarn_admin.load_yarns()`; DPF also live while editing Endtiter / filaments |
| SourceTrialID never shown, CreatedBy / CreationDate only superusers, "ColourID" shown as "Colour" | `reload_data`, `_DISPLAY_LABEL_OVERRIDES` | **DONE** | `yarn_admin.visible_columns`, `DISPLAY_LABELS` |
| Colour square in front of Name and Colour | `colour_icon` | **DONE** | `db/yarn_colours.colour_css` |
| Search by name, header filters, sort | `_on_search_changed`, `FilterableHeaderView` | **DONE (different)** | filter row as in Manage Jets; ID + Name frozen (desktop: nothing frozen) |
| Edit cells, FK dropdowns (Garntyp, Material, YarnGroup, Colour), "+ Add new colour…" | `ComboMapDelegate`, `quick_add_colour` | **DONE** | same name → existing colour, similar name → use it / create anyway (`colour_exact/colour_similar/insert_colour`) |
| Rights: everyone edits/creates, MinStock only superusers, Delete only Admin card right | `set_permissions`, `app_meta.can_edit_min_stock` | **DONE** | `yarn_admin.can_edit_minstock/can_delete`; server refuses MinStock / delete otherwise |
| Duplicate check before every save ("Save anyway?", default No) | `find_duplicate_yarn`, `confirm_save_despite_duplicate` | **DONE** | 409 `duplicate_identical/similar` → dialog → resend with `confirmed` |
| New Yarn / Edit in Form (two columns, DPF read-only, MinStock locked) | `NewYarnScreen`, `_go_new_yarn_form`, `_go_edit_yarn_form` | **DONE** | `yarn_admin.insert_yarn/update_yarn` |
| Delete selected (confirm) | `_on_delete` | **DONE** | |
| UsedInTrial ▸ → series → trials (jet, OF / Core-Effect OF, speed) | `_expand_yarn_row`, `_fetch_yarn_usage` | **DONE** | `yarn_admin.yarn_usage()` |
| Columns… dialog + "Save layout" | `ColumnOrderDialog` | **DONE** | key `manage_yarn` like the desktop |
| Overwriting GlobalID in the table | (desktop allows it) | **NOT IN WEB (on purpose)** | |
| KB links in the right-click menu (Material / Garntyp) | `kb_links.install_table_menu/install_combo_menu` | **DONE** | table: `onCellMenu` (`admin_yarn._kb_values`); form drop-downs: right-click in `YarnForm` (2026-11-14) |
| Context help | `_open_help` | **DONE** | `HelpButton screen="manage_yarn"` |

## 11. Yarn Stock (`ui/screen_yarn_stock.py` → `fe/pages/YarnStock.tsx`, `be/yarn_stock_api.py`, logic `db/yarn_stock.py`) – added 2026-11-13

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Overview yarn × batch (spools, kg, yarn total, min. stock, status per yarn with colour, locations), empty batches hidden | `reload_data`, `_render_overview` | **DONE** | `yarn_stock.load_stock()` |
| Search yarn / batch, status filter, Reload, Export to Excel | `_apply_overview_filter`, `_on_export_excel` | **DONE** | `overview_xlsx()` (download) |
| Batch / producer of a group editable (all spools incl. discarded, logged), Min. stock (superusers) | `_on_group_item_changed`, `_on_minstock_edited` | **DONE** | double-click like the desktop; `update_group_batch/producer`, `set_min_stock` |
| Spools of the chosen batch: weight / location / tube colour / producer, Save, change log | `SpoolTableModel`, `_write_pending_changes` | **DONE** | `save_spool_changes()`; only spools in stock |
| Unsaved spool edits: Save / Discard / Cancel before switching | `_ask_pending_changes` | **DONE** | |
| Select all, New spool(s) (+ producer, + label queue), New producer, Discard | `_on_new_spool`, `_on_new_producer`, `_on_discard` | **DONE** | `new_spools`, `create_producer`, `discard_spools` |
| Used in…, History… (ticked/selected or whole batch incl. discarded) | `UsedInDialog`, `SpoolHistoryDialog` | **DONE** | `used_in`, `history`, `describe_history` |
| "Go to spool #" (number or scanned label QR, discarded → show history) | `_on_goto_spool`, `parse_spool_input` | **DONE** | |
| Label queue: add, remove, Print Labels… (sheet template, start cell, PDF, mark printed) | `_queue_labels`, `_on_print_labels`, `PrintLabelsDialog` | **DONE** | PDF opens in a new tab (desktop: save dialog); `labels_pdf()` |
| Rack lookup (+ Excel) | `_apply_rack_filter`, `_on_export_rack_excel` | **DONE** | `rack_groups`, `rack_xlsx` |
| Low / empty stock bell notifications on load | `reload_data` → `ui/notifications` | **DONE** | `refresh_notifications()` |
| Stock take round: overview tiles per location (rack × level, open / fine / differences / left out), results (only differences, location filter, "seen at"), Excel | `StockTakeRoundDialog` | **DONE** | `fe/pages/StockTake.tsx` (`/tools/yarn-stock/stock-take`), `be/stock_take_api.py`; `stock_take.tile_columns`, `export_excel_bytes` |
| Start round (name, untick locations), close round, leave out / include (superusers) | `StartRoundDialog`, `_on_close_round`, `_set_excluded` | **DONE** | right-click menu on a tile |
| Check a location: expected list, scan (also label QR), mark by hand (double-click) / undo (right-click), move / put back at once, finish with discard / keep missing; check without a round | `StockTakeDialog` | **DONE** | `stock_take.move_spool/restock_spool/discard_missing`; scan parsed on the server (`/parse`) |
| Yarn Stock help dialog (tasks / screen guide / background / stock take) | `show_yarn_stock_help` | **DONE** | `help._yarn_stock_help()` turns the desktop texts into help blocks; "?" on Yarn Stock, the stock take opens tab "stocktake". Button names in the texts stay the desktop's English ones |
| "Open in Yarn Stock" from Create Experiment's stock dialog | `YarnLocationsDialog(on_open_yarn_stock)` | **DONE** | web opens a new tab `/tools/yarn-stock?yarn=&charge=` (keeps the form) |

## 12. Manage User (`ui/screen_manage_user.py`, `ui/widgets/feature_access_dialog.py` → `fe/pages/ManageUsers.tsx`, `be/user_admin_api.py`, logic `db/user_admin.py` + `db/feature_access.py`) – added 2026-11-13

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Users table (no password columns), filter first / last name, edit + Save | `reload_data`, `save_changes` | **DONE** | `user_admin.load_users/save_changes`; checks: access right from the list, colours `#RRGGBB`, bools 0/1 |
| Access right as drop-down, colour with picker + swatch | `AccessRightDelegate`, `QColorDialog` | **DONE** | native colour input in the cell |
| New user with initial password (default name "newuser…", password rules) | `_on_new` | **DONE** | `next_username`, `check_new_password`, `create_user` (Argon2); web form also takes first / last name and access right |
| Reset password | `_on_reset_password` | **DONE** | `reset_password` (`update_user_password`) |
| Delete users | `_on_delete` | **DONE** | own account refused in the web |
| Access… (tools / screens per group or person) | `FeatureAccessDialog` | **DONE** | `feature_access.load_all/save_all`; labels = sidebar texts |
| User names unique and within the column length | (desktop does not check) | **DONE (stricter)** | `UserName` is VARCHAR(5) on dev_local |
| 🔑 API key + token limit (AI) | `_on_set_api_key` | **NOT IN WEB (on purpose)** | AI stays out of the web like "Ask AI" / Athena |

## 13. Smart Chart / Dashboards (`ui/screen_smart_chart.py`, `ui/screen_dashboards.py`, `ui/smart_dashboard.py` → `fe/pages/SmartChart.tsx`, `fe/pages/Dashboards.tsx`, `be/smart_chart_api.py`, logic `ui/smart_dashboard_core.py` + `ui/smart_dashboard_engine.py`) – added 2026-11-13

The dashboard surface is the desktop page `ui/smart_dashboard_html.py` itself, in an iframe with `smart_bridge.js`
instead of Qt's web channel (Nutzerentscheid 2026-11-13: embed, not rebuild) - so everything inside it is the same
as the desktop (and English, like the desktop). The Qt bridge logic was moved to `ui/smart_dashboard_core.py`.

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Pages, visuals, Visualizations / Fields / Filters panes, Format, Analytics, Model view, undo/redo | `smart_dashboard_html.py` | **DONE** | same page; panes remembered in localStorage (desktop QSettings) |
| Count of matching trials | `SmartChartScreen.refresh` | **DONE** | `Host.summary` |
| Filters on all pages / page / visual (add, edit, remove; histogram, step, pick values, periods) | `AddFilterDialog` | **DONE** | React dialog; `field_overview`, `make_filter`, `filter_hits`, `number_values` |
| Ply scope | `set_ply_scope` | **DONE** | |
| Cross-filter clicks, lasso selection, slicers, highlight | `_on_click`, `_on_select` | **DONE** | `DashboardSession.click/select` |
| Drill-down, drill-through + back | `_on_drill_through/_back` | **DONE** | |
| Focus mode (trials below a visual), double-click opens Show Experiment | `_on_focus_rows`, `_on_open` | **DONE** | opens in a new tab |
| Calculated fields | `CalcFieldDialog` | **DONE** | `calc_preview`, `calc_definition` |
| Colour of a series / visual | `_on_pick_colour` | **DONE** | colour input |
| Fairness details + "Make it fairer" | `_FairnessDialog` | **DONE** | `fairness_json`, `apply_fair_fix`; condition texts English (data) |
| New: empty / example / template | `_on_new` | **DONE** | template names English (engine data) |
| Open / save / delete view, save as new, overwrite with edit share | `_OpenViewDialog`, `_SaveViewDialog` | **DONE** | `db/smart_chart_views.py` |
| Share with people / groups (view / edit) | `ShareDialog` | **DONE** | |
| Excel of the page / of one visual | `_export_excel`, `_on_export_visual` | **DONE** | |
| PDF (this page / all pages) | `export_pdf` | **DONE** | images rendered by the page, PDF by `smart_dashboard_pdf.write_pdf` |
| Reload (F5) | `load_data(force)` | **PARTIAL** | button only (F5 reloads the browser page) |
| Dashboards: my / shared list, search, read-only, last one remembered | `DashboardsScreen` | **DONE** | localStorage |
| Dashboards: "Edit in Smart Chart" | `_edit` | **DONE** | `/tools/smart-chart?view=<id>` |
| Include reference samples (Filters pane), field "Reference sample" | `set_include_refs` (new 2026-11-13) | **DONE** | both apps |
| Result cache per visual (moving / resizing costs nothing) | `DashboardSession.result` (new) | **DONE** | both apps |
| Calculated field: preview over the dashboard's trials, copy from another dashboard | `calc_preview`, `calc_library` (new) | **DONE** | both apps |
| Folders and favourites for views | `group_views`, `smart_favs` (new) | **DONE** | both apps |
| Unsaved changes: draft + restore, warning when leaving | – | **DONE (web only)** | the desktop keeps the screen open |

## 14. Tools (one after another since 2026-11-13)

| Tool | Desktop | Web status | Notes / logic location |
|---|---|---|---|
| Yarn Count Converter (all systems, filaments & plies, diameter, designation, notation reader, formulas, copy) | `ui/screen_yarn_count.py` | **DONE** | `be/yarn_count_api.py` on `ui/yarn_count.py`; last input in localStorage |
| Jet ROI Calculator (single: competitor vs Heberlein, DB jet or manual, bar/PSI, currencies, KPIs, chart, details, summary, PDF; multi-jet comparison + PDF) | `ui/screen_nozzle_calculator.py` | **DONE** | `be/jet_roi_api.py` on `ui/jet_roi.py` |
| Air Supply Network (node editor, solver, source/segment/reducer/jet panels, operating cost, segment table, optimiser with cost comparison, tabs, save/load, PDF, Excel, example, undo) | `ui/screen_air_supply.py` | **DONE** | `be/air_supply_api.py` on `ui/air_network.py`; op-cost inputs per page (desktop: per panel) |
| Image Compare (grid, series images + local files, VK4 channels, PDF/Word pages, Excel sheets, whiteboard, 10 annotation tools, colours/sizes, undo, grid overlay, ATY radar, zoom/pan, swap frames, paste, save frame / all, project files) | `ui/screen_image_compare.py` | **DONE** | `be/image_compare_api.py` on `db/image_compare.py` + `ui/doc_render.py`; rotation not written back to the share (on purpose) |
| Label Generator (series/trial data incl. Machine Data fields, label size, designs save/load, text parts static/field/counter, logo, table, drag/resize, anchor groups, copies / per trial, sheet template + start position, PDF) | `ui/screen_label_generator.py` | **DONE** | `be/label_generator_api.py` on `ui/label_designer.py` + `db/label_sheets.py` |
| TDMS Inspector (any .tdms file, DTY + ATY YarnScope, no DB; no save/batch/compare) | `ui/screen_tdms_inspector.py` | **DONE** | `be/tdms_inspector.py` (upload) + the YarnScope routes for negative series numbers |
| Canvas (free board, series images + PDFs + local files, move / scale / rotate, annotation tools, undo, grid, background colour, PNG export, project files, paste, Del) | `ui/screen_canvas.py` | **DONE** | `fe/pages/Canvas.tsx` on the Image Compare routes; rotation around the centre |
| Canvas boards in the DB (title, series, shared, autosave, version check, files stored with the board) - new 2026-11-14 in both apps | `db/canvas_boards.py`, board bar in `ui/screen_canvas.py` | **DONE** | `be/canvas_api.py`, `fe/pages/Canvas.tsx`; "Board" button in Show Experiment (both); web imports old .ttcanvas files |
| Process Playground (yarn/jet list with search + sort, start from a trial or typed with range notes, sliders, statements per lab value, warnings, goals + Find settings, suggestions, chart with model curve + band, Reload/F5, open from Show Experiment) | `ui/screen_process_playground.py` | **DONE** | `be/process_playground_api.py` on `ui/dty_whatif.py` + `ui/process_playground_core.py`; statements / based-on / start notes English (shared module) |
| Requirement Hub / Quick Scan (hub card, filters = must, targets must / weighted / distance with goal, direction, weight, tension, lookup multi-select, ad-hoc DB fields, score table + ranking, query overview, rulesets save / load / delete) | `ui/screen_requirement_hub.py`, `ui/screen_quick_scan.py` | **DONE** | `be/quick_scan_api.py` on `db/quick_scan.py`; no Athena advisor (no AI in the web); click on a hit opens the series |

## 15. Admin master tables (`ui/screen_manage_order_types.py`, `screen_manage_product_groups.py`, `screen_manage_material.py`, `screen_manage_top_plates.py` + `screen_new_top_plate.py` → `fe/pages/ManageMaster.tsx`, `be/admin_master.py`, logic `db/master_tables.py`) – added 2026-11-13

| Feature | Desktop | Web status | Notes |
|---|---|---|---|
| Order Type: table edit, New, Delete, Save, search, filter row, column order | `ui/screen_manage_order_types.py` | **DONE** | New without AUTO_INCREMENT gets MAX+1 (both apps) |
| Product Groups: same | `ui/screen_manage_product_groups.py` | **DONE** | |
| Material: same + "Used in yarn" with the yarns inline | `ui/screen_manage_material.py` | **DONE** | |
| Top Plates: table, New / Copy (unique name), Delete, files (upload, open, preview, remove) | `ui/screen_manage_top_plates.py`, `ui/screen_new_top_plate.py` | **DONE** | New/Copy ask only for the name (the table has only Name); files dialog per row (double-click) |

## 16. Superuser pages (`ui/screen_usage_stats.py`, `ui/widgets/recycle_bin_dialog.py` + `ui/recycle_preview.py`, `ui/screen_lab_assistant.py`) – added 2026-11-13

| Feature | Desktop | Web status | Notes |
|---|---|---|---|
| Usage Stats: ranking + logins per day, tables Logins / Screens / Features / Help | `ui/screen_usage_stats.py` | **NOT IN WEB (on purpose)** | not needed in the web (user decision 2026-11-13); the web logs its page opens, the desktop Usage Stats shows them |
| Recycle Bin: list, restore, delete permanently, preview in Show Experiment (read only, banner: keep / back / delete; leaving = back) | `ui/widgets/recycle_bin_dialog.py`, `ui/recycle_preview.py` | **DONE** | `be/recycle_bin_api.py` on `db/recycle_bin.py` |
| Lab Assistant (AI chat over the database) | `ui/screen_lab_assistant.py` | **NOT IN WEB (on purpose)** | no AI in the web (user decision); left out of the sidebar like Offline Sync |

## Conclusion per series (added 2026-11-14, both apps)

| Feature | Desktop | Web status | Notes |
|---|---|---|---|
| Conclusion tab (goal from request or own goal, outcome, summary, best trials, findings, recommendation) | `ui/widgets/conclusion_tab.py` | **DONE** | `components/ConclusionTab.tsx`, `app/conclusion_api.py`, logic `db/series_conclusion.py` |
| Marker on Backlog cards (outcome dot, dashed ring = Done without conclusion), tooltip with summary | `screen_backlog` delegate | **DONE** | `Backlog.tsx` |
| All Experiments: Outcome + Conclusion columns, filter | `screen_all_experiments` | **DONE** | `AllExperiments.tsx` |
| Quick search field "Conclusion" | `screen_quick_search` | **DONE** | `QuickSearch.tsx` |
| Request popup: results of the linked series | `_ExperimentRequestReadOnlyDialog` | **DONE** | `RequestPopup.tsx` |
| Bell for the requester on first save | `notification_panel` type `series_conclusion` | **DONE** | `Notifications.tsx` |
| Hint when archiving without conclusion | Backlog / All Experiments | **DONE** | 409 `no_conclusion` + confirm |
| Report: "✅ Conclusion" block above the charts + in the PDF | shared report page, `screen_report.loadConclusions` | **DONE** | same page in the iframe, `web_bridge.js` slot `loadConclusions` (2026-11-16) |

## Jet Advisor (added 2026-11-15, both apps)

| Feature | Desktop | Web status | Notes |
|---|---|---|---|
| Targets + yarn + jet filters -> ranked jets with settings | `ui/screen_jet_advisor.py` | **DONE** | `pages/JetAdvisor.tsx`, `app/jet_advisor_api.py`, logic `ui/jet_advisor.py` |
| Open series / Process Playground from a result | double-click series, button | **DONE** | links (new tab) |
