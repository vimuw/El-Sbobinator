"""
Markdown -> HTML export utilities for El Sbobinator.

Used for local HTML output (copy/paste into Docs) with basic sanitization.
"""

from __future__ import annotations

import html as _html
import json
import re
from itertools import pairwise
from pathlib import Path

_DOCUMENT_FORMATTING = json.loads(
    (Path(__file__).resolve().parent.parent / "document_formatting.json").read_text(
        encoding="utf-8"
    )
)

_ALLOWED_TAGS: frozenset[str] = frozenset(
    {
        "p",
        "br",
        "hr",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "strong",
        "em",
        "u",
        "s",
        "mark",
        "code",
        "pre",
        "sub",
        "sup",
        "ul",
        "ol",
        "li",
        "blockquote",
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "th",
        "td",
        "colgroup",
        "col",
        "caption",
        "a",
        "span",
        "div",
        "img",
        "figcaption",
    }
)

_ALLOWED_ATTRS: dict[str, set[str]] = {
    **{
        tag: {"data-editor-empty-marks", "data-generated-space-before"}
        for tag in ("p", "h1", "h2", "h3", "h4", "h5", "h6")
    },
    "*": {
        "style",
        "class",
        "data-editor-image",
        "data-layout",
        "data-align",
        "data-width",
        "data-position",
        "data-offset-y",
        "data-offset-x",
        "data-aspect-ratio",
        "data-caption",
        "data-math",
        "data-math-block",
        "data-document-line-spacing",
        "align",
    },
    "a": {"href", "title", "target"},
    "ol": {"start", "type"},
    "img": {"src", "alt", "width", "height", "align"},
    "th": {"colspan", "rowspan", "colwidth", "width", "scope"},
    "td": {"colspan", "rowspan", "colwidth", "width"},
    "col": {"width", "span"},
    "colgroup": {"span"},
    "table": {"border", "cellpadding", "cellspacing"},
}

_ALLOWED_URL_SCHEMES: frozenset[str] = frozenset({"http", "https", "mailto", "data"})


def sanitize_html_basic(html: str, *, strip_document_head: bool = False) -> str:
    # Sanitizzazione tramite allowlist (nh3/ammonia) — blocca tag/attributi non permessi
    # e schemi URL pericolosi (javascript:, vbscript:). data: è permesso per src img inline.
    try:
        import nh3 as _nh3
    except ImportError:  # pragma: no cover
        _nh3 = None  # type: ignore[assignment]

    if _nh3 is None:  # pragma: no cover
        raise ImportError(
            "nh3 is required for HTML sanitization. Install it with: pip install nh3"
        )
    return _nh3.clean(
        html or "",
        tags=set(_ALLOWED_TAGS),
        attributes=_ALLOWED_ATTRS,
        url_schemes=set(_ALLOWED_URL_SCHEMES),
        strip_comments=True,
        clean_content_tags={"head", "title", "script", "style"}
        if strip_document_head
        else None,
    )


