"""Compatibility for native file dialogs in pywebview 5 and 6."""

from typing import Any, Literal


def file_dialog_type(
    webview_module: Any, kind: Literal["OPEN", "SAVE", "FOLDER"]
) -> int:
    """Prefer the current enum, falling back to pywebview 5's constants."""
    dialog_enum = getattr(webview_module, "FileDialog", None)
    if dialog_enum is not None:
        return int(getattr(dialog_enum, kind))
    return int(getattr(webview_module, f"{kind}_DIALOG"))
