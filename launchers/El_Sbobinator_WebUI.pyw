"""
Entrypoint PyWebView (compatibile con PyInstaller).

La logica dell'app vive in `el_sbobinator/app_webview.py` per mantenere il progetto modulare.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from el_sbobinator.app_webview import main


if __name__ == "__main__":
    main()
