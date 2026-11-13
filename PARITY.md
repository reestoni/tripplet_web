# Feature parity: TrippleT desktop vs. web

Status 2026-11-13 (snapshot of both working trees incl. uncommitted Qt-free modules in
`tripplet_project/db/`: `series_actions`, `series_yarns`, `trial_actions`, `trial_copy`,
`trial_labels`, `label_sheets`, `lab_pdf_import`). Read-only comparison, nothing was run.

Legend: **DONE** = in the web (file cited) · **PARTIAL** = exists, something missing ·
**MISSING** = not in the web. "Qt-free" = logic already importable from `tripplet_project`
(no PySide6); "Qt" = still inside a Qt file, extract first (desktop rule: never re-implement in the web).

## Summary

| Screen | Done | Partial | Missing | Rows |
|---|---|---|---|---|
| 1. All Experiments | 10 | 3 | 9 | 22 |
| 2. Backlog | 16 | 1 | 15 | 32 |
| 3. Show Experiment | 53 | 9 | 37 | 99 |
| 4. Report from Show Experiment | 8 | 1 | 2 | 11 |
| 5. YarnScope | 9 | 1 | 8 | 18 |
| 6. Experiment Requests | 11 | 5 | 10 | 26 |
| 7. Login, sidebar, account | 8 | 3 | 9 | 20 |
| **Total** | 115 | 23 | 90 | 228 |

Most important gaps (judgement): series-level actions in Backlog/All Experiments (status dropdown,
priority, rename, change machine, reassign yarn, delete - logic all Qt-free already); Show Experiment
writing tools beyond cell edits (Statimat/Itemat import, Copy trials, Yarns dialog, references +
vs Ref/Target, print labels, uploads); Experiment Request popup / assignment / version history;
YarnScope comparison + trends, ATY YarnScope; KB/help/notifications in the shell.

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
| Ctrl+double-click = open in new tab | `_open_in_new_window` | **MISSING** | rows are not links; use `<a href>` so Ctrl/middle-click works (frontend only) |
| Status column = editable dropdown (role-filtered list, saves at once, joker-machine prompt) | `_create_status_combobox` / `_on_status_combo_changed` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| "Copy TrialSeries" button (enabled on row selection) | `_on_copy_trialseries` | **DONE** | right-click menu "Copy trial series…" → `/series/new?copy=<id>` (experiment + jet rows prefilled, 2026-11-13) |
| AM icon + tooltip "Has attachments" | `_set_attach_cell` | **DONE** | |
| ER icon click → read-only Experiment Request popup | `_set_er_cell` / `open_experiment_request_popup` | **PARTIAL** | icon + tooltip shown, not clickable. Popup = `_ExperimentRequestReadOnlyDialog` (Qt, `ui/screen_show_experiment.py`); data Qt-free in `db/experiment_requests` (web could link `/requests/:id`) |
| NT icon "Has notes" | `_set_notes_cell` | **DONE** | |
| RE icon click → saved Smart Chart report (Ctrl = new tab) | `_set_report_cell` / `_open_report_icon_for_series` | **PARTIAL** | icon shown, not clickable; route `/series/:id/report?report=` exists; ids Qt-free `db/series_overview.series_report_map` |
| Context menu: Open in New Tab / Open in New Window | `_on_table_context_menu` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context menu: Rename Trial Series… (level ≥ 2, prefix kept) | `_rename_trialseries_at_row`, `RenameTrialSeriesDialog` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context menu: Reassign Yarn… (superuser; per ply, add/delete ply, conflicts) | `_reassign_yarn_at_row` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context menu: Change Machine… (superuser) | `_reassign_machine_at_row` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Context menu: Delete Trial Series… (recycle bin, mover rights) | `_delete_trialseries_at_row` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Menu entries disabled by permission | `_on_table_context_menu` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
| Help button "How does All Experiments work?" (EN/DE/ES) | `_open_help` | **MISSING** | texts are pure data `ui/widgets/help_texts_all_experiments.py`; dialog Qt (`multilang_help`) |
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
| ER icon click → read-only request popup | `BacklogDnDTable.mousePressEvent` | **MISSING** | see All Experiments |
| RE icon click → saved report (Ctrl = new tab) | `mousePressEvent` / `_open_report_icon_for_series` | **MISSING** | route exists in web |
| Double-click card opens Show Experiment | `_on_cell_double_clicked` | **DONE** | |
| Ctrl+double-click = new tab | `_on_cell_double_clicked` | **MISSING** | frontend only |
| Drag & drop card to another status | `startDrag` / `dropEvent` / `_handle_dnd_move` | **DONE** | `POST /api/backlog/move`, `db/backlog_moves` incl. `after_move` (Done notifications) |
| Joker machine → choose real machine | `MachineSelectDialog` | **DONE** | modal in `Backlog.tsx` |
| Rule violation messages | `_handle_dnd_move` | **DONE** | toast `bl.err.<code>` |
| Drop target highlight / drag feedback | `_set_drop_highlight` / `_build_drag_pixmap` | **DONE** | CSS classes |
| Multi-select cards (Ctrl/Shift+click) + move several, one confirmation, summary of failures | `_handle_dnd_move_many` | **MISSING** | per-card rules Qt-free (`backlog_moves`); loop/summary only in screen |
| Context: Open in New Tab / New Window | `_open_context_menu` | **DONE** | `fe/components/SeriesAdmin.tsx`, `be/series_manage.py` (2026-11-13) |
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
| Archived: context menu Open / New Tab / New Window | `_ArchivedSeriesRow.contextMenuEvent` | **MISSING** | |
| Expand a column to full screen (⤢) + Close | `_expand_card` / `_collapse_card` | **MISSING** | pure UI |
| Welcome message from DB with first name | `_refresh_welcome_message` / `_fetch_welcome_message_from_db` | **MISSING** | small query inside the Qt screen (extract) |
| Help button "How does the Backlog work?" | `_open_help` | **MISSING** | data `ui/widgets/help_texts_backlog.py` |
| Athena sleeping-owl easter egg (5 %) | `_spawn_sleeping_athena` | **MISSING** | cosmetic |
| Wide/narrow board arrangement | `_arrange_board` | **DONE** | CSS |
| Reload on show; sidebar badge refresh after move | `showEvent` | **DONE** | `tripplet:nav-changed` event |

