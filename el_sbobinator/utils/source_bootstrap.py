"""Select the Windows source environment before importing application libraries."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def show_startup_error(message: str) -> None:
    if sys.stderr is not None:
        print(message, file=sys.stderr)
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, "El Sbobinator", 0x10)


def prepare_source_environment(root: Path, launcher: Path) -> None:
    if getattr(sys, "frozen", False) or sys.platform != "win32":
        return
    update = root / "Aggiorna_App_Locale.ps1"
    try:
        environment = root / ".venv"
        windowless = Path(sys.executable).stem.lower() == "pythonw"
        interpreter = (
            environment / "Scripts" / ("pythonw.exe" if windowless else "python.exe")
        )
        if not interpreter.is_file() or not (environment / "pyvenv.cfg").is_file():
            raise RuntimeError("L'ambiente .venv del progetto manca o è incompleto.")
        if Path(sys.prefix).resolve() != environment.resolve():
            if os.environ.get("EL_SBOBINATOR_SOURCE_RELAUNCH") == str(root):
                raise RuntimeError(
                    "Il Python del .venv non riconosce il proprio ambiente."
                )
            command = [str(interpreter), str(launcher), *sys.argv[1:]]
            child_env = dict(os.environ)
            child_env.pop("PYTHONHOME", None)
            child_env.pop("PYTHONPATH", None)
            child_env["EL_SBOBINATOR_SOURCE_RELAUNCH"] = str(root)
            if windowless:
                subprocess.Popen(command, cwd=str(root), env=child_env)
                raise SystemExit(0)
            raise SystemExit(subprocess.call(command, cwd=str(root), env=child_env))
        from el_sbobinator.utils.dependency_versions import (
            verify_dependencies,
            verify_frontend_build,
        )

        verify_dependencies(root)
        verify_frontend_build(root)
    except (OSError, RuntimeError) as exc:
        show_startup_error(
            f"Impossibile avviare l'app dai sorgenti.\n\n{exc}\n\n"
            "Aggiorna l'ambiente con questo comando PowerShell:\n"
            f'powershell -ExecutionPolicy Bypass -File "{update}"'
        )
        raise SystemExit(1) from exc
