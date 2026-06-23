from __future__ import annotations

from dataclasses import dataclass, replace

from .model_config import build_provider_snapshot
from .providers import ProviderSnapshot

MAIN_ROLE = "main"
SECONDARY_ROLE = "secondary"

LIGHTWEIGHT_AGENT_TYPES = {
    "xiaohuangmen",
    "sili_suitang",
    "dongchang_tanshi",
    "shangbao_dianbu",
}
WRITING_AGENT_TYPES = {"neiguan_yingzao"}


@dataclass(frozen=True)
class ModelRoute:
    snapshot: ProviderSnapshot
    fallback: ProviderSnapshot | None
    use_case: str
    reason: str
    estimated_tokens: int | None = None

    @property
    def model_role(self) -> str:
        return self.snapshot.model_role


class ModelRouter:
    """Central model role selector.

    A model entry owns one credential bundle and two model ids. The router decides
    which id should be used for each internal use case, and attaches the main
    snapshot as a one-shot fallback for secondary routes.
    """

    def __init__(self, root, *, model_override: str | None = None):
        self.root = root
        self.model_override = model_override
        self.main = build_provider_snapshot(root, model_override=model_override, role=MAIN_ROLE)
        self.secondary = build_provider_snapshot(root, model_override=model_override, role=SECONDARY_ROLE)

    def route(
        self,
        use_case: str,
        *,
        agent_type: str | None = None,
        task: str | None = None,
    ) -> ModelRoute:
        key = str(use_case or "main_agent")
        if key == "main_agent":
            return self._main("main_agent")
        if key in {"memory_compaction", "watchlist_check", "session_title"}:
            return self._secondary(key)
        if key in {"subagent", "team"}:
            normalized_agent = str(agent_type or "").strip()
            estimated = _rough_token_estimate(task or "") if task else None
            if normalized_agent in WRITING_AGENT_TYPES:
                return self._main(f"{key}:{normalized_agent}:write_capable", estimated_tokens=estimated)
            if normalized_agent in LIGHTWEIGHT_AGENT_TYPES:
                return self._secondary(f"{key}:{normalized_agent}:lightweight", task=task)
            return self._main(f"{key}:{normalized_agent or 'unknown'}:default_main", estimated_tokens=estimated)
        return self._main(f"{key}:default_main")

    def _main(self, reason: str, *, estimated_tokens: int | None = None) -> ModelRoute:
        snapshot = replace(self.main, route_reason=reason)
        return ModelRoute(
            snapshot=snapshot,
            fallback=None,
            use_case=reason.split(":", 1)[0],
            reason=reason,
            estimated_tokens=estimated_tokens,
        )

    def _secondary(self, reason: str, *, task: str | None = None) -> ModelRoute:
        estimated = _rough_token_estimate(task or "") if task else None
        if self.secondary.model_role != SECONDARY_ROLE:
            return self._main(f"{reason}:secondary_missing", estimated_tokens=estimated)
        if estimated is not None and estimated > int(self.secondary.context_window_tokens * 0.65):
            return self._main(f"{reason}:secondary_context_too_small", estimated_tokens=estimated)
        snapshot = replace(self.secondary, route_reason=reason)
        fallback = replace(self.main, route_reason=f"{reason}:fallback_main")
        return ModelRoute(
            snapshot=snapshot,
            fallback=fallback,
            use_case=reason.split(":", 1)[0],
            reason=reason,
            estimated_tokens=estimated,
        )

    def payload(self) -> dict[str, object]:
        return {
            "secondaryEnabled": self.secondary.model_role == SECONDARY_ROLE,
            "fallbackToMain": True,
            "mainEntry": self.main.entry_name,
            "mainModel": self.main.model,
            "secondaryModel": self.secondary.model if self.secondary.model_role == SECONDARY_ROLE else None,
        }


def _rough_token_estimate(text: str) -> int:
    return max(1, len(text or "") // 3)