## 3. Show Experiment (`ui/screen_show_experiment.py` + extracted modules → `fe/pages/SeriesView.tsx`, `fe/components/*`, `fe/edit.tsx`)

### 3a. Header & toolbar

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Series title, machine, status, owner, created, trial count | `_build_ui` / `_load_record_inner` | **DONE** | `be/series_view.py` |
| TrialSeriesID label, machine info label | `_build_ui` | **PARTIAL** | ID not shown |
| Material line (plies/yarns) with stock symbol; hover = stock tooltip, click = storage locations | `_load_materials_summary` / `_on_material_label_link_hovered/_activated` | **MISSING** | `ui/widgets/yarn_locations.load_stock_summary` (Qt file, data part Qt-free-able) |
| Experiment Request icon → read-only popup (+ images, version history) | `_open_experiment_request_popup`, `_ExperimentRequestReadOnlyDialog` | **MISSING** | data Qt-free `db/experiment_requests`, `db/experiment_request_changes`; dialog Qt |
| Save button "Save (n)" + Ctrl+S | `_save_all` / `_sc_save` / `keyPressEvent` | **DONE** | `fe/edit.tsx`, `POST /api/series/{id}/save` → `db/series_save` |
| Plausibility check before saving (confirm) | `_confirm_plausible_values` | **DONE** | `db/plausibility.check` |
| Undo Ctrl+Z | `_UndoManager` / `_init_undo` | **DONE** | `fe/edit.tsx` |
| Redo Ctrl+Y / Ctrl+Shift+Z | `_init_undo` | **MISSING** | frontend only |
| Discard unsaved | Save/Discard/Cancel prompt | **DONE** | "Discard" button |
| Unsaved mark on tab (dot) | `_apply_unsaved_tab_mark` | **MISSING** | frontend only |
| Prompt Save/Discard/Cancel on leaving (tab close, back, series switch, logout, exit) | `confirm_close_with_unsaved` / `_back_all_experiments` / `closeEvent` | **PARTIAL** | `confirmLeave()` + link guard in `edit.tsx` (OK/Cancel instead of Save/Discard/Cancel; browser back not guarded) |
| Refresh ↻ / F5 | `_on_refresh` | **DONE** | browser reload (warns if unsaved) |
| Back to list | `_back_all_experiments` | **DONE** | back arrow (`navigate(-1)`) |
| Show attached images (gallery) | `_open_series_images_dialog` | **PARTIAL** | `fe/components/Attachments.tsx` views only; desktop dialog (`ExperimentRequestImagesDialog`) also zoom/rotate/rename/batch rename/delete/save as |
| Show attached PDFs | `_open_series_pdfs_dialog` | **PARTIAL** | list + open in browser; no rename/delete |
| Upload images | `_upload_series_images` / `_insert_trialseries_image_row` | **DONE** | `be/uploads.py`, `fe/components/Attachments.tsx`, `db/series_uploads.py` (2026-11-13) |
| Garnspiegel CV analysis of uploaded images | `_analyze_and_save_garnspiegel` | **DONE** | `db/series_uploads.analyze_garnspiegel` on upload (2026-11-13) |
| Upload PDFs | `_upload_series_pdfs` / `_insert_trialseries_pdf_row` | **DONE** | `be/uploads.py` (2026-11-13) |
| Statimat import (from attached PDFs, preview, write, change log) | `_statimat_import` (`screen_show_experiment_pdf_import.py`) | **DONE** | `fe/components/SeriesTools.tsx` PdfImportDialog, `be/series_tools.pdf_import` (write access like the desktop buttons) |
| Itemat import | `_itemat_import` | **DONE** | same as Statimat |
| Report button | `_open_report` | **DONE** | `/series/:id/report` |
| Saved reports dropdown + "Go!" | `_refresh_saved_reports_dropdown` / `_open_selected_saved_report` | **PARTIAL** | report page has its own load list; no picker in header (`?report=` supported) |
| Print trial labels (V-numbers, range) → PDF | `_on_print_trial_labels` | **DONE** | LabelsDialog (range, start cell, template, save template) → PDF in new tab |
| Add empty trial (→ Create Experiment "add trials") | `_add_empty_trial` | **DONE** | "+T" button in the Machine Data tool bar (2026-11-13) |
| "+ Ref" add reference sample | `_add_reference_sample` | **DONE** | header button + trial menu |
| "vs Ref / Target" compare dialog (criteria, tolerances, own targets, saved sets, only-passing filter) | `_open_ref_compare` (`ui/ref_compare_dialog.py`) | **PARTIAL** | RefCompareDialog, `be/series_tools.ref_compare` (same `ui/ref_compare.py`, sources = LAB_TABS, parity 3 series); no 'only passing' filter yet |
| "Copy trials" button / dialog (block/row repeat, field overrides) | `_on_copy_trials_button` (`ui/copy_trials_dialog.py`) | **DONE** | CopyTrialsDialog, `be/series_tools.copy_trials_ep` |
| "Yarns…" dialog (plies of the series: add ply, trial output, change yarn, ends, remove) | `_open_series_yarns` (`ui/series_yarns_dialog.py`) | **PARTIAL** | YarnsDialog, `be/series_tools.yarns_apply` ("+ Trial output" not yet) |
| Help button (EN/DE/ES) | `_open_help` | **MISSING** | data `ui/widgets/help_texts_show_experiment.py` |
| Read-only for access level ≤ 1 | `_get_access_level` / `_sync_save_button_access` | **DONE** | `canWrite = accessLevel >= 2` |
| Recycle-bin preview mode (read-only series) | `set_recycle_preview` | **MISSING** | Recycle Bin not in web |

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
| Retest banner above lab table | `_make_retest_banner` | **PARTIAL** | no banner, only dot/tooltip |
| Itemat recompute after save | `_recompute_itemat_intermingling` / `_recompute_itemat_plus` | **DONE** | server `series_save.save_series_edits` |
| Jet Air Consumption: 3 grids, unit Nm³/h ↔ l/min, editable | `_build_jet_air_tab` / `_on_jet_air_unit_changed` | **DONE** | `fe/components/JetAirView.tsx` |
| Jet Air: "Sync physical jets" | `_sync_jet_air_physical_jets` | **MISSING** | Qt-free `db/trial_actions.physical_jets_for_series/save_jet_air_consumption_rows` |
| Jet Air: "Apply to all" for atm / temperature | `_fill_all_jet_air` | **MISSING** | frontend only (marks dirty) |
| Notes tab: series free-text notes, auto-save | `_load_notes` / `_on_notes_text_changed` / `_save_notes` | **DONE** | `SeriesNotes` in SeriesView (auto-save 1.5 s + blur) |
| Notes tab: list of all notes on values | `cell_notes_ui` (Notes tab list) | **DONE** | `SeriesView.tsx` notes table |
| Athena (AI advisor) tab: wake, chat, reset | `ui/advisor_tab.py` | **MISSING** | Qt: `ui/advisor_worker.py` (QThread); `collect_advisor_context` could be split out |
| DTY YarnScope tab | `ui/dty_yarnscope_tab.py` | **PARTIAL** | see section 5 |
| ATY YarnScope tab | `ui/aty_yarnscope_tab.py` | **MISSING** | see section 5 |
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
| Display prefs: text size, contrast stripes, crosshair | `display_prefs` / `_pass_display_to_model` | **MISSING** | Qt (`ui/display_prefs.py`); stored in `tblUser.DisplaySettings` |
| Read bar (parameter + value of current cell, warning) | `read_bar_text` | **MISSING** | |
| Frozen first column / header while scrolling | `FrozenFirstColumnTable` | **DONE** | sticky CSS (assumed in styles.css) |

