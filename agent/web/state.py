from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any

from aiohttp import web
from loguru import logger

from ..attachments import (
    AttachmentStore,
    ref_to_json,
)
from ..desktop_pet import DesktopPetManager
from ..external import ExternalBridgeService
from ..logger import configure as configure_logging
from ..loop import AgentLoop
from ..runtime import RuntimeEventStore
from ..runtime import events as runtime_events
from ..runtime.active import ActiveTaskInfo, ActiveTaskRegistry
from ..sessions.title import SessionTitleService
from ..sidebar_state import SidebarStateStore
from ..watchlist import WatchlistService
from .mutation_guard import assert_web_mutation_allowed
from .services import (
    ChatService,
    ConfigService,
    DiagnosticsService,
    MainlineTurnService,
    MemoryService,
    ModelService,
    SchedulerJobExecutor,
    SchedulerWebService,
    SkillService,
    TeamService,
    ensure_tool_config,
)


class WebUIState:
    def __init__(
        self,
        root: Path,
        *,
        webui_host: str | None = None,
        webui_port: int | None = None,
    ):
        self.root = root.resolve()
        # Address the local backend listens on; the desktop app loads the
        # frontend itself, so this is no longer a browser-facing web host.
        self.webui_host = webui_host
        self.webui_port = webui_port
        configure_logging(self.root)
        ensure_tool_config(self.root)
        self.loop = AgentLoop(root=self.root, verbose=False, startup_compaction=False)
        self.loop.init_mcp()
        self.mainline_turn_service = MainlineTurnService(self)
        self.session_title_service = SessionTitleService(self.loop.model_router)
        self.sidebar_state = SidebarStateStore(self.root)
        self.external_bridge = ExternalBridgeService(
            submit_turn=self.mainline_turn_service.submit,
            can_accept_turn=self._external_can_accept_turn,
            event_sink=self._broadcast_event,
            root=self.root,
        )
        self.chat_service = ChatService(self)
        self.diagnostics_service = DiagnosticsService(self)
        self.memory_service = MemoryService(self)
        self.model_service = ModelService(self)
        self.skill_service = SkillService(self)
        self.config_service = ConfigService(self)
        self.team_service = TeamService(self)
        self.scheduler_web_service = SchedulerWebService(self)
        self.scheduler_job_executor = SchedulerJobExecutor(self)
        self.desktop_pet = DesktopPetManager(self.root)
        self.history = self.loop.history
        self.attachments = AttachmentStore(self.root)
        self.lock = asyncio.Lock()
        self.clients: set[web.WebSocketResponse] = set()
        self.runtime_events = self._runtime_store_for_session(self.loop.active_session_id)
        self.watchlist_service = WatchlistService(
            self.root,
            model_router=self.loop.model_router,
            token_tracker=self.loop.token_tracker,
        )
        self.broadcast_lock = asyncio.Lock()
        self.max_event_log = 5000
        self.event_log: list[dict[str, Any]] = self.runtime_events.recent(self.max_event_log)
        self.event_seq = self.runtime_events.latest_seq
        self.active_turn = False
        self.active_tasks = ActiveTaskRegistry()
        self.loop.scheduler_service.on_job = self.scheduler_job_executor.run
        self.loop.scheduler_service.event_sink = self._broadcast_scheduler_event

    async def bootstrap(self, request: web.Request) -> web.Response:
        requested_session = str(request.query.get("session") or "").strip()
        if requested_session and not requested_session.startswith("draft:"):
            self.activate_session(requested_session)
        return self._json({
            "app": "Emperor Agent",
            "model": self.loop.model,
            "provider": self.loop.provider_name,
            "providerLabel": self.loop.provider_label,
            "tools": self.skill_service.tools(),
            "skills": self.skill_service.skills(),
            "memory": self.memory_service.memory(),
            "modelConfig": self.model_config(),
            "team": self.team_service.team(),
            "scheduler": self.scheduler_web_service.scheduler(),
            "control": self.control(),
            "desktopPet": self.desktop_pet.payload(),
            "context_used": self.loop.token_tracker.last_input_tokens(),
            "unarchivedHistory": self.memory_service.unarchived_history(),
            "runtime": self.memory_service.runtime(),
            "projects": self.loop.project_store.list(),
            "diagnostics": self.diagnostics_service.payload(),
        })

    async def upload_attachment(self, request: web.Request) -> web.Response:
        try:
            reader = await request.multipart()
        except Exception as exc:
            return self._json({"error": f"multipart parse failed: {exc}"}, status=400)
        field = await reader.next()
        if field is None or field.name != "file":
            return self._json({"error": "missing 'file' multipart field"}, status=400)
        raw = await field.read(decode=False)
        name = field.filename or "unnamed"
        mime = (field.headers.get("Content-Type") or "application/octet-stream").split(";")[0].strip()
        try:
            ref = self.attachments.save(raw=raw, name=name, mime=mime)
        except ValueError as exc:
            return self._json({"error": str(exc)}, status=400)
        return self._json(ref_to_json(ref))

    async def attachment_raw(self, request: web.Request) -> web.StreamResponse:
        att_id = request.match_info.get("id", "")
        ref = self.attachments.get(att_id)
        if ref is None:
            return web.Response(status=404, text="attachment not found")
        target = (self.attachments.root / ref.rel_path).resolve()
        if not _is_relative_to(target, self.attachments.root):
            return web.Response(status=403, text="forbidden")
        if not target.exists():
            return web.Response(status=404, text="file missing on disk")
        return web.FileResponse(target, headers={"Content-Type": ref.mime})

    async def model_test(self, request: web.Request) -> web.Response:
        payload, status = await self.model_service.test(await self._body(request))
        return self._json(payload, status=status)

    async def _broadcast_event(self, event: dict[str, Any], *, turn_id: str | None = None) -> None:
        async with self.broadcast_lock:
            payload = self._remember_event(event, turn_id=turn_id)
            disconnected = []
            for client in list(self.clients):
                if client.closed:
                    disconnected.append(client)
                    continue
                try:
                    await self._send_ws(client, payload)
                except (ConnectionResetError, RuntimeError):
                    disconnected.append(client)
            for client in disconnected:
                self.clients.discard(client)

    def _remember_event(self, event: dict[str, Any], *, turn_id: str | None = None) -> dict[str, Any]:
        payload = self.runtime_events.append(event, turn_id=turn_id)
        self.event_seq = int(payload.get("seq") or self.event_seq)
        self.event_log.append(payload)
        if len(self.event_log) > self.max_event_log:
            self.event_log = self.event_log[-self.max_event_log:]
        return payload

    async def _broadcast_scheduler_event(self, event: dict[str, Any]) -> None:
        await self._broadcast_event(event)

    def _external_can_accept_turn(self) -> bool:
        return not self.active_turn and not bool(self.control().get("pending"))

    def compact_runtime_events(self) -> dict[str, Any]:
        stats = self.runtime_events.compact(self.loop.active_memory_store.load_unarchived_turn_ids())
        self.event_log = self.runtime_events.recent(self.max_event_log)
        self.event_seq = self.runtime_events.latest_seq
        return stats

    def ready_event(self, *, last_seq: int = 0, replay_count: int = 0) -> dict[str, Any]:
        return runtime_events.ready_event(
            model=self.loop.model,
            provider=self.loop.provider_name,
            latest_seq=self.event_seq,
            replay_count=replay_count,
            resume_from=last_seq,
            busy=self.active_turn,
            control=self.control(),
        )

    async def post_runtime_stop(self, request: web.Request) -> web.Response:
        body = await self._body(request) if request.can_read_body else {}
        task_id = str(body.get("task_id") or "") or None
        kind = str(body.get("kind") or "") or None
        if kind not in {None, "", "turn", "scheduler", "team", "watchlist"}:
            raise web.HTTPBadRequest(reason="Invalid task kind")
        cancelled = await self.active_tasks.cancel(
            task_id=task_id,
            kind=kind if kind else None,  # type: ignore[arg-type]
        )
        for info in cancelled:
            await self._broadcast_cancelled_task(info, reason="user requested stop")
        if any(info.kind == "turn" for info in cancelled):
            self.active_turn = False
        return self._json({
            "cancelled": [info.to_dict() for info in cancelled],
            "active": [info.to_dict() for info in await self.active_tasks.list()],
        })

    def start_desktop_pet_for_webui(self) -> None:
        payload = self.desktop_pet.start_for_webui(
            host=self.webui_host or self._webui_host(),
            port=self.webui_port or self._webui_port(),
        )
        if payload.get("enabled") and payload.get("lastError"):
            logger.warning("desktop pet not started: {}", payload.get("lastError"))

    async def get_desktop_pet(self, request: web.Request) -> web.Response:
        return self._json(self.desktop_pet.payload())

    async def post_desktop_pet(self, request: web.Request) -> web.Response:
        assert_web_mutation_allowed(self.control(), area="desktop pet", action="toggle")
        body = await self._body(request)
        if "enabled" not in body:
            raise web.HTTPBadRequest(reason="desktop-pet: 'enabled' is required")
        if not isinstance(body.get("enabled"), bool):
            raise web.HTTPBadRequest(reason="desktop-pet: 'enabled' must be a boolean")
        return self._json(
            self.desktop_pet.set_enabled(
                body["enabled"],
                host=self.webui_host or self._webui_host(),
                port=self.webui_port or self._webui_port(),
            )
        )

    async def _broadcast_cancelled_task(self, info: ActiveTaskInfo, *, reason: str) -> None:
        await self._broadcast_event(
            runtime_events.runtime_task_cancelled(info.to_dict(), reason=reason),
            turn_id=info.turn_id,
        )

    async def get_external(self, request: web.Request) -> web.Response:
        return self._json(self.external_bridge.payload())

    async def get_control(self, request: web.Request) -> web.Response:
        return self._json(self.control())

    async def post_control_mode(self, request: web.Request) -> web.Response:
        if self.active_turn:
            raise web.HTTPConflict(reason="Cannot change control mode while a turn is running")
        if self.control().get("pending"):
            raise web.HTTPConflict(reason="Cannot change control mode while Ask / Plan is pending")
        body = await self._body(request)
        mode = str(body.get("mode") or "")
        data = self.loop.control_manager.set_mode(mode)
        await self._broadcast_event(runtime_events.control_mode_update(data))
        return self._json(data)

    async def post_control_cancel(self, request: web.Request) -> web.Response:
        interaction_id = request.match_info.get("id", "")
        turn_id = self.new_turn_id()
        event = self.loop.control_manager.cancel(interaction_id)
        await self.chat_service.record_control_cancel(
            str(event.get("message") or ""),
            "已取消等待中的交互",
            turn_id=turn_id,
        )
        await self._broadcast_event(event, turn_id=turn_id)
        await self._broadcast_event(runtime_events.control_mode_update(self.control()))
        return self._json(self.control())

    async def get_model_config(self, request: web.Request) -> web.Response:
        return self._json(self.model_config())

    async def post_model_config(self, request: web.Request) -> web.Response:
        body = await self._body(request)
        config = body.get("config") if isinstance(body.get("config"), dict) else body
        async with self.lock:
            try:
                self.model_service.save(config)
            except ValueError as exc:
                return self._json({"error": str(exc)}, status=400)
        return self._json(self.model_config())

    async def post_compact(self, request: web.Request) -> web.Response:
        async with self.lock:
            memory_store = self.loop.active_memory_store
            unarchived = memory_store.load_unarchived_history()
            count = len(unarchived)
            if count < 2:
                return self._json({
                    "status": "skipped",
                    "count": count,
                    "message": "未归档消息不足 2 条，无需压缩。",
                    "memory": self.memory_service.memory(),
                    "unarchivedHistory": self.memory_service.unarchived_history(),
                })

            await self.loop.compactor.compact_startup_async(unarchived)
            self.compact_runtime_events()
            self.loop.history = []
            self.history = self.loop.history
            self.loop.refresh_runtime_context()
            return self._json({
                "status": "compacted",
                "count": count,
                "message": f"已压缩 {count} 条未归档消息。",
                "memory": self.memory_service.memory(),
                "unarchivedHistory": self.memory_service.unarchived_history(),
            })

    async def not_found(self, request: web.Request) -> web.Response:
        # API/WS-only backend: any non-api path is a JSON 404. The desktop app
        # serves the frontend itself, so there is no SPA HTML fallback here.
        return web.json_response({"error": "not_found"}, status=404)

    def control(self) -> dict[str, Any]:
        return self.loop.control_manager.payload()

    def activate_session(self, session_id: str) -> dict[str, Any]:
        entry = self.loop.session_store.get(session_id)
        if entry is None:
            raise web.HTTPNotFound(reason=f"Session not found: {session_id}")
        self.loop.activate_session(session_id)
        self.history = self.loop.history
        self.runtime_events = self._runtime_store_for_session(session_id)
        self.event_log = self.runtime_events.recent(self.max_event_log)
        self.event_seq = self.runtime_events.latest_seq
        return entry

    async def prepare_session_for_turn(
        self,
        *,
        session_id: str | None,
        draft_session: dict[str, Any] | None,
        preview: str,
    ) -> dict[str, Any]:
        resolved = str(session_id or "").strip()
        created = False
        client_draft_id = ""
        if resolved and self.loop.session_store.get(resolved) is None:
            raise web.HTTPNotFound(reason=f"Session not found: {resolved}")
        if not resolved and not draft_session:
            resolved = self.loop.active_session_id or ""
            if not resolved:
                first = self.loop.session_store.list()[:1]
                resolved = str(first[0]["id"]) if first else ""
            if not resolved:
                entry = self.loop.session_store.create("Default", title_status="manual")
                resolved = str(entry["id"])
        if not resolved:
            title = str((draft_session or {}).get("title") or "新会话").strip() or "新会话"
            mode = str((draft_session or {}).get("mode") or "chat").strip().lower()
            project = self._project_from_draft(draft_session) if mode == "build" else None
            entry = self.loop.session_store.create(
                title,
                title_status="pending",
                mode=mode,
                project=project,
            )
            resolved = str(entry["id"])
            created = True
            client_draft_id = str((draft_session or {}).get("client_draft_id") or "")
        entry = self.activate_session(resolved)
        touched = self.loop.session_store.touch(resolved, preview, increment_messages=True)
        if touched:
            entry = touched
        return {
            "session": entry,
            "created": created,
            "client_draft_id": client_draft_id,
        }

    def _project_from_draft(self, draft_session: dict[str, Any] | None) -> dict[str, Any] | None:
        draft_session = draft_session or {}
        project_id = str(draft_session.get("project_id") or "").strip()
        if project_id:
            project = self.loop.project_store.get(project_id)
            if project is not None:
                return project
        project_path = str(draft_session.get("project_path") or "").strip()
        if not project_path:
            raise web.HTTPBadRequest(reason="Build session requires project_path")
        try:
            return self.loop.project_store.resolve(project_path)
        except ValueError as exc:
            raise web.HTTPBadRequest(reason=str(exc)) from exc

    def schedule_session_title(self, session_id: str, first_message: str) -> None:
        async def run() -> None:
            try:
                title = await self.session_title_service.generate(first_message)
                entry = self.loop.session_store.set_generated_title(session_id, title)
                if entry is not None:
                    await self._broadcast_event(runtime_events.session_title_updated(entry))
            except Exception as exc:
                logger.warning("session title task failed for {}: {}", session_id, exc)

        asyncio.create_task(run())

    def _runtime_store_for_session(self, session_id: str | None) -> RuntimeEventStore:
        if session_id:
            return RuntimeEventStore(
                self.loop.session_store.session_dir(session_id),
                session_dir_override=True,
            )
        return RuntimeEventStore(self.root)

    def new_turn_id(self) -> str:
        return f"turn_{uuid.uuid4().hex[:16]}"

    def attachment_refs(self, attachment_ids: list[str]) -> list[dict[str, Any]]:
        refs: list[dict[str, Any]] = []
        for aid in attachment_ids:
            ref = self.attachments.get(aid)
            if ref is not None:
                refs.append(ref_to_json(ref))
        return refs

    @staticmethod
    def safe_int(value: str | None, fallback: int = 0) -> int:
        try:
            return int(value or fallback)
        except (TypeError, ValueError):
            return fallback

    def model_config(self) -> dict[str, Any]:
        return self.model_service.payload()

    def _webui_host(self) -> str:
        from ..local_config import load_local_config

        return load_local_config(self.root).webui.host

    def _webui_port(self) -> int:
        from ..local_config import load_local_config

        return load_local_config(self.root).webui.port

    def _rel(self, p: str | Path) -> str:
        return Path(p).resolve().relative_to(self.root).as_posix()

    @staticmethod
    async def _body(request: web.Request) -> dict[str, Any]:
        try:
            data = await request.json()
        except json.JSONDecodeError as exc:
            raise web.HTTPBadRequest(reason="Invalid JSON body") from exc
        if not isinstance(data, dict):
            raise web.HTTPBadRequest(reason="JSON body must be an object")
        return data

    @staticmethod
    async def _send_ws(ws: web.WebSocketResponse, payload: dict[str, Any]) -> None:
        await ws.send_str(json.dumps(payload, ensure_ascii=False))

    @staticmethod
    def _json(data: Any, status: int = 200) -> web.Response:
        return web.json_response(
            data,
            status=status,
            dumps=lambda value: json.dumps(value, ensure_ascii=False),
        )


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False
