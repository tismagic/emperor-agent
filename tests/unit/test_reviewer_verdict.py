from agent.plans.reviewer import ReviewerVerdict, parse_reviewer_verdict


def test_parses_fenced_verdict_block():
    text = (
        "Reviewed the change.\n"
        "```verdict\n"
        '{"passed": true, "summary": "all green", '
        '"commands": ["pytest tests/unit/test_plan_runtime.py"], '
        '"command_evidence": [{"command": "pytest", "exit_code": 0}]}\n'
        "```\n"
    )
    verdict = parse_reviewer_verdict(text)
    assert isinstance(verdict, ReviewerVerdict)
    assert verdict.passed is True
    assert verdict.summary == "all green"
    assert verdict.commands == ["pytest tests/unit/test_plan_runtime.py"]
    assert verdict.command_evidence == [{"command": "pytest", "exit_code": 0}]


def test_uses_last_block_when_multiple_present():
    text = (
        "```verdict\n{\"passed\": false, \"summary\": \"draft\"}\n```\n"
        "```verdict\n{\"passed\": true, \"summary\": \"final\"}\n```\n"
    )
    verdict = parse_reviewer_verdict(text)
    assert verdict is not None and verdict.passed is True and verdict.summary == "final"


def test_returns_none_when_no_verdict_block():
    assert parse_reviewer_verdict("Looks fine, no structured verdict.") is None


def test_returns_none_on_malformed_json():
    assert parse_reviewer_verdict("```verdict\n{not json}\n```") is None