def normalize_inline_star_lists(md: str) -> str:
    # Normalizza elenchi che a volte l'AI produce in modo non-standard.
    src = (md or "").replace("\u00a0", " ")

    list_line_re = r"^\s*([*+-]|\d+\.)\s+"
    # Bullet unicode che il modello usa spesso (e che Markdown non interpreta come liste).
    bullet_top = ("\u25cf", "\u2022", "\u25aa", "\u2023", "\u25a0")  # ● • ▪ ‣ ■

    # 1) Trasforma elenchi in-line tipo "Esempi: * Voce1 ... * Voce2 ..."
    out_lines = []
    in_fence = False
    for line in src.splitlines():
        s = line.strip()
        if s.startswith("```"):
            in_fence = not in_fence
            out_lines.append(line)
            continue
        if in_fence:
            out_lines.append(line)
            continue

        # Caso A: riga che INIZIA con bullet unicode -> lista Markdown.
        if not re.match(list_line_re, line):
            m = re.match(
                r"^(\s*)([\u25cf\u2022\u25aa\u2023\u25e6\u25cb\u2219\u25a0\u25a1])\s+(.*)$",
                line,
            )
            if m:
                bullet = m.group(2)
                rest = m.group(3).strip()
                if rest:
                    prefix = "- " if bullet in bullet_top else "    - "
                    out_lines.append(prefix + rest)
                    continue

        # Caso B: bullet unicode "in mezzo" a una riga -> spezza in lista.
        if not re.match(list_line_re, line) and re.search(
            r"[\u25cf\u2022\u25aa\u2023\u25a0\u25a1]\s+(\*\*|[A-ZÀ-ÖØ-Ý])", line
        ):
            if re.search(r"\s[\u25cf\u2022\u25aa\u2023\u25a0\u25a1]\s+", line):
                parts = re.split(r"\s*[\u25cf\u2022\u25aa\u2023\u25a0\u25a1]\s+", line)
                if len(parts) > 1:
                    first = (parts[0] or "").rstrip()
                    if first:
                        out_lines.append(first)
                    for item in parts[1:]:
                        item = (item or "").strip()
                        if item:
                            out_lines.append("- " + item)
                    continue

        # Converti solo se:
        # - c'e' un ":" seguito da "* " (tipico "Esempi: * ... * ...")
        if not re.match(r"^\s*([*+-]|\d+\.)\s+", line) and re.search(
            r":[ \t]*\*[ \t]+(\*\*|[A-ZÀ-ÖØ-Ý])", line
        ):
            if line.count("* ") >= 1:
                line2 = re.sub(r":[ \t]*\*[ \t]+", ":\n\n- ", line, count=1)
                line2 = re.sub(r"[ \t]+\*[ \t]+", "\n- ", line2)
                out_lines.extend(line2.splitlines())
                continue

        out_lines.append(line)

    mid = "\n".join(out_lines)

    # 2) Python-Markdown spesso richiede una riga vuota prima di una lista per riconoscerla.
    fixed = []
    in_fence = False
    for line in mid.splitlines():
        s = line.strip()
        if s.startswith("```"):
            in_fence = not in_fence
            fixed.append(line)
            continue
        if in_fence:
            fixed.append(line)
            continue

        is_list = bool(re.match(r"^\s{0,3}([*+-]|\d+\.)\s+", line))
        if is_list and fixed:
            prev = fixed[-1]
            prev_is_list = bool(re.match(r"^\s{0,3}([*+-]|\d+\.)\s+", prev))
            if prev.strip() != "" and not prev_is_list:
                fixed.append("")

        fixed.append(line)

    return "\n".join(fixed)


def normalize_heading_levels(md: str) -> str:
    # Limita i titoli esportati a h1-h5, comprimendo eventuali livelli piu' profondi.
    lines: list[str] = []
    in_fence = False

    for line in (md or "").splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            lines.append(line)
            continue

        if in_fence:
            lines.append(line)
            continue

        match = re.match(r"^(\s*)(#{1,})\s+(.*)$", line)
        if not match:
            lines.append(line)
            continue

        indent, hashes, content = match.groups()
        level = min(len(hashes), 5)
        lines.append(f"{indent}{'#' * level} {content.strip()}")

    return "\n".join(lines)


def build_html_document(title: str, markdown_text: str) -> str:
    import markdown

    normalized_markdown = normalize_heading_levels(markdown_text or "")
    html_body = markdown.markdown(
        normalized_markdown, extensions=["extra", "sane_lists"], output_format="html"
    )
    return build_html_document_from_body(title, space_generated_blocks(html_body))


def space_generated_blocks(html_body: str) -> str:
    """Separate generated prose/list blocks without changing the editor defaults."""
    from bs4 import BeautifulSoup, Tag  # type: ignore[import-untyped]

    soup = BeautifulSoup(html_body, "html.parser")
    gap = round(
        _DOCUMENT_FORMATTING["fontSizePt"] * _DOCUMENT_FORMATTING["lineHeight"], 2
    )
    # List items, nested lists and table cells keep their own compact layout.
    for container in [soup, *soup.find_all("blockquote")]:
        blocks = [child for child in container.children if isinstance(child, Tag)]
        for previous, current in pairwise(blocks):
            if previous.name not in {"p", "ul", "ol"} or current.name not in {
                "p",
                "ul",
                "ol",
            }:
                continue
            anchor = current
            if current.name in {"ul", "ol"}:
                item = current.find("li", recursive=False)
                if item is None:
                    continue
                anchor = item.find("p", recursive=False)
                if anchor is None:
                    anchor = soup.new_tag("p")
                    # Tight Markdown lists have bare inline content in each li.
                    # Wrap the first item's text, leaving its child list intact.
                    for child in list(item.contents):
                        if isinstance(child, Tag) and child.name in {
                            "ul",
                            "ol",
                            "pre",
                            "table",
                            "blockquote",
                        }:
                            break
                        anchor.append(child.extract())
                    item.insert(0, anchor)
            style = str(anchor.get("style", ""))
            if re.search(r"(?:^|;)\s*margin(?:-top)?\s*:", style):
                continue
            anchor["data-generated-space-before"] = str(gap)
            anchor["style"] = f"{style.rstrip(';')};margin-top:{gap}pt".lstrip(";")
    return str(soup)


