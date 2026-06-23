from __future__ import annotations

from pathlib import Path


class WorkspaceContext:
    """Mutable workspace root shared by tools for the active session."""

    def __init__(self, default_root: Path) -> None:
        self.default_root = Path(default_root).resolve()
        self._path = self.default_root

    @property
    def path(self) -> Path:
        return self._path

    def set(self, path: str | Path | None) -> None:
        if path is None:
            self.reset()
            return
        self._path = Path(path).expanduser().resolve()

    def reset(self) -> None:
        self._path = self.default_root
