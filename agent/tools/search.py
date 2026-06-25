"""Search tools: grep and glob."""

from __future__ import annotations

import fnmatch
import os
import re
from collections.abc import Iterable
from pathlib import Path, PurePosixPath
from typing import Any, TypeVar

from loguru import logger

from .context import ToolExecutionContext
from .filesystem import _FsTool
from .results import ToolResult

_DEFAULT_HEAD_LIMIT = 250
T = TypeVar("T")
_TYPE_GLOB_MAP = {
    "py": ("*.py", "*.pyi"),
    "python": ("*.py", "*.pyi"),
    "js": ("*.js", "*.jsx", "*.mjs", "*.cjs"),
    "ts": ("*.ts", "*.tsx", "*.mts", "*.cts"),
    "tsx": ("*.tsx",),
    "jsx": ("*.jsx",),
    "json": ("*.json",),
    "md": ("*.md", "*.mdx"),
    "markdown": ("*.md", "*.mdx"),
    "go": ("*.go",),
    "rs": ("*.rs",),
    "rust": ("*.rs",),
    "java": ("*.java",),
    "sh": ("*.sh", "*.bash"),
    "yaml": ("*.yaml", "*.yml"),
    "yml": ("*.yaml", "*.yml"),
    "toml": ("*.toml",),
    "sql": ("*.sql",),
    "html": ("*.html", "*.htm"),
    "css": ("*.css", "*.scss", "*.sass"),
}


def _normalize_pattern(pattern: str) -> str:
    return pattern.strip().replace("\\", "/")


def _match_glob(rel_path: str, name: str, pattern: str) -> bool:
    normalized = _normalize_pattern(pattern)
    if not normalized:
        return False
    if "/" in normalized or normalized.startswith("**"):
        return PurePosixPath(rel_path).match(normalized)
    return fnmatch.fnmatch(name, normalized)


def _is_binary(raw: bytes) -> bool:
    if b"\x00" in raw:
        return True
    sample = raw[:4096]
    if not sample:
        return False
    non_text = sum(byte < 9 or 13 < byte < 32 for byte in sample)
    return (non_text / len(sample)) > 0.2


def _paginate(items: list[T], limit: int | None, offset: int) -> tuple[list[T], bool]:
    if limit is None:
        return items[offset:], False
    sliced = items[offset : offset + limit]
    truncated = len(items) > offset + limit
    return sliced, truncated


def _pagination_note(limit: int | None, offset: int, truncated: bool) -> str | None:
    if truncated:
        if limit is None:
            return f"(pagination: offset={offset})"
        return f"(pagination: limit={limit}, offset={offset})"
    if offset > 0:
        return f"(pagination: offset={offset})"
    return None


def _matches_type(name: str, file_type: str | None) -> bool:
    if not file_type:
        return True
    lowered = file_type.strip().lower()
    if not lowered:
        return True
    patterns = _TYPE_GLOB_MAP.get(lowered, (f"*.{lowered}",))
    return any(fnmatch.fnmatch(name.lower(), pattern.lower()) for pattern in patterns)


class _SearchTool(_FsTool):
    _IGNORE_DIRS = set(_FsTool._IGNORE_DIRS)

    def _display_path(self, target: Path, root: Path) -> str:
        workspace = self._workspace_root()
        if workspace:
            try:
                return target.relative_to(workspace).as_posix()
            except ValueError:
                pass
        return target.relative_to(root).as_posix()

    def _iter_files(self, root: Path) -> Iterable[Path]:
        if root.is_file():
            yield root
            return

        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted(d for d in dirnames if d not in self._IGNORE_DIRS)
            current = Path(dirpath)
            for filename in sorted(filenames):
                yield current / filename

    def _iter_entries(
        self,
        root: Path,
        *,
        include_files: bool,
        include_dirs: bool,
    ) -> Iterable[Path]:
        if root.is_file():
            if include_files:
                yield root
            return

        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted(d for d in dirnames if d not in self._IGNORE_DIRS)
            current = Path(dirpath)
            if include_dirs:
                for dirname in dirnames:
                    yield current / dirname
            if include_files:
                for filename in sorted(filenames):
                    yield current / filename