### 3d. Context menus

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Value: Add note… / Notes (n)… (add, edit own, delete own/superuser) | `cell_notes_ui.add_cell_note_actions` | **DONE** | `NotesDialog`, `be/series_actions.py` → `db/cell_notes` |
| Value: Change history… (superuser), "whole series" checkbox | `_add_cell_history_action`, `change_history_dialog.py` | **DONE** | `HistoryDialog` → `db/change_log` |
| Value / row title / lab header: "Learn more in Knowledge Base" | `kb_links.add_action` / `machine_cell_target` / `table_target` | **MISSING** | mapping `ui/kb_links.py` is Qt (dicts could be split) |
| Value / row title (Machine, R&D): Fill row… (trial range, plies) | `_fill_machine_row_from_title` / `FillDialog` | **DONE** | `db/series_save.fill_range_edits` |
| Row title: Hide row / Hide n rows / Show hidden here / Show all | `machine_row_visibility.add_context_actions` | **DONE** | web stores in localStorage, desktop in QSettings (not shared) |
| "n rows hidden" button with menu | `btn_hidden_rows` | **DONE** | |
| Row title: Show/Hide Custom Group | `_toggle_custom_group_row` | **DONE** | |
| Ply header (row 2) right-click → Yarns dialog | `_manage_plies_for_col_spec_idx` | **DONE** | MachineTable ply row → Yarns… |
| Trial header: click / Ctrl / Shift = select trials | `_GridView.mousePressEvent` | **DONE** | `seriesMenus.clickTrial` |
| Trial header: Add note to Vn / Notes on Vn | `cell_notes_ui.add_trial_note_action` | **DONE** | |
| Trial header: Copy trials… | `_on_trial_header_menu` / `_multiply_trial_from_col_spec_idx` | **DONE** | trial menu (selected trials preselected) |
| Trial header: Open Vn in Process Playground… | `_process_playground_available` | **MISSING** | Process Playground not in web; stats Qt-free `ui/dty_whatif.py` |
| Trial header: Add reference sample… | `_add_reference_sample` | **DONE** | trial menu |
| Trial header: Mark Vn as reference / Rename reference / Turn into normal trial | `_set_reference_flag` / `_rename_reference_sample` | **DONE** | trial menu |
| Trial header (ref): Compare trials with this reference… | `_open_ref_compare` | **MISSING** | see "vs Ref / Target" |
| Trial header: Delete Vn / Delete n selected trials (blocked if unsaved) | `_delete_trials` / `_trial_delete_blocker` | **DONE** | `DeleteTrialsDialog` → `recycle_bin.delete_trials` |
| Lab trial header: Flag Vn for retest… (superuser) | `_on_lab_header_context_menu` / `_mark_trial_for_retest` | **DONE** | `RetestDialog` → `db/retest_flags` |
| Series change history (trial header menu) | `change_history_dialog` (series checkbox) | **DONE** | web extra entry |
| Compare dialog double-click → jump to trial in Machine Data | `_show_trial_in_machine_data` | **MISSING** | with compare dialog |
| DTY schema station right-click → KB, double-click | `dty_schema_panel` | **MISSING** | with schema |

