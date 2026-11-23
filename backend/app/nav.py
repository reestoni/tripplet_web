"""nav.py - the sidebar as data, same sections/order/rights as the desktop
(ui/widgets/sidebar_nav.py::install_full_sidebar). Who sees what: only
db/feature_access.py (shared with the desktop).

`web` = already built in the web app; all other entries are shown (so the
structure is complete) and open a "not in the web version yet" page.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from . import core  # noqa: F401

from db import feature_access as fa  # noqa: E402
from db import nav_counts  # noqa: E402

# (feature key or None = always, label, icon, route, badge key)
Item = Tuple[Optional[str], str, str, str, Optional[str]]

SECTIONS: List[Tuple[str, str, List[Item]]] = [
    ("Navigation", "experiment_white.png", [
        ("all_experiments", "All Experiments", "show.png", "/experiments", None),
        ("backlog", "Backlog", "backlog.png", "/backlog", "backlog"),
        ("new_experiment", "New Experiment", "create.png", "/experiments/new", "approved_requests"),
        ("add_series", "Add Trial Series", "series.png", "/series/new", None),
        ("add_lab_machines", "Add Lab Machines", "lab.png", "/lab-machines/new", None),
    ]),
    ("Experiment Requests", "experiment_requests_section_white.png", [
        ("create_request", "Create Experiment Request", "create_experiment_request.png", "/requests/new", None),
        ("my_requests", "My Requests", "my_experiment_requests.png", "/requests", "my_requests"),
    ]),
    ("Tools", "tools.png", [
        ("image_compare", "Image Compare", "image_compare.png", "/tools/image-compare", None),
        ("canvas", "Canvas", "canvas.png", "/tools/canvas", None),
        ("jet_roi", "Jet ROI Calculator", "nozzle_calculator.png", "/tools/jet-roi", None),
        ("air_supply", "Air Supply Network", "air_supply.png", "/tools/air-supply", None),
        ("yarn_count", "Yarn Count Converter", "yarn_count.png", "/tools/yarn-count", None),
        ("process_playground", "Process Playground", "process_playground.png", "/tools/process-playground", None),
        ("jet_advisor", "Jet Advisor", "jet_advisor.png", "/tools/jet-advisor", None),
        ("dashboards", "Dashboards", "dashboards.png", "/tools/dashboards", None),
        ("requirement_hub", "Requirement Hub", "requirement_hub.png", "/tools/requirement-hub", None),
        ("smart_chart", "Smart Chart", "analytics.png", "/tools/smart-chart", None),
        ("yarn_stock", "Yarn Stock", "manage_yarn.png", "/tools/yarn-stock", None),
        ("label_generator", "Label Generator", "label.png", "/tools/label-generator", None),
        ("tdms_inspector", "TDMS Inspector", "tdms_inspector.png", "/tools/tdms-inspector", None),
        ("tdms_inspector", "YarnScope Live", "tdms_inspector.png", "/tools/yarnscope-live", None),
    ]),
    ("Admin", "admin_white.png", [
        ("manage_jets", "Jets", "", "/admin/jets", None),
        ("top_plates", "Top Plates", "", "/admin/top-plates", None),
        ("manage_yarn", "Yarn", "", "/admin/yarn", None),
        ("order_type", "Order Type", "", "/admin/order-types", None),
        ("product_groups", "Product Groups", "", "/admin/product-groups", None),
        ("material", "Material", "", "/admin/material", None),
        ("projects", "Projects", "", "/admin/projects", None),
    ]),
]

# superuser-only, not switchable (as on the desktop); left out on purpose: Offline Sync (no meaning in the web
# app), Lab Assistant (an AI chat - no AI in the web) and Usage Stats (not needed in the web; user decisions 2026-11-13)
SUPERUSER_ITEMS: List[Item] = [
    (None, "Manage User", "", "/superuser/users", None),
    (None, "Recycle Bin", "", "/superuser/recycle-bin", None),
]

PINNED: List[Item] = [
    (None, "Knowledge Base", "onboarding.png", "/knowledge-base", None),
    (None, "Help (F1)", "help_tour.png", "/help", None),
]

# routes that already work in the web app
WEB_READY: set = {"/experiments", "/backlog", "/requests", "/requests/new", "/knowledge-base",
                  "/experiments/new", "/series/new", "/lab-machines/new", "/help", "/admin/jets", "/admin/yarn", "/admin/top-plates", "/admin/order-types", "/admin/product-groups", "/admin/material", "/admin/projects", "/tools/yarn-stock", "/superuser/users", "/settings", "/tools/smart-chart", "/tools/dashboards", "/superuser/recycle-bin", "/tools/requirement-hub", "/tools/process-playground", "/tools/jet-advisor", "/tools/canvas", "/tools/tdms-inspector", "/tools/yarnscope-live", "/tools/label-generator", "/tools/image-compare", "/tools/air-supply", "/tools/jet-roi", "/tools/yarn-count"}


def _badges(keys: set) -> Dict[str, int]:
    out: Dict[str, int] = {}
    if "backlog" in keys:
        out["backlog"] = nav_counts.get_backlog_count()
    if "approved_requests" in keys:
        out["approved_requests"] = nav_counts.get_approved_experiment_request_count()
    if "my_requests" in keys:
        out["my_requests"] = nav_counts.get_pending_request_changes_count()
    return out


# icons of the entries the desktop sidebar shows without one (Admin, Superuser) - web only, both looks
# (Nutzerwunsch 2026-11-16); drawn in the style of the other green icons
WEB_ICONS: Dict[str, str] = {
    "/admin/jets": "sb_jets.png", "/admin/top-plates": "sb_top_plates.png", "/admin/yarn": "sb_yarn.png",
    "/admin/order-types": "sb_order_type.png", "/admin/product-groups": "sb_product_groups.png",
    "/admin/material": "sb_material.png", "/admin/projects": "sb_projects.png", "/superuser/users": "sb_users.png", "/superuser/recycle-bin": "sb_recycle_bin.png",
}


def _item(it: Item, badges: Dict[str, int]) -> Dict[str, Any]:
    key, label, icon, route, badge = it
    return {"key": key or route, "label": label, "icon": icon or WEB_ICONS.get(route), "route": route,
            "badge": badges.get(badge, 0) if badge else 0, "web": route in WEB_READY}


def build_nav(user: Dict[str, Any]) -> Dict[str, Any]:
    uid = user.get("id")
    level = int(user.get("access_level") or 0)
    rules = fa.rules_for(int(uid) if uid is not None else None, level)

    def allowed(key: Optional[str]) -> bool:
        return key is None or fa.decide(key, level, rules["user"], rules["groups"])

    visible = [(title, icon, [it for it in items if allowed(it[0])]) for title, icon, items in SECTIONS]
    if level >= fa.SUPERUSER_LEVEL:
        visible.append(("Superuser", "superuser.png", SUPERUSER_ITEMS))
    badges = _badges({it[4] for _, _, items in visible for it in items if it[4]})
    return {
        "pinned": [_item(it, badges) for it in PINNED],
        "sections": [{"title": t, "icon": i, "items": [_item(it, badges) for it in items]}
                     for t, i, items in visible if items],
    }


def allowed_routes(user: Dict[str, Any]) -> set:
    nav = build_nav(user)
    routes = {it["route"] for it in nav["pinned"]}
    for s in nav["sections"]:
        routes.update(it["route"] for it in s["items"])
    return routes