def normalize_imported_html(title: str, html: str) -> str:
    # nh3's HTML5 parser also handles omitted head/body tags without losing text.
    return build_html_document_from_body(title, html, strip_document_head=True)


def build_html_document_from_body(
    title: str, html_body: str, *, strip_document_head: bool = False
) -> str:
    """Wrap sanitized HTML in the same trusted document used by Markdown exports."""
    html_body = sanitize_html_basic(html_body, strip_document_head=strip_document_head)
    safe_title = (title or "Sbobina").strip()
    safe_title_html = _html.escape(safe_title, quote=True)
    formatting = _DOCUMENT_FORMATTING
    heading_css = "\n    ".join(
        f"h{level} {{ font-size: {style['fontSizePt']}pt; "
        f"line-height: {style['lineHeight']}; "
        f"margin: {style['beforePt']}pt 0 {style['afterPt']}pt; "
        f"font-weight: {style['fontWeight']}; color: {style['color']}; }}"
        for level, style in enumerate(formatting["headings"], 1)
    )
    suppress_heading_css = ", ".join(
        f"h{level} + p" for level in formatting["suppressMarginAfterHeadingLevels"]
    )
    # CSP: evita script e richieste di rete anche se l'AI inserisse tag HTML.
    csp = (
        "default-src 'none'; "
        "base-uri 'none'; "
        "form-action 'none'; "
        "frame-ancestors 'none'; "
        "connect-src 'none'; "
        "img-src data:; "
        "font-src data:; "
        "media-src 'none'; "
        "style-src 'unsafe-inline'"
    )
    return f"""<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="{csp}" />
  <meta http-equiv="Referrer-Policy" content="no-referrer" />
  <title>{safe_title_html} - Sbobina</title>
  <style>
    :root {{
      --text: #000;
      --muted: #444;
      --bg: #fff;
      --rule: #e6e6e6;
    }}
    body {{
      font-family: {formatting["fontFamily"]}, Helvetica, sans-serif;
      font-size: {formatting["fontSizePt"]}pt;
      line-height: {formatting["lineHeight"]};
      color: var(--text);
      background: var(--bg);
      max-width: 980px;
      margin: 0 auto;
      padding: 48px 22px;
    }}
    {heading_css}
    p {{ margin: {formatting["paragraphGapPt"]}pt 0; }}
    body > p:first-child{", " + suppress_heading_css if suppress_heading_css else ""} {{ margin-top: 0; }}
    body > p:last-child {{ margin-bottom: 0; }}
    li {{ margin: 0; }}
    ul, ol {{ padding-left: 36pt; margin-top: 0; margin-bottom: 0; }}
    strong {{ font-weight: 700; }}
    a {{ color: #1155cc; }}
    hr {{ display: none; }}
    code {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 0.95em; }}
    blockquote {{ margin: 0.9rem 0; padding: 0.1rem 0 0.1rem 1rem; border-left: 3px solid var(--rule); color: var(--muted); }}
    table {{ border-collapse: collapse; width: 100%; margin: 1.2rem 0; font-size: 0.95em; }}
    th, td {{ border: 1px solid var(--rule); padding: {formatting["table"]["paddingVerticalPt"]}pt {formatting["table"]["paddingHorizontalPt"]}pt; text-align: left; vertical-align: top; }}
    th {{ background: #f8f9fa; font-weight: 700; }}
  </style>
</head>
<body>
{html_body}
</body>
</html>
"""
