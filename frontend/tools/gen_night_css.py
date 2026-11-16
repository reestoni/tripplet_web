"""Build the dark looks of the web app (2026-11-16, Settings -> Look): src/theme-night.css ("Night") and
src/theme-blueprint.css ("Blueprint"). Each one is the modern look (html[data-theme="modern"]) plus a dark layer
(html[data-night] / html[data-blueprint]) made of:
  1. a GENERATED part: every rule of styles.css and theme-modern.css that sets a fixed light colour gets a dark twin
     (light surfaces -> dark surfaces with the same tint, dark text -> light text, light borders -> dark borders);
  2. the HAND-WRITTEN part from <name>_hand.css (tokens and the special touches) - it comes last and wins.
Rerun after changing styles.css / theme-modern.css (also checked by `npm run build`? no - run it by hand):
    python tools/gen_night_css.py
"""
import colorsys
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "src")
# one profile per dark look: attribute, hue/saturation of the neutral surfaces and how dark they are
PROFILES = {
    "night": {"attr": "data-night", "h": 220, "s": 0.22, "bg": 0.105, "text_s": 0.12, "border": 0.17},
    "blueprint": {"attr": "data-blueprint", "h": 211, "s": 0.62, "bg": 0.20, "text_s": 0.35, "border": 0.36},
}
NIGHT = 'html[data-night]'
BG_L, TEXT_S, BORDER_L, ATTR = 0.105, 0.12, 0.17, "data-night"
MODERN = 'html[data-theme="modern"]'

NAMED = {"white": (255, 255, 255), "black": (0, 0, 0), "#fff": (255, 255, 255), "#000": (0, 0, 0)}
COLOUR_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b")
SKIP_SELECTORS = ("set-theme-swatch",)          # the previews of the looks keep their own colours


def parse(tok):
    t = tok.lower()
    if t in NAMED:
        return (*NAMED[t], 1.0)
    if t.startswith("#"):
        h = t[1:]
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return r, g, b, a
    nums = [x.strip() for x in t[t.index("(") + 1:-1].replace("/", ",").split(",") if x.strip()]
    if len(nums) < 3 or any("%" in n for n in nums[:3]):
        return None
    r, g, b = (float(n) for n in nums[:3])
    a = float(nums[3].rstrip("%")) / (100 if nums[3].endswith("%") else 1) if len(nums) > 3 else 1.0
    return r, g, b, a


def fmt(r, g, b, a):
    r, g, b = (max(0, min(255, round(v))) for v in (r, g, b))
    if a >= 0.999:
        return f"#{r:02x}{g:02x}{b:02x}"
    return f"rgba({r}, {g}, {b}, {round(a, 3)})"


def hls(c):
    return colorsys.rgb_to_hls(c[0] / 255, c[1] / 255, c[2] / 255)


def from_hls(h, l, s, a):
    r, g, b = colorsys.hls_to_rgb(h, max(0, min(1, l)), max(0, min(1, s)))
    return fmt(r * 255, g * 255, b * 255, a)


NEUTRAL_H, NEUTRAL_S = 220 / 360, 0.22            # the night greys are slightly blue


def map_bg(c):
    h, l, s = hls(c)
    a = c[3]
    if l < 0.25 and a < 0.3:                       # light dark-overlays (hover) -> light overlays
        return fmt(255, 255, 255, min(0.12, a * 1.2))
    if l >= 0.86:
        if s < 0.25 or l > 0.985:                  # white / grey surfaces
            return from_hls(NEUTRAL_H, BG_L + (1 - l) * 0.55, NEUTRAL_S, a)
        return from_hls(h, BG_L + 0.045 + (1 - l) * 0.35, min(s, 0.5), a)   # tinted surfaces keep their tint
    if l >= 0.72 and s < 0.9:
        return from_hls(h, BG_L + 0.165, min(s, 0.5), a)
    return None


def map_text(c):
    h, l, s = hls(c)
    if l >= 0.5:
        return None
    if s < 0.2:
        return from_hls(NEUTRAL_H, 0.93 - l * 0.6, TEXT_S, c[3])
    return from_hls(h, max(0.66, 1 - l), min(s, 0.8), c[3])


def map_border(c):
    h, l, s = hls(c)
    if l < 0.6:
        return None
    if s < 0.25:
        return from_hls(NEUTRAL_H, BORDER_L + (1 - l) * 0.35, NEUTRAL_S, c[3])
    return from_hls(h, 0.22 + (1 - l) * 0.3, min(s, 0.45), c[3])


def map_shadow(c):
    h, l, s = hls(c)
    if l > 0.9 and c[3] > 0.5:                     # white rings (badges on white) -> card colour
        return map_bg(c)
    return None


