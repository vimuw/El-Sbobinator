import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from el_sbobinator.utils import source_bootstrap


class SourceBootstrapTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.environment = self.root / ".venv"
        scripts = self.environment / "Scripts"
        scripts.mkdir(parents=True)
        for name in ("python.exe", "pythonw.exe"):
            (scripts / name).touch()
        (self.environment / "pyvenv.cfg").touch()
        self.launcher = self.root / "launchers" / "app.pyw"
        platform = patch.object(source_bootstrap.sys, "platform", "win32")
        platform.start()
        self.addCleanup(platform.stop)
        frontend = patch(
            "el_sbobinator.utils.dependency_versions.verify_frontend_build"
        )
        frontend.start()
        self.addCleanup(frontend.stop)

    def test_global_pythonw_relaunches_in_project_venv_with_arguments_and_spaces(self):
        with (
            patch.object(source_bootstrap.sys, "prefix", str(self.root / "global")),
            patch.object(
                source_bootstrap.sys,
                "executable",
                str(self.root / "global" / "pythonw.exe"),
            ),
            patch.object(
                source_bootstrap.sys, "argv", [str(self.launcher), "a file.wav"]
            ),
            patch.object(source_bootstrap.subprocess, "Popen") as child,
        ):
            with self.assertRaises(SystemExit) as exit_result:
                source_bootstrap.prepare_source_environment(self.root, self.launcher)
        self.assertEqual(exit_result.exception.code, 0)
        self.assertEqual(
            child.call_args.args[0],
            [
                str(self.environment / "Scripts" / "pythonw.exe"),
                str(self.launcher),
                "a file.wav",
            ],
        )
        self.assertEqual(child.call_args.kwargs["cwd"], str(self.root))
        self.assertEqual(
            child.call_args.kwargs["env"]["EL_SBOBINATOR_SOURCE_RELAUNCH"],
            str(self.root),
        )
        self.assertNotIn("PYTHONHOME", child.call_args.kwargs["env"])
        self.assertNotIn("PYTHONPATH", child.call_args.kwargs["env"])

    def test_current_venv_checks_pins_without_relaunch_loop(self):
        with (
            patch.object(source_bootstrap.sys, "prefix", str(self.environment)),
            patch(
                "el_sbobinator.utils.dependency_versions.verify_dependencies"
            ) as verify,
            patch.object(source_bootstrap.subprocess, "Popen") as child,
        ):
            source_bootstrap.prepare_source_environment(self.root, self.launcher)
        verify.assert_called_once_with(self.root)
        child.assert_not_called()

    def test_missing_venv_and_outdated_pins_show_actionable_error(self):
        for missing in (False, True):
            with self.subTest(missing=missing):
                if missing:
                    (self.environment / "pyvenv.cfg").unlink()
                with (
                    patch.object(source_bootstrap.sys, "prefix", str(self.environment)),
                    patch(
                        "el_sbobinator.utils.dependency_versions.verify_dependencies",
                        side_effect=RuntimeError("pywebview: 5.4"),
                    ),
                    patch.object(source_bootstrap, "show_startup_error") as message,
                ):
                    with self.assertRaises(SystemExit) as failure:
                        source_bootstrap.prepare_source_environment(
                            self.root, self.launcher
                        )
                self.assertEqual(failure.exception.code, 1)
                self.assertIn("Aggiorna_App_Locale.ps1", message.call_args.args[0])
                if not missing:
                    self.assertIn("pywebview: 5.4", message.call_args.args[0])

    def test_frozen_app_does_not_require_source_venv_or_manifest(self):
        with (
            patch.object(source_bootstrap.sys, "frozen", True, create=True),
            patch(
                "el_sbobinator.utils.dependency_versions.verify_dependencies"
            ) as verify,
            patch.object(source_bootstrap.subprocess, "Popen") as child,
        ):
            source_bootstrap.prepare_source_environment(
                self.root / "missing", self.launcher
            )
        verify.assert_not_called()
        child.assert_not_called()

    def test_console_relaunch_propagates_child_failure(self):
        with (
            patch.object(source_bootstrap.sys, "prefix", str(self.root / "global")),
            patch.object(source_bootstrap.sys, "executable", "python.exe"),
            patch.object(source_bootstrap.subprocess, "call", return_value=7),
        ):
            with self.assertRaises(SystemExit) as failure:
                source_bootstrap.prepare_source_environment(self.root, self.launcher)
        self.assertEqual(failure.exception.code, 7)

    def test_broken_environment_cannot_spawn_a_relaunch_loop(self):
        with (
            patch.object(source_bootstrap.sys, "prefix", str(self.root / "global")),
            patch.dict(
                source_bootstrap.os.environ,
                {"EL_SBOBINATOR_SOURCE_RELAUNCH": str(self.root)},
            ),
            patch.object(source_bootstrap, "show_startup_error") as message,
            patch.object(source_bootstrap.subprocess, "call") as child,
        ):
            with self.assertRaises(SystemExit) as failure:
                source_bootstrap.prepare_source_environment(self.root, self.launcher)
        self.assertEqual(failure.exception.code, 1)
        self.assertIn("non riconosce", message.call_args.args[0])
        child.assert_not_called()
