import importlib.metadata
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from el_sbobinator.utils import dependency_versions as deps


class DependencyVersionsTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        (self.root / "pyproject.toml").write_text(
            '[project]\nrequires-python = ">=3.11,<3.12"\n'
        )
        other = "linux" if sys.platform == "win32" else "win32"
        (self.root / "uv.lock").write_text(
            """version = 1
[[package]]
name = "app"
version = "0"
source = { virtual = "." }
dependencies = [{name = "direct"}, {name = "foreign", marker = "sys_platform == 'OTHER'"}]
[package.dev-dependencies]
dev = [{name = "tool", extra = ["standard"]}]
[[package]]
name = "direct"
version = "2.0"
dependencies = [{name = "transitive"}]
[[package]]
name = "transitive"
version = "3.0"
[[package]]
name = "foreign"
version = "4.0"
[[package]]
name = "tool"
version = "5.0"
[package.optional-dependencies]
standard = [{name = "extra"}]
[[package]]
name = "extra"
version = "6.0"
""".replace("OTHER", other)
        )

    def test_matching_direct_pin_cannot_hide_an_outdated_transitive(self):
        with patch.object(
            deps.importlib.metadata,
            "version",
            side_effect=lambda n: {"direct": "2.0", "transitive": "2.9"}[n],
        ):
            with self.assertRaisesRegex(
                RuntimeError, "transitive: installato 2.9, richiesto 3.0"
            ):
                deps.verify_dependencies(self.root)

    def test_missing_and_outdated_packages_are_both_reported(self):
        def version(name):
            if name == "transitive":
                raise importlib.metadata.PackageNotFoundError(name)
            return "1.0"

        with patch.object(deps.importlib.metadata, "version", side_effect=version):
            status = deps.inspect_dependencies(self.root)
        self.assertEqual(len(status.issues), 2)
        self.assertIn("direct: installato 1.0", status.issues[0])
        self.assertIn("transitive: manca", status.issues[1])

    def test_platform_markers_and_group_extras_match_the_selected_graph(self):
        self.assertEqual(
            deps.locked_versions(self.root), {"direct": "2.0", "transitive": "3.0"}
        )
        self.assertEqual(
            deps.locked_versions(self.root, all_groups=True),
            {"direct": "2.0", "transitive": "3.0", "tool": "5.0", "extra": "6.0"},
        )

    def test_residue_is_rejected_even_if_required_versions_match(self):
        residue = MagicMock()
        residue.metadata = {"Name": "old-package"}
        with (
            patch.object(
                deps.importlib.metadata,
                "version",
                side_effect=lambda n: {"direct": "2.0.0", "transitive": "3.0"}[n],
            ),
            patch.object(
                deps.importlib.metadata, "distributions", return_value=[residue]
            ),
        ):
            with self.assertRaisesRegex(
                RuntimeError, "old-package: pacchetto estraneo"
            ):
                deps.verify_dependencies(self.root, strict=True)

    def test_unknown_lock_format_cannot_claim_alignment(self):
        (self.root / "uv.lock").write_text("version = 999\n")
        with self.assertRaisesRegex(RuntimeError, "Formato"):
            deps.verify_dependencies(self.root)

    def test_manifest_changed_without_lock_cannot_claim_alignment(self):
        (self.root / "pyproject.toml").write_text(
            '[project]\nrequires-python = ">=3.11,<3.12"\ndependencies = ["new-dependency==1.0"]\n'
        )
        with self.assertRaisesRegex(RuntimeError, "pyproject.toml e uv.lock"):
            deps.verify_dependencies(self.root)

    def test_frontend_compiled_against_old_lock_is_rejected(self):
        dist = self.root / "webui" / "dist"
        dist.mkdir(parents=True)
        lock = self.root / "webui" / "package-lock.json"
        lock.write_text("{}")
        (dist / "desktop-build.json").write_text(
            json.dumps({"dependencies": deps.lock_hashes(self.root)})
        )
        deps.verify_frontend_build(self.root)
        lock.write_text('{"new":true}')
        with self.assertRaisesRegex(RuntimeError, "lock differenti"):
            deps.verify_frontend_build(self.root)