### 3e. Tooltips & markers

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Reference columns amber, name tooltip | `_apply_reference_columns` | **DONE** | |
| Violet note triangle + note tooltip | `_GridView` / `notes_at` | **DONE** | `has-note` class + `notesTip` |
| Ply header tooltip + yarn colour box | `header_rows["colours"]`, `colour_tooltip` | **DONE** | `MachineTable.tsx` |
| Generic cell tooltips (`md.cell_tooltips`) | `machine_tab` | **DONE** | `cell.tip` |
| Jet tooltip (jet details on JetID rows) | `jets_tooltip_map` | **MISSING** | not sent by `be/series_view.machine_data` |
| Spool row tooltips (single plies) | `md.spool_tooltips` | **MISSING** | not sent |
| Housing row: picture tooltip | `_HousingImageTooltipFilter` / `_RDHousingTooltipFilter` | **MISSING** | Qt filter; image path lookup in `machine_tab` |
| Live OF speed tooltip | `machine_tab` ("live OF speed tooltip") | **MISSING** | |
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
| Experiment Request icon in report header → popup | `_refresh_experiment_request_link` / `_open_experiment_request_popup` | **MISSING** | see ER popup |
| Help button "How does the Report work?" | `_open_help` | **MISSING** | data `help_texts_report` |
| Back to Show Experiment | `_go_back` | **DONE** | |
| Open report in new tab (Ctrl+click from lists) | `main._open_report_in_new_tab` | **PARTIAL** | browser tab works by URL; icons in lists not clickable |

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
| "Reset filters" button | `_reset_filters` | **MISSING** | frontend only |
| "Show details" (long free-text columns) | `_toggle_detail_columns` | **MISSING** | data already in `row.cells` |
| Refresh button | `refresh` | **DONE** | browser reload / reload on filter |
| Help "?" | `show_experiment_request_help` | **MISSING** | |
| Pending change Δ / NEW markers, row tooltip | `refresh` | **DONE** | |
| Double-click open (user → own pending copy; superuser with pending → review) | `_open_selected_request` | **DONE** | `open_id` / review card in `RequestForm.tsx` |
| Status dropdown (superuser) with denial reason / confirmation, owner notification | `_update_request_status` / `_notify_owner*` | **DONE** | `set_status` + `StatusDialog`; notify via `db/experiment_requests.notify_owner` (verify it is called on the web path) |
| Click Experiment ID → series picker → Show Experiment | `_on_cell_clicked` / `_open_experiment_series` | **MISSING** | ID shown as text only |
| Context: Assign experiment… (superuser, status Approved) | `_assign_experiment_to_request` | **PARTIAL** | backend `/assign-options` + `/assign` exist, no UI |
| Context: Review Changes… (side by side, accept/reject) | `_review_pending_change` | **DONE** | review card in `RequestForm.tsx` |
| Context: View/edit change proposal… | `_on_context_menu` | **PARTIAL** | reachable only via double-click routing |
| Context: View version history… (all users, own requests) | `show_version_history` (`ui/widgets/experiment_request_version_history.py`) | **MISSING** | `versions` loaded but not shown; data Qt-free `db/experiment_request_changes` |
| Form from schema, required fields marked, FK dropdowns, dates | `_load_schema_and_build_form` / `_mark_required_fields` | **DONE** | |
| Save (new / edit / proposal for normal users / unchanged) | `_save` | **DONE** | |
| Denial banner | form | **DONE** | |
| Unsaved-changes prompt when leaving the form | `_has_unsaved_changes` | **MISSING** | |
| "History…" button on the form | `_open_version_history` | **MISSING** | |
| Upload images | `_upload_images` | **PARTIAL** | only after first save (deliberate, see web CLAUDE.md) |
| Image viewer: zoom, rotate, list | `ExperimentRequestImagesDialog` | **PARTIAL** | thumbnails + open in new tab, no zoom/rotate |
| Image rename / batch rename / save as | `_rename_original_filename` / `BatchRenameDialog` / `_save_as_file` | **PARTIAL** | rename endpoint exists, no UI; save as = browser |
| Image delete (own / superuser) | `_delete_selected` | **DONE** | |
| Request PDFs dialog | `ExperimentRequestPdfsDialog` | **MISSING** | check whether still used on desktop |
| Read-only request popup from lists / Show Experiment / Report | `_ExperimentRequestReadOnlyDialog` | **MISSING** | see above |
| Draft cleanup at login | `main.py` login flow | **MISSING** | web CLAUDE.md: not needed while web saves before images |

