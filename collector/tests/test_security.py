from radar.collect_repos import valid_repo_name
from radar.notify import _e, _href, format_opportunity


def test_repo_names_that_could_inject_graphql_are_rejected():
    assert valid_repo_name("vllm-project/vllm")
    assert valid_repo_name("huggingface/transformers.js")
    for bad in ['a/b") { viewer { login } } x: repository(owner: "c', "a/b c", "../etc/passwd", "a/..", "a", "-a/b"]:
        assert not valid_repo_name(bad), bad


def test_telegram_escaping_blocks_attribute_breakout():
    assert _e('x" onclick="y') == "x&quot; onclick=&quot;y"
    assert _href("javascript:alert(1)") == "#"
    assert _href('https://e.com/"><b>x') == "https://e.com/&quot;&gt;&lt;b&gt;x"


def test_formatted_alert_has_no_raw_markup_from_issue_data():
    o = {
        "score": 0.9,
        "url": 'https://github.com/a/b/issues/1" onmouseover="x',
        "repo": "a/b",
        "number": 1,
        "title": "<script>alert(1)</script>",
        "reasons": [{"text": "<i>x</i>", "tone": "good"}],
    }
    text = format_opportunity(o, "https://site")
    assert "<script>" not in text and 'onmouseover="x' not in text
