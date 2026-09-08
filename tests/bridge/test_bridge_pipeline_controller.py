import unittest
from unittest.mock import patch

from el_sbobinator.bridge.controllers.pipeline_controller import PipelineControllerMixin


class DummyPipelineController(PipelineControllerMixin):
    def __init__(self):
        self.console_messages: list[str] = []

    def _push_console(self, msg: str) -> None:
        self.console_messages.append(msg)


class TestPipelineControllerConfigPersistence(unittest.TestCase):
    def test_persist_processing_config_success(self):
        ctrl = DummyPipelineController()
        with patch(
            "el_sbobinator.bridge.controllers.pipeline_controller.save_config"
        ) as mock_save:
            ctrl._persist_processing_config(
                "key123", "gemini-2.5-flash", ["gemini-2.5-pro"]
            )
            mock_save.assert_called_once_with(
                "key123",
                preferred_model="gemini-2.5-flash",
                fallback_models=["gemini-2.5-pro"],
            )
            self.assertEqual(ctrl.console_messages, [])

    def test_persist_processing_config_os_error_pushes_console(self):
        ctrl = DummyPipelineController()
        with patch(
            "el_sbobinator.bridge.controllers.pipeline_controller.save_config",
            side_effect=OSError("Permission denied"),
        ):
            ctrl._persist_processing_config("key123", None, None)
            self.assertEqual(len(ctrl.console_messages), 1)
            self.assertIn("Impossibile salvare", ctrl.console_messages[0])
            self.assertIn("Permission denied", ctrl.console_messages[0])

    def test_persist_processing_config_unexpected_exception_pushes_console(self):
        ctrl = DummyPipelineController()
        with patch(
            "el_sbobinator.bridge.controllers.pipeline_controller.save_config",
            side_effect=RuntimeError("Disk corrupted"),
        ):
            ctrl._persist_processing_config("key123", None, None)
            self.assertEqual(len(ctrl.console_messages), 1)
            self.assertIn("Errore imprevisto", ctrl.console_messages[0])
            self.assertIn("Disk corrupted", ctrl.console_messages[0])
