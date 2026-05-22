from __future__ import annotations

import json
import time
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

LOCAL_CONFIG_FILE = "emperor.local.json"


@dataclass(frozen=True)
class WebUIPreferences:
    host: str = "127.0.0.1"
    port: int = 8765
    open_browser: bool = False


@dataclass(frozen=True)
class DesktopPetPreferences:
    enabled: bool = False
    auto_start_with_webui: bool = True


@dataclass(frozen=True)
class LocalConfig:
    webui: WebUIPreferences = WebUIPreferences()
    desktop_pet: DesktopPetPreferences = DesktopPetPreferences()


def load_local_config(root: Path) -> LocalConfig:
    path = Path(root).resolve() / LOCAL_CONFIG_FILE
    if not path.exists():
        return LocalConfig()
    try:
        raw = json.loads(path.read_text(encoding="utf-8") or "{}")
    except (json.JSONDecodeError, OSError):
        _preserve_corrupt_local_config(path)
        return LocalConfig()
    return parse_local_config(raw)


def parse_local_config(raw: dict[str, Any] | None) -> LocalConfig:
    data = raw if isinstance(raw, dict) else {}
    webui = data.get("webui") if isinstance(data.get("webui"), dict) else {}
    desktop_pet = data.get("desktopPet")
    if not isinstance(desktop_pet, dict):
        desktop_pet = data.get("desktop_pet")
    if not isinstance(desktop_pet, dict):
        desktop_pet = {}
    return LocalConfig(
        webui=WebUIPreferences(
            host=str(webui.get("host") or "127.0.0.1"),
            port=_valid_port(webui.get("port"), 8765),
            open_browser=bool(webui.get("openBrowser", webui.get("open_browser", False))),
        ),
        desktop_pet=DesktopPetPreferences(
            enabled=bool(desktop_pet.get("enabled", False)),
            auto_start_with_webui=bool(
                desktop_pet.get(
                    "autoStartWithWebui",
                    desktop_pet.get("auto_start_with_webui", True),
                )
            ),
        ),
    )


def save_local_config(root: Path, config: LocalConfig) -> Path:
    path = Path(root).resolve() / LOCAL_CONFIG_FILE
    payload = {
        "webui": {
            "host": config.webui.host,
            "port": config.webui.port,
            "openBrowser": config.webui.open_browser,
        },
        "desktopPet": {
            "enabled": config.desktop_pet.enabled,
            "autoStartWithWebui": config.desktop_pet.auto_start_with_webui,
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    return path


def merge_webui_overrides(
    config: LocalConfig,
    *,
    host: str | None = None,
    port: int | None = None,
    open_browser: bool | None = None,
) -> WebUIPreferences:
    return WebUIPreferences(
        host=str(host or config.webui.host or "127.0.0.1"),
        port=_valid_port(port if port is not None else config.webui.port, 8765),
        open_browser=config.webui.open_browser if open_browser is None else bool(open_browser),
    )


def local_config_path(root: Path) -> Path:
    return Path(root).resolve() / LOCAL_CONFIG_FILE


def local_config_diagnostics(root: Path) -> dict[str, Any]:
    path = local_config_path(root)
    backups = sorted(
        path.parent.glob(f"{LOCAL_CONFIG_FILE}.corrupt-*"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    status = "missing"
    error = ""
    if path.exists():
        try:
            json.loads(path.read_text(encoding="utf-8") or "{}")
        except (json.JSONDecodeError, OSError) as exc:
            status = "corrupt"
            error = str(exc)
        else:
            status = "ok"
    return {
        "path": path.as_posix(),
        "exists": path.exists(),
        "status": status,
        "error": error,
        "corruptBackups": [
            {
                "path": item.as_posix(),
                "bytes": item.stat().st_size,
                "updatedAt": item.stat().st_mtime,
            }
            for item in backups[:10]
        ],
    }


def _preserve_corrupt_local_config(path: Path) -> None:
    backup = path.with_name(f"{path.name}.corrupt-{int(time.time())}-{uuid4().hex[:8]}")
    with suppress(OSError):
        if path.exists():
            path.rename(backup)


def _valid_port(value: Any, default: int) -> int:
    try:
        port = int(value)
    except (TypeError, ValueError):
        return default
    if 1 <= port <= 65535:
        return port
    return default
