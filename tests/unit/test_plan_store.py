from __future__ import annotations

from pathlib import Path

from agent.plans.models import PlanRecord, PlanStatus, PlanStep, PlanStepStatus
from agent.plans.store import PlanStore


def test_plan_store_round_trips_structured_plan(tmp_path: Path) -> None:
    store = PlanStore(tmp_path)
    record = PlanRecord(
        id="plan_1",
        title="Upgrade runner",
        summary="Extract context pipeline",
        status=PlanStatus.DRAFT.value,
        created_at=100.0,
        updated_at=100.0,
        source_interaction_id="plan_interaction_1",
        steps=[
            PlanStep(
                id="step_1",
                title="Add tests",
                status=PlanStepStatus.PENDING.value,
                files=["tests/unit/test_context_pipeline.py"],
                commands=[".venv/bin/python -m pytest tests/unit/test_context_pipeline.py -q"],
                acceptance=["test_context_pipeline.py passes"],
            )
        ],
    )

    store.save(record)

    loaded = store.get("plan_1")
    assert loaded == record
    assert store.latest() == record


def test_plan_store_backs_up_corrupt_index(tmp_path: Path) -> None:
    store = PlanStore(tmp_path)
    store.index_file.write_text("{bad json", encoding="utf-8")

    assert store.list() == []
    assert list(store.plan_dir.glob("index.json.corrupt-*"))