class GlobTool(_SearchTool):
    """按 glob 模式查找文件或目录。"""
    max_result_chars = 12_000

    @property
    def name(self) -> str:
        return "glob"

    @property
    def description(self) -> str:
        return (
            "按 glob 模式查找文件或目录，结果按修改时间从新到旧排序；"
            "默认跳过 .git、node_modules、__pycache__ 等噪声目录。"
            "查找文件名或目录结构时优先使用它，不要用 run_command/find/ls 代替；开放式多轮探索可考虑 dispatch_subagent。"
        )

    @property
    def read_only(self) -> bool:
        return True

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "要匹配的 glob 模式，例如 '*.py' 或 'tests/**/test_*.py'",
                    "minLength": 1,
                },
                "path": {
                    "type": "string",
                    "description": "搜索起点目录，默认当前工作区",
                },
                "max_results": {
                    "type": "integer",
                    "description": "兼容旧参数，等同于 head_limit",
                    "minimum": 1,
                    "maximum": 1000,
                },
                "head_limit": {
                    "type": "integer",
                    "description": "最多返回多少条匹配结果，默认 250；0 表示不限制",
                    "minimum": 0,
                    "maximum": 1000,
                },
                "offset": {
                    "type": "integer",
                    "description": "跳过前 N 条匹配结果后再返回",
                    "minimum": 0,
                    "maximum": 100000,
                },
                "entry_type": {
                    "type": "string",
                    "enum": ["files", "dirs", "both"],
                    "description": "匹配文件、目录或两者，默认 files",
                },
            },
            "required": ["pattern"],
        }

    def execute(
        self,
        pattern: str,
        path: str = ".",
        max_results: int | None = None,
        head_limit: int | None = None,
        offset: int = 0,
        entry_type: str = "files",
        **kwargs: Any,
    ) -> str:
        try:
            root = self._resolve(path or ".")
            if not root.exists():
                return f"Error: Path not found: {path}"
            if not root.is_dir():
                return f"Error: Not a directory: {path}"

            if head_limit is not None:
                limit = None if head_limit == 0 else head_limit
            elif max_results is not None:
                limit = max_results
            else:
                limit = _DEFAULT_HEAD_LIMIT
            include_files = entry_type in {"files", "both"}
            include_dirs = entry_type in {"dirs", "both"}
            matches: list[tuple[str, float]] = []
            for entry in self._iter_entries(
                root,
                include_files=include_files,
                include_dirs=include_dirs,
            ):
                rel_path = entry.relative_to(root).as_posix()
                if _match_glob(rel_path, entry.name, pattern):
                    display = self._display_path(entry, root)
                    if entry.is_dir():
                        display += "/"
                    try:
                        mtime = entry.stat().st_mtime
                    except OSError:
                        mtime = 0.0
                    matches.append((display, mtime))

            if not matches:
                return f"No paths matched pattern '{pattern}' in {path}"

            matches.sort(key=lambda item: (-item[1], item[0]))
            ordered = [name for name, _ in matches]
            paged, truncated = _paginate(ordered, limit, offset)
            result = "\n".join(paged)
            if note := _pagination_note(limit, offset, truncated):
                result += f"\n\n{note}"
            return result
        except PermissionError as e:
            return f"Error: {e}"
        except Exception as e:
            logger.warning(f"[glob] {e}")
            return f"Error finding files: {e}"