## 7. Login, sidebar, account (`ui/screen_login.py`, `main.py`, `ui/widgets/sidebar*.py` → `fe/pages/Login.tsx`, `fe/components/Shell.tsx`, `be/auth.py`, `be/nav.py`)

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Login user + password, inactive user, wrong password | `_attempt_login` | **DONE** | same checks in `be/auth.py` |
| Password = username → forced change | `_attempt_login` | **PARTIAL** | refused with hint to use desktop |
| "Change Password" | `ui/screen_change_pw.py` | **MISSING** | Qt screen |
| Landing screen from Settings ("start") | `_go_landing` | **DONE** | `be/start_page.py` (web routes only) |
| Sidebar sections, collapse, narrow mode (logo click) | `sidebar.py` / `install_full_sidebar` | **DONE** | localStorage |
| Feature access (hide items) | `feature_access` / `_allowed` | **DONE** | `be/nav.py`, `require_feature` |
| Badges (Backlog, approved requests) | `nav_counts` | **DONE** | |
| Ctrl+click sidebar = new tab | `_wire_tab_capable_click` | **DONE** | browser (NavLink) |
| Notifications bell + panel (mark read, click opens series) | `notification_panel.py`, `ui/notifications.py` | **MISSING** | `ui/notifications.py` is Qt-free (create only; reading in panel/main) |
| Search (Ctrl+F quick search) | `main.py` `_sc_search` | **MISSING** | |
| Recent series menu | `show_recent_menu` | **MISSING** | Qt-free `ui/recent_series.py` |
| Knowledge Base | `screen_onboarding.py` | **DONE** | `pages/KnowledgeBase.tsx`, `backend/app/kb.py` (same HTML pages, tree, scene tabs, quiz → usage log, open:/tool: links). Popup from app cells (kb_popup) still missing, see Show Experiment |
| Help (F1) search | `help_search.py` | **DONE** | `fe/components/Help.tsx` (`HelpHost` in the Shell: F1 + sidebar entry), `be/help.py` on `ui/help_index`, `ui/kb_search`; same help_* usage events. KB hits navigate to the KB page (desktop: popup) |
| Ask AI in the help search | `help_ai.py` | **NOT IN WEB** | deliberately left out (user decision 2026-11-13) |
| Settings (text size, contrast, crosshair, start screen) | `display_prefs` / `user_settings_dialog` | **MISSING** | |
| Accent colour picker | `pick_accent_colour` | **PARTIAL** | colour applied, cannot be changed |
| "Fresh off the Spool" (What's new) + auto popup after login | `ui/whats_new.py` | **MISSING** | data `ui/widgets/whats_new_texts.py` |
| Log Out | `on_logout` | **DONE** | |
| Mode/DB banner (non-prod), version | footer / title | **DONE** | |
| Usage tracking of screen opens (`currentChanged` hook) | `main.py` | **PARTIAL** | web logs login + some features, no screen opens |
| Athena token reset at login | `main.py` | **MISSING** | only relevant with AI features |

## 8. Create Experiment / Add Trial Series / Add Lab Machines (`ui/screen_create_experiment.py` → `fe/pages/CreateExperiment.tsx`, `be/create_api.py`, logic `db/experiment_create.py`) – added 2026-11-13

| Feature | Desktop (file:function) | Web status | Notes / logic location |
|---|---|---|---|
| Tabs General / Material / Jet / Machine / Lab Machines with tick icons, Save only when all ticked | `_check_*` | **DONE** | checks in the page; server re-checks (`_check_save`) |
| General: product group, order type, experiment request (red border while open requests exist), project (locked to the request's), auto number, series name, backlog status (joker = Backlog, locked), priority | `_build_ui`, `_load_*`, `_sync_project_from_request` | **DONE** | `experiment_create.product_groups/order_types/projects/open_requests/request_project/next_experiment_number` |
| ER icon of the chosen request (popup) | `_open_selected_experiment_request_popup` | **DONE** | `RequestIcon` (modal, not non-modal) |
| Material tree by yarn group + search, colour square, stock symbol, ends, yarn use, spool choice | `_load_yarns`, `_add_material`, `SpoolPickerDialog` | **DONE** | `yarn_tree()`, `ply_label_for()`, `/api/create/spools` |
| Click on stock symbol → stock locations dialog | `_on_material_tree_clicked` | **PARTIAL** | `StockDialog`, `/api/create/stock`; data in `db/yarn_spools.py`. Button "Open in Yarn Stock" missing (no Yarn Stock in the web yet) |
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
