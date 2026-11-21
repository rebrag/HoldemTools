"""api_client: claim routing per solver, 404 handling, terminal-report retry."""

import pytest
import requests

import api_client


class Resp:
    def __init__(self, status, body=None, text=""):
        self.status_code = status
        self._body = body
        self.text = text

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


class FakeHttp:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def _next(self, method, url, kw):
        self.calls.append((method, url, kw.get("json")))
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    def post(self, url, **kw):
        return self._next("POST", url, kw)

    def patch(self, url, **kw):
        return self._next("PATCH", url, kw)


@pytest.fixture
def http(monkeypatch):
    sleeps = []
    monkeypatch.setattr(api_client, "_sleep", sleeps.append)
    monkeypatch.setattr(api_client, "_last_missing_route_log", {})

    def install(responses):
        fake = FakeHttp(responses)
        fake.sleeps = sleeps
        monkeypatch.setattr(api_client, "_http", fake)
        return fake

    return install


def test_claim_routes_per_solver(http):
    fake = http([Resp(204), Resp(200, {"id": "j1"})])
    assert api_client.claim_next() is None
    assert api_client.claim_next("htsolver") == {"id": "j1"}
    assert fake.calls[0][1].endswith("/api/solvejobs/claim")
    assert fake.calls[1][1].endswith("/api/solvejobs/claim/htsolver")
    assert fake.calls[1][2] == {"watcherId": "test-watcher"}


def test_htsolver_404_is_an_empty_queue_logged_once(http, capsys):
    http([Resp(404), Resp(404)])
    assert api_client.claim_next("htsolver") is None
    assert api_client.claim_next("htsolver") is None
    out = capsys.readouterr().out
    assert out.count("no htsolver claim route") == 1


def test_unknown_solver_is_a_programming_error():
    with pytest.raises(ValueError):
        api_client.claim_next("monker")


def test_report_carries_index_entry(http):
    fake = http([Resp(200)])
    assert api_client.report("j1", heartbeat=True, index_entry={"board": "8d4c2c"})
    assert fake.calls[0][2]["indexEntry"] == {"board": "8d4c2c"}
    assert fake.calls[0][2]["heartbeat"] is True


def test_report_carries_progress(http):
    fake = http([Resp(200), Resp(200)])
    assert api_client.report("j1", heartbeat=True,
                             progress={"iteration": 150, "exploitable_pct": 0.45, "target_pct": 0.2})
    assert fake.calls[0][2]["progress"] == {"iteration": 150, "exploitablePct": 0.45, "targetPct": 0.2}
    # Nothing measured yet is nothing to say, not a zero.
    assert api_client.report("j1", heartbeat=True, progress={"iteration": 150})
    assert "progress" not in fake.calls[1][2]


def test_terminal_report_retries_then_succeeds(http):
    fake = http([requests.ConnectionError("down"), Resp(503), Resp(200)])
    assert api_client.report("j1", status="Done", result={"stacks": "s", "node_name": "n", "board": "b"})
    assert len(fake.calls) == 3
    assert fake.sleeps == [2.0, 4.0]
    assert fake.calls[0][2]["resultStacks"] == "s"


def test_409_after_an_uncertain_attempt_counts_as_recorded(http):
    http([requests.Timeout("slow"), Resp(409, text="already Done")])
    assert api_client.report("j1", status="Done") is True


def test_409_on_the_first_attempt_is_a_rejection(http):
    fake = http([Resp(409, text="requeued")])
    assert api_client.report("j1", status="Failed", error="x") is False
    assert len(fake.calls) == 1


def test_client_errors_do_not_retry(http):
    fake = http([Resp(400, text="bad")])
    assert api_client.report("j1", status="Done") is False
    assert len(fake.calls) == 1


def test_non_terminal_reports_never_retry(http):
    fake = http([requests.ConnectionError("down")])
    assert api_client.report("j1", status="Solving") is False
    assert len(fake.calls) == 1 and fake.sleeps == []


def test_terminal_retry_gives_up_after_the_window(http):
    fake = http([requests.ConnectionError("down")] * 50)
    assert api_client.report("j1", status="Done", retry_secs=10) is False
    # 2 + 4 fit in 10 s of backoff; the next 8 s wait would overrun it.
    assert fake.sleeps == [2.0, 4.0]
