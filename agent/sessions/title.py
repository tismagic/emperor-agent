from __future__ import annotations

import re

from loguru import logger

from ..model_router import ModelRouter

_FORBIDDEN_PREFIXES = (
    "关于",
    "帮我",
    "如何",
    "请",
    "实现",
    "优化",
    "处理",
    "完成",
    "给我",
)
_PUNCT_RE = re.compile(r"[`~!@#$%^&*()_=+\[\]{}\\|;:'\",.<>/?，。！？、；：“”‘’（）【】《》「」『』…—-]+")
_SPACE_RE = re.compile(r"\s+")


class SessionTitleService:
    def __init__(self, model_router: ModelRouter) -> None:
        self.model_router = model_router

    async def generate(self, first_message: str) -> str:
        fallback = fallback_session_title(first_message)
        prompt = _title_prompt(first_message)
        route = self.model_router.route("session_title", task=first_message)
        snapshots = [route.snapshot]
        if route.fallback is not None:
            snapshots.append(route.fallback)

        for snapshot in snapshots:
            try:
                generation = snapshot.generation
                response = await snapshot.provider.chat(
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "你只负责给聊天会话命名。必须只输出标题本身，"
                                "不要解释，不要标点，不要换行。"
                            ),
                        },
                        {"role": "user", "content": prompt},
                    ],
                    tools=None,
                    model=snapshot.model,
                    max_tokens=min(64, int(generation.max_tokens or 64)),
                    temperature=0.1,
                    reasoning_effort=generation.reasoning_effort,
                )
            except Exception as exc:
                logger.warning("session title generation failed on {}: {}", snapshot.model, exc)
                continue
            title = sanitize_session_title(response.content or "")
            if title:
                return title
        return fallback


def sanitize_session_title(value: str) -> str:
    text = str(value or "").strip()
    text = re.sub(r"^```[a-zA-Z0-9_-]*|```$", "", text).strip()
    text = text.replace("\n", " ")
    text = re.split(r"[,，。.!！？?；;:：]", text, maxsplit=1)[0]
    text = _PUNCT_RE.sub(" ", text)
    text = _SPACE_RE.sub(" ", text).strip()
    text = _strip_forbidden_prefixes(text)
    text = _SPACE_RE.sub(" ", text).strip()
    if not text:
        return ""
    text = _truncate_title(text)
    return text if _visible_len(text) >= 2 else ""


def fallback_session_title(first_message: str) -> str:
    title = sanitize_session_title(first_message)
    return title or "新会话"


def _title_prompt(first_message: str) -> str:
    return (
        "根据下面第一条用户消息生成会话标题。\n"
        "规则：2-12 个中文字符，或非常简短的中英混合任务名；"
        "不要标点、引号、emoji；不要使用 关于、帮我、如何、请、实现、优化 等套话；"
        "只输出标题。\n\n"
        f"用户消息：{first_message[:1200]}"
    )


def _strip_forbidden_prefixes(text: str) -> str:
    changed = True
    out = text
    while changed:
        changed = False
        stripped = out.lstrip()
        for prefix in _FORBIDDEN_PREFIXES:
            if stripped.startswith(prefix):
                out = stripped[len(prefix):].lstrip()
                changed = True
                break
    return out.strip()


def _truncate_title(text: str, limit: int = 12) -> str:
    if _visible_len(text) <= limit:
        return text
    count = 0
    chars: list[str] = []
    for ch in text:
        count += 1
        if count > limit:
            break
        chars.append(ch)
    return "".join(chars).strip()


def _visible_len(text: str) -> int:
    return len(text.replace(" ", ""))
