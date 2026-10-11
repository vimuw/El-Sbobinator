from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from el_sbobinator.bridge.controllers.media_controller import MediaControllerMixin
from el_sbobinator.utils.webview_dialogs import file_dialog_type


@pytest.mark.parametrize("kind,value", [("OPEN", 10), ("FOLDER", 20), ("SAVE", 30)])
@pytest.mark.parametrize("modern", [True, False])
def test_resolves_all_dialog_types(kind, value, modern):
    module = (
        SimpleNamespace(FileDialog=SimpleNamespace(**{kind: value}))
        if modern
        else SimpleNamespace(**{f"{kind}_DIALOG": value})
    )
    assert file_dialog_type(module, kind) == value


def test_prefers_current_enum_over_deprecated_constants():
    module = SimpleNamespace(FileDialog=SimpleNamespace(OPEN=10))
    assert file_dialog_type(module, "OPEN") == 10


@pytest.mark.parametrize("method", ["ask_files", "ask_media_file"])
@pytest.mark.parametrize("selected", [True, False])
@pytest.mark.parametrize("retry_without_filters", [True, False])
def test_media_picker_works_without_file_dialog_enum(
    method: str, selected: bool, retry_without_filters: bool
):
    window = MagicMock()
    dialog_result = ["lesson.mp3"] if selected else None
    window.create_file_dialog.side_effect = (
        [RuntimeError("Unsupported filters"), dialog_result]
        if retry_without_filters
        else [dialog_result]
    )
    descriptor = {"name": "lesson.mp3", "path": "lesson.mp3", "size": 3}
    host = SimpleNamespace(
        _window=window, _build_valid_media_descriptor=MagicMock(return_value=descriptor)
    )
    # The source launcher can use pywebview 5, which has only OPEN_DIALOG.
    with patch(
        "el_sbobinator.bridge.controllers.media_controller.webview",
        SimpleNamespace(OPEN_DIALOG=10),
    ):
        result = getattr(MediaControllerMixin, method)(host)

    assert result == (
        ([descriptor] if selected else [])
        if method == "ask_files"
        else (descriptor if selected else None)
    )
    for call in window.create_file_dialog.call_args_list:
        assert call.args == (10,)
        assert call.kwargs["allow_multiple"] == (method == "ask_files")
    if selected:
        host._build_valid_media_descriptor.assert_called_once_with("lesson.mp3")
    else:
        host._build_valid_media_descriptor.assert_not_called()
