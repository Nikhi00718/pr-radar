from datetime import UTC, datetime

import pytest

from radar import notify
from radar.config import Settings
from radar.store import SQLiteStore

NOON_IST = datetime(2026, 10, 19, 6, 30, tzinfo=UTC)  # 12:00 IST, outside quiet hours
NIGHT_IST = datetime(2026, 10, 18, 20, 30, tzinfo=UTC)  # 02:00 IST, inside quiet hours


def opp(i, score, lang="Python", hidden=False):
    return {
        "id": i,
        "score": score,
        "language": lang,
        "hidden": hidden,
        "url": f"https://github.com/a/b/issues/{i}",
        "repo": "a/b",
        "number": i,
        "title": f"issue {i}",
        "reasons": [],
    }


PAYLOAD = {
    "opportunities": [opp(1, 0.9), opp(2, 0.8, "Rust"), opp(3, 0.7), opp(4, 0.95, hidden=True)],
    "repos": [],
    "news": [],
}


@pytest.fixture
def env(tmp_path, monkeypatch):
    store = SQLiteStore(tmp_path / "t.db")
    s = Settings(telegram_token="t", telegram_chat_id="100", supabase_url=None, supabase_key=None)
    sent: list[tuple[int, str]] = []
    status = {"value": "ok"}

    def fake_send(_s, chat, text):
        sent.append((int(chat), text))
        return status["value"]

    monkeypatch.setattr(notify, "send_message", fake_send)
    return store, s, sent, status


def sub(chat, **kw):
    base = {
        "chat_id": chat,
        "active": True,
        "min_score": 0.75,
        "langs": [],
        "alerts": True,
        "digest": True,
        "created_at": "x",
        "updated_at": "x",
        "cmd_count": 0,
    }
    return {**base, **kw}


def test_matches_respects_score_language_and_hidden():
    assert notify.matches(opp(1, 0.9), sub(1))
    assert not notify.matches(opp(1, 0.7), sub(1))
    assert not notify.matches(opp(1, 0.9, hidden=True), sub(1))
    assert notify.matches(opp(1, 0.9, "Rust"), sub(1, langs=["rust"]))
    assert not notify.matches(opp(1, 0.9, "Go"), sub(1, langs=["rust", "python"]))


def test_owner_is_auto_subscribed_and_each_chat_gets_its_own_filtered_alerts(env):
    store, s, sent, _ = env
    store.upsert("subscribers", [sub(200, langs=["rust"]), sub(300, min_score=0.6), sub(400, active=False)])
    notify.send_alerts(store, s, PAYLOAD, NOON_IST)
    by_chat = {c: t for c, t in sent}
    assert set(by_chat) == {100, 200, 300}  # inactive 400 gets nothing; owner row was created
    assert "issue 1" in by_chat[100] and "issue 2" in by_chat[100] and "issue 3" not in by_chat[100]
    assert "issue 2" in by_chat[200] and "issue 1" not in by_chat[200]
    assert "issue 3" in by_chat[300]
    assert all("issue 4" not in t for t in by_chat.values())  # hidden never sent


def test_alerts_are_not_repeated_and_old_owner_alerts_count_as_sent(env):
    store, s, sent, _ = env
    store.upsert("alerts", [{"id": "telegram:issue:1", "target_id": "issue:1", "channel": "telegram", "sent_at": "x"}])
    notify.send_alerts(store, s, PAYLOAD, NOON_IST)
    assert len(sent) == 1 and "issue 1" not in sent[0][1] and "issue 2" in sent[0][1]
    sent.clear()
    notify.send_alerts(store, s, PAYLOAD, NOON_IST)
    assert sent == []


def test_blocked_subscriber_is_deactivated(env):
    store, s, sent, status = env
    status["value"] = "blocked"
    notify.send_alerts(store, s, PAYLOAD, NOON_IST)
    assert store.select("subscribers", eq={"chat_id": 100})[0]["active"] in (0, False)


def test_quiet_hours_and_digest_once_per_day(env):
    store, s, sent, _ = env
    assert notify.send_alerts(store, s, PAYLOAD, NIGHT_IST) == 0 and sent == []
    assert notify.send_digest(store, s, PAYLOAD, NOON_IST) == 1
    assert notify.send_digest(store, s, PAYLOAD, NOON_IST) == 0