class GrepTool(_SearchTool):
    """在文件内容中搜索正则或纯文本模式。"""
    max_result_chars = 16_000
    _MAX_RESULT_CHARS = 128_000
    _MAX_FILE_BYTES = 2_000_000

    @property
    def name(self) -> str:
        return "grep"

    @property
    def description(self) -> str:
        return (
            "在文件内容中搜索正则或纯文本模式。"
            "默认只返回匹配文件路径；需要查看命中行时使用 content 模式；"
            "会跳过二进制文件和超过 2MB 的文件。"
            "内容搜索专用工具优先，不要用 run_command/grep/rg 代替；结果过宽时收窄 glob、type 或 pattern。"
        )

    @property
    def read_only(self) -> bool:
        return True

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "要搜索的正则或纯文本模式",
                    "minLength": 1,
                },
                "path": {
                    "type": "string",
                    "description": "搜索目标文件或目录，默认当前工作区",
                },
                "glob": {
                    "type": "string",
                    "description": "可选文件过滤模式，例如 '*.py' 或 'tests/**/test_*.py'",
                },
                "type": {
                    "type": "string",
                    "description": "可选文件类型简写，例如 py、ts、md、json",
                },
                "case_insensitive": {
                    "type": "boolean",
                    "description": "是否忽略大小写，默认 false",
                },
                "fixed_strings": {
                    "type": "boolean",
                    "description": "是否把 pattern 当作纯文本而不是正则，默认 false",
                },
                "output_mode": {
                    "type": "string",
                    "enum": ["content", "files_with_matches", "count"],
                    "description": (
                        "content：返回命中行及可选上下文；"
                        "files_with_matches：只返回匹配文件路径；"
                        "count：返回每个文件的命中行数。"
                        "默认 files_with_matches"
                    ),
                },
                "context_before": {
                    "type": "integer",
                    "description": "每个命中项之前返回的上下文行数",
                    "minimum": 0,
                    "maximum": 20,
                },
                "context_after": {
                    "type": "integer",
                    "description": "每个命中项之后返回的上下文行数",
                    "minimum": 0,
                    "maximum": 20,
                },
                "max_matches": {
                    "type": "integer",
                    "description": (
                        "兼容旧参数，在 content 模式下等同于 head_limit"
                    ),
                    "minimum": 1,
                    "maximum": 1000,
                },
                "max_results": {
                    "type": "integer",
                    "description": (
                        "兼容旧参数，在 files_with_matches 或 count 模式下等同于 head_limit"
                    ),
                    "minimum": 1,
                    "maximum": 1000,
                },
                "head_limit": {
                    "type": "integer",
                    "description": (
                        "最多返回多少条结果。content 模式限制命中行块数量，"
                        "其他模式限制文件条目数量，默认 250；0 表示不限制"
                    ),
                    "minimum": 0,
                    "maximum": 1000,
                },
                "offset": {
                    "type": "integer",
                    "description": "跳过前 N 条结果后再应用 head_limit",
                    "minimum": 0,
                    "maximum": 100000,
                },
            },
            "required": ["pattern"],
        }

    @staticmethod
    def _format_block(
        display_path: str,
        lines: list[str],
        match_line: int,
        before: int,
        after: int,
    ) -> str:
        start = max(1, match_line - before)
        end = min(len(lines), match_line + after)
        block = [f"{display_path}:{match_line}"]
        for line_no in range(start, end + 1):
            marker = ">" if line_no == match_line else " "
            block.append(f"{marker} {line_no}| {lines[line_no - 1]}")
        return "\n".join(block)

    def execute(
        self,
        pattern: str,
        path: str = ".",
        glob: str | None = None,
        type: str | None = None,
        case_insensitive: bool = False,
        fixed_strings: bool = False,
        output_mode: str = "files_with_matches",
        context_before: int = 0,
        context_after: int = 0,
        max_matches: int | None = None,
        max_results: int | None = None,
        head_limit: int | None = None,
        offset: int = 0,
        **kwargs: Any,
    ) -> str:
        try:
            target = self._resolve(path or ".")
            if not target.exists():
                return f"Error: Path not found: {path}"
            if not (target.is_dir() or target.is_file()):
                return f"Error: Unsupported path: {path}"

            flags = re.IGNORECASE if case_insensitive else 0
            try:
                needle = re.escape(pattern) if fixed_strings else pattern
                regex = re.compile(needle, flags)
            except re.error as e:
                return f"Error: invalid regex pattern: {e}"

            if head_limit is not None:
                limit = None if head_limit == 0 else head_limit
            elif output_mode == "content" and max_matches is not None:
                limit = max_matches
            elif output_mode != "content" and max_results is not None:
                limit = max_results
            else:
                limit = _DEFAULT_HEAD_LIMIT
            blocks: list[str] = []
            result_chars = 0
            seen_content_matches = 0
            truncated = False
            size_truncated = False
            skipped_binary = 0
            skipped_large = 0
            matching_files: list[str] = []
            counts: dict[str, int] = {}
            file_mtimes: dict[str, float] = {}
            root = target if target.is_dir() else target.parent

            for file_path in self._iter_files(target):
                rel_path = file_path.relative_to(root).as_posix()
                if glob and not _match_glob(rel_path, file_path.name, glob):
                    continue
                if not _matches_type(file_path.name, type):
                    continue

                raw = file_path.read_bytes()
                if len(raw) > self._MAX_FILE_BYTES:
                    skipped_large += 1
                    continue
                if _is_binary(raw):
                    skipped_binary += 1
                    continue
                try:
                    mtime = file_path.stat().st_mtime
                except OSError:
                    mtime = 0.0
                try:
                    content = raw.decode("utf-8")
                except UnicodeDecodeError:
                    skipped_binary += 1
                    continue

                lines = content.splitlines()
                display_path = self._display_path(file_path, root)
                file_had_match = False
                for idx, line in enumerate(lines, start=1):
                    if not regex.search(line):
                        continue
                    file_had_match = True

                    if output_mode == "count":
                        counts[display_path] = counts.get(display_path, 0) + 1
                        continue
                    if output_mode == "files_with_matches":
                        if display_path not in matching_files:
                            matching_files.append(display_path)
                            file_mtimes[display_path] = mtime
                        break

                    seen_content_matches += 1
                    if seen_content_matches <= offset:
                        continue
                    if limit is not None and len(blocks) >= limit:
                        truncated = True
                        break
                    block = self._format_block(
                        display_path,
                        lines,
                        idx,
                        context_before,
                        context_after,
                    )
                    extra_sep = 2 if blocks else 0
                    if result_chars + extra_sep + len(block) > self._MAX_RESULT_CHARS:
                        size_truncated = True
                        break
                    blocks.append(block)
                    result_chars += extra_sep + len(block)
                if output_mode == "count" and file_had_match:
                    if display_path not in matching_files:
                        matching_files.append(display_path)
                        file_mtimes[display_path] = mtime
                if output_mode in {"count", "files_with_matches"} and file_had_match:
                    continue
                if truncated or size_truncated:
                    break

            if output_mode == "files_with_matches":
                if not matching_files:
                    result = f"No matches found for pattern '{pattern}' in {path}"
                else:
                    ordered_files = sorted(
                        matching_files,
                        key=lambda name: (-file_mtimes.get(name, 0.0), name),
                    )
                    paged, truncated = _paginate(ordered_files, limit, offset)
                    result = "\n".join(paged)
            elif output_mode == "count":
                if not counts:
                    result = f"No matches found for pattern '{pattern}' in {path}"
                else:
                    ordered_files = sorted(
                        matching_files,
                        key=lambda name: (-file_mtimes.get(name, 0.0), name),
                    )
                    ordered, truncated = _paginate(ordered_files, limit, offset)
                    lines = [f"{name}: {counts[name]}" for name in ordered]
                    result = "\n".join(lines)
            else:
                if not blocks:
                    result = f"No matches found for pattern '{pattern}' in {path}"
                else:
                    result = "\n\n".join(blocks)

            notes: list[str] = []
            if output_mode == "content" and truncated:
                notes.append(
                    f"(pagination: limit={limit}, offset={offset})"
                )
            elif output_mode == "content" and size_truncated:
                notes.append("(output truncated due to size)")
            elif truncated and output_mode in {"count", "files_with_matches"}:
                notes.append(
                    f"(pagination: limit={limit}, offset={offset})"
                )
            elif output_mode in {"count", "files_with_matches"} and offset > 0:
                notes.append(f"(pagination: offset={offset})")
            elif output_mode == "content" and offset > 0 and blocks:
                notes.append(f"(pagination: offset={offset})")
            if skipped_binary:
                notes.append(f"(skipped {skipped_binary} binary/unreadable files)")
            if skipped_large:
                notes.append(f"(skipped {skipped_large} large files)")
            if output_mode == "count" and counts:
                notes.append(
                    f"(total matches: {sum(counts.values())} in {len(counts)} files)"
                )
            if notes:
                result += "\n\n" + "\n".join(notes)
            return result
        except PermissionError as e:
            return f"Error: {e}"
        except Exception as e:
            logger.warning(f"[grep] {e}")
            return f"Error searching files: {e}"

    def map_result(self, result: Any, context: ToolExecutionContext) -> ToolResult:
        text = str(result)
        if text.startswith("Error:"):
            return ToolResult.from_text(text, is_error=True)
        args = context.arguments or {}
        pattern = str(args.get("pattern") or "")
        path = str(args.get("path") or ".")
        output_mode = str(args.get("output_mode") or "files_with_matches")
        result_lines = _non_note_line_count(text)
        no_matches = text.startswith("No matches found")
        truncated = "(pagination:" in text or "(output truncated" in text
        matched_files = _grep_matched_files(text, output_mode, no_matches)
        summary = _grep_summary(pattern, path, output_mode, matched_files, result_lines, no_matches)
        return ToolResult(
            model_content=text,
            display_summary=summary,
            raw_content=text,
            metadata={
                "tool": "grep",
                "pattern": pattern,
                "path": path,
                "output_mode": output_mode,
                "matched_files": matched_files,
                "result_lines": result_lines,
                "truncated": truncated,
            },
        )