def kind(prop):
    if prop in ("background", "background-color", "background-image"):
        return map_bg
    if prop in ("color", "fill"):
        return map_text
    if prop.startswith("border") or prop.startswith("outline") or prop == "column-rule":
        return map_border
    if prop == "box-shadow":
        return map_shadow
    return None


def convert_value(prop, value):
    fn = kind(prop)
    if fn is None or "var(" in value and not COLOUR_RE.search(value.replace("var(", "")):
        return None
    changed = False

    def sub(m):
        nonlocal changed
        c = parse(m.group(0))
        if c is None:
            return m.group(0)
        out = fn(c)
        if out is None:
            return m.group(0)
        changed = True
        return out
    new = COLOUR_RE.sub(sub, value)
    return new if changed else None


BRIGHT_VARS = ("var(--accent)", "var(--mustard)", "var(--xh-label)", "var(--danger)")


def keeps_bright(value):
    """background that stays bright in the night look (signal colours, accent) - its text keeps its colour"""
    if any(v in value for v in BRIGHT_VARS):
        return True
    for m in COLOUR_RE.finditer(value):
        c = parse(m.group(0))
        if c and c[3] > 0.5 and map_bg(c) is None and hls(c)[1] > 0.45:
            return True
    return False


def prefix(sel):
    out, parts, depth, cur = [], [], 0, ""
    for ch in sel:                                  # split at top-level commas only (not inside :is(...))
        depth += ch == "("
        depth -= ch == ")"
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    for s in parts:
        s = s.strip()
        if not s:
            continue
        if s.startswith(MODERN):
            out.append(MODERN + f"[{ATTR}]" + s[len(MODERN):])
        elif s in (":root", "html"):
            out.append(NIGHT)
        elif s.startswith("html"):
            out.append(NIGHT + s[4:])
        else:
            out.append(f"{NIGHT} {s}")
    return ", ".join(out)


def split_rules(css):
    """yield (selector, body) and ('@media ...', [nested]) at top level"""
    i, n = 0, len(css)
    while i < n:
        j = css.find("{", i)
        if j < 0:
            return
        head = css[i:j].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == "{":
                depth += 1
            elif css[k] == "}":
                depth -= 1
            k += 1
        body = css[j + 1:k - 1]
        yield head, body
        i = k


def convert(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out = []
    for head, body in split_rules(css):
        if head.startswith("@keyframes"):
            continue
        if head.startswith("@media"):
            inner = convert(body)
            if inner.strip():
                out.append(f"{head} {{\n{inner}}}\n")
            continue
        if any(x in head for x in SKIP_SELECTORS):
            continue
        pairs = []
        for d in body.split(";"):
            if ":" not in d:
                continue
            prop, val = d.split(":", 1)
            pairs.append((prop.strip().lower(), val.strip()))
        bright_bg = any(kind(p) is map_bg and keeps_bright(v) for p, v in pairs)
        decls = []
        for prop, val in pairs:
            if prop.startswith("--"):
                continue                            # tokens are set by hand
            if bright_bg and kind(prop) is map_text:
                continue                            # dark text on a bright badge/button stays readable as it is
            new = convert_value(prop, val)
            if new is not None:
                decls.append(f"{prop}: {new}")
        if decls:
            out.append(f"{prefix(head)} {{ {'; '.join(decls)}; }}\n")
    return "".join(out)


def main():
    global NIGHT, BG_L, TEXT_S, BORDER_L, ATTR, NEUTRAL_H, NEUTRAL_S
    for name, p in PROFILES.items():
        ATTR, NIGHT = p["attr"], f"html[{p['attr']}]"
        NEUTRAL_H, NEUTRAL_S = p["h"] / 360, p["s"]
        BG_L, TEXT_S, BORDER_L = p["bg"], p["text_s"], p["border"]
        parts = [f"/* TrippleT web - \"{name}\" look. GENERATED by frontend/tools/gen_night_css.py - do not edit here;\n"
                 f"   hand-written rules belong in tools/{name}_hand.css. Active only under {NIGHT} (+ modern). */\n\n"]
        for css in ("styles.css", "theme-modern.css"):
            with open(os.path.join(SRC, css), encoding="utf-8") as f:
                parts.append(f"/* ---- dark twins of {css} ---- */\n" + convert(f.read()) + "\n")
        with open(os.path.join(HERE, f"{name}_hand.css"), encoding="utf-8") as f:
            parts.append(f"/* ---- hand-written (tools/{name}_hand.css) ---- */\n" + f.read())
        with open(os.path.join(SRC, f"theme-{name}.css"), "w", encoding="utf-8", newline="\n") as f:
            f.write("".join(parts))
        print(f"theme-{name}.css written")


if __name__ == "__main__":
    main()
