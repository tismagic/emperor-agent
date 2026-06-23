from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .microcompact import (
    DEFAULT_MICROCOMPACT_HEAD_CHARS,
    DEFAULT_MICROCOMPACT_KEEP_RECENT,
    DEFAULT_MICROCOMPACT_MIN_CHARS,
    DEFAULT_MICROCOMPACT_TAIL_CHARS,
    microcompact_text_messages,
)
from .models import ContextProjection
from .pairing import pair_tool_calls
from .tool_results import (
    ToolResultStore,
    cap_tool_results,
    replace_large_tool_results,
    shrink_old_tool_results,
)


class ContextPipeline:
    def __init__(
        self,
        *,
        per_call_limit: int = 8000,
        keep_recent: int = 10,
        tool_result_store: ToolResultStore | None = None,
        replacement_min_bytes: int = 8000,
        replacement_preview_chars: int = 1000,
        tool_result_limits: dict[str, int] | None = None,
        plan_context_provider: Callable[[list[dict]], dict[str, Any] | None] | None = None,
        microcompact_keep_recent: int = DEFAULT_MICROCOMPACT_KEEP_RECENT,
        microcompact_min_chars: int = DEFAULT_MICROCOMPACT_MIN_CHARS,
        microcompact_head_chars: int = DEFAULT_MICROCOMPACT_HEAD_CHARS,
        microcompact_tail_chars: int = DEFAULT_MICROCOMPACT_TAIL_CHARS,
    ) -> None:
        self.per_call_limit = per_call_limit
        self.keep_recent = keep_recent
        self.tool_result_store = tool_result_store
        self.replacement_min_bytes = replacement_min_bytes
        self.replacement_preview_chars = replacement_preview_chars
        self.tool_result_limits = dict(tool_result_limits or {})
        self.plan_context_provider = plan_context_provider
        self.microcompact_keep_recent = microcompact_keep_recent
        self.microcompact_min_chars = microcompact_min_chars
        self.microcompact_head_chars = microcompact_head_chars
        self.microcompact_tail_chars = microcompact_tail_chars

    def project(self, history: list[dict]) -> ContextProjection:
        paired, filled, dropped = pair_tool_calls(history)
        replacements = []
        prepared = paired
        if self.tool_result_store is not None:
            prepared, replacements = replace_large_tool_results(
                paired,
                self.tool_result_store,
                min_bytes=self.replacement_min_bytes,
                preview_chars=self.replacement_preview_chars,
                tool_result_limits=self.tool_result_limits,
            )
        capped, capped_count = cap_tool_results(prepared, per_call_limit=self.per_call_limit)
        shrunk, shrunk_count = shrink_old_tool_results(capped, keep_recent=self.keep_recent)
        microcompacted, microcompact_records = microcompact_text_messages(
            shrunk,
            keep_recent=self.microcompact_keep_recent,
            min_chars=self.microcompact_min_chars,
            head_chars=self.microcompact_head_chars,
            tail_chars=self.microcompact_tail_chars,
        )
        plan_context = self.plan_context_provider(history) if self.plan_context_provider is not None else None
        messages = [plan_context, *microcompacted] if plan_context is not None else microcompacted
        return ContextProjection(
            messages=messages,
            report={
                "paired_missing_tool_results": filled,
                "dropped_orphan_tool_results": dropped,
                "plan_context_attached": 1 if plan_context is not None else 0,
                "replaced_tool_results": len(replacements),
                "tool_result_replacements": [record.to_dict() for record in replacements],
                "capped_tool_results": capped_count,
                "shrunk_old_tool_results": shrunk_count,
                "microcompacted_messages": len(microcompact_records),
                "microcompact_records": [record.to_dict() for record in microcompact_records],
            },
        )
