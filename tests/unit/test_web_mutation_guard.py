from __future__ import annotations

import pytest
from aiohttp import web

from agent.web.mutation_guard import assert_web_mutation_allowed


def test_web_mutation_guard_allows_direct_user_action_in_ask_mode() -> None:
    assert_web_mutation_allowed({"mode": "ask_before_edit", "pending": None}, area="scheduler", action="run")


def test_web_mutation_guard_rejects_pending_interaction() -> None:
    with pytest.raises(web.HTTPConflict):
        assert_web_mutation_allowed(
            {"mode": "ask_before_edit", "pending": {"id": "ask_1"}},
            area="team",
            action="wake teammate",
        )


def test_web_mutation_guard_rejects_plan_mode_mutations() -> None:
    with pytest.raises(web.HTTPForbidden):
        assert_web_mutation_allowed({"mode": "plan", "pending": None}, area="scheduler", action="create")
