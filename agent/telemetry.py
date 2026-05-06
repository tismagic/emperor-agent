"""Token usage tracking — per-call JSONL log + aggregations."""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path


_TOKEN_KEYS = ("input", "output", "cache_read", "cache_create")


class TokenTracker:
    def __init__(self, log_file: Path):
        self.log_file = log_file
        self.log_file.parent.mkdir(parents=True, exist_ok=True)
        self._last_input_tokens = 0

    def record(
        self,
        model: str,
        usage,
        *,
        provider: str | None = None,
        usage_type: str = "main_agent",
    ) -> None:
        """Append one row to tokens.jsonl from a provider usage object or dict."""
        if isinstance(usage, dict):
            input_tokens = usage.get("input", usage.get("prompt_tokens", 0)) or 0
            output_tokens = usage.get("output", usage.get("completion_tokens", 0)) or 0
            cache_read = usage.get("cache_read", usage.get("cache_read_input_tokens", 0)) or 0
            cache_create = usage.get("cache_create", usage.get("cache_creation_input_tokens", 0)) or 0
        else:
            input_tokens = getattr(usage, "input_tokens", 0) or 0
            output_tokens = getattr(usage, "output_tokens", 0) or 0
            cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
            cache_create = getattr(usage, "cache_creation_input_tokens", 0) or 0
        row = {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "provider": provider or "unknown",
            "model": model,
            "usage_type": usage_type,
            "input": input_tokens,
            "output": output_tokens,
            "cache_read": cache_read,
            "cache_create": cache_create,
        }
        self._last_input_tokens = row["input"] + row["cache_read"] + row["cache_create"]
        with self.log_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    def last_input_tokens(self) -> int:
        return self._last_input_tokens

    def should_compact(self, max_context: int, threshold: float = 0.7) -> bool:
        return self._last_input_tokens > max_context * threshold

    def _iter_rows(self):
        if not self.log_file.exists():
            return
        with self.log_file.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue

    def stats_by_date(self) -> dict[str, dict[str, int]]:
        out: dict[str, dict[str, int]] = defaultdict(_empty_stats)
        for r in self._iter_rows():
            date = r.get("ts", "")[:10]
            _add_row(out[date], r)
        return dict(out)

    def stats_by_model(self) -> dict[str, dict[str, int]]:
        out: dict[str, dict[str, int]] = defaultdict(_empty_stats)
        for r in self._iter_rows():
            m = r.get("model", "unknown")
            _add_row(out[m], r)
        return dict(out)

    def stats_by_provider_model(self) -> dict[str, dict[str, int | str]]:
        out: dict[str, dict[str, int | str]] = defaultdict(_empty_stats)
        for r in self._iter_rows():
            provider = r.get("provider") or "unknown"
            model = r.get("model") or "unknown"
            key = f"{provider}/{model}" if provider != "unknown" else model
            bucket = out[key]
            bucket["provider"] = provider
            bucket["model"] = model
            _add_row(bucket, r)
        return dict(out)

    def stats_by_usage_type(self) -> dict[str, dict[str, int]]:
        out: dict[str, dict[str, int]] = defaultdict(_empty_stats)
        for r in self._iter_rows():
            usage_type = r.get("usage_type") or "main_agent"
            _add_row(out[usage_type], r)
        return dict(out)

    def totals(self) -> dict[str, int]:
        out = _empty_stats()
        for r in self._iter_rows():
            _add_row(out, r)
        return out


def _empty_stats() -> dict[str, int]:
    return {"calls": 0, "input": 0, "output": 0, "cache_read": 0, "cache_create": 0, "total": 0}


def _add_row(bucket: dict, row: dict) -> None:
    bucket["calls"] = int(bucket.get("calls", 0)) + 1
    total = 0
    for key in _TOKEN_KEYS:
        value = int(row.get(key, 0) or 0)
        bucket[key] = int(bucket.get(key, 0)) + value
        total += value
    bucket["total"] = int(bucket.get("total", 0)) + total
