import tempfile
import threading

import pytest
from fastapi.testclient import TestClient

from el_sbobinator.browser_server.server import create_browser_app
from el_sbobinator.core.session_store import get_session_root, set_session_root


@pytest.fixture(autouse=True)
def isolated_session_root():
    previous_root = get_session_root()
    with tempfile.TemporaryDirectory() as temp_dir:
        set_session_root(temp_dir)
        try:
            yield temp_dir
        finally:
            set_session_root(previous_root)


def _start_tracked_run(app, release: threading.Event) -> threading.Thread:
    def _run():
        release.wait(timeout=5.0)
        with app.state.scenario_threads_lock:
            app.state.scenario_threads.discard(threading.current_thread())

    thread = threading.Thread(target=_run, daemon=True)
    with app.state.scenario_threads_lock:
        app.state.scenario_threads.add(thread)
    thread.start()
    return thread


@pytest.mark.parametrize("settle", [True, False])
def test_bootstrap_settles_earlier_runs_only_when_enabled(
    isolated_session_root, settle
):
    app = create_browser_app(
        session_root=isolated_session_root, settle_runs_on_bootstrap=settle
    )
    with TestClient(app) as client:
        release = threading.Event()
        run = _start_tracked_run(app, release)
        threading.Timer(0.2, release.set).start()

        assert client.get("/api/bootstrap").status_code == 200

        # A settled bootstrap returns only after the earlier run has finished.
        assert run.is_alive() is not settle
        release.set()
        run.join(timeout=5.0)