def _non_note_line_count(text: str) -> int:
    return len([
        line for line in text.splitlines()
        if line.strip() and not line.startswith("(")
    ])


def _grep_matched_files(text: str, output_mode: str, no_matches: bool) -> int:
    if no_matches:
        return 0
    lines = [
        line for line in text.splitlines()
        if line.strip() and not line.startswith("(")
    ]
    if output_mode == "content":
        paths = {line.split(":", 1)[0] for line in lines if ":" in line and not line[:1].isspace()}
        return len(paths)
    if output_mode == "count":
        return len([line for line in lines if ": " in line])
    return len(lines)


def _grep_summary(
    pattern: str,
    path: str,
    output_mode: str,
    matched_files: int,
    result_lines: int,
    no_matches: bool,
) -> str:
    if no_matches:
        return f"grep {pattern!r} found no matches in {path}"
    if output_mode == "content":
        return f"grep {pattern!r} returned {result_lines} match block{'s' if result_lines != 1 else ''} in {matched_files} file{'s' if matched_files != 1 else ''}"
    if output_mode == "count":
        return f"grep {pattern!r} counted matches in {matched_files} file{'s' if matched_files != 1 else ''}"
    return f"grep {pattern!r} matched {matched_files} file{'s' if matched_files != 1 else ''} in {path}"
