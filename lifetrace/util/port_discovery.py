"""
端口发现工具 — 读取 Electron 主进程写入的 ports.json，获取各服务实际端口。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from lifetrace.util.logging_config import get_logger

logger = get_logger()

_DEFAULT_POPUP_TRIGGER_PORT = 19274


def get_runtime_dir() -> Path | None:
    runtime_dir = os.environ.get("LIFETRACE_RUNTIME_DIR")
    if runtime_dir:
        return Path(runtime_dir)
    # 回退：从 LIFETRACE_DATA_DIR 推算
    data_dir = os.environ.get("LIFETRACE_DATA_DIR")
    if data_dir:
        return Path(data_dir) / "runtime"
    return None


def get_service_port(name: str) -> int | None:
    runtime_dir = get_runtime_dir()
    if not runtime_dir:
        return None
    ports_file = runtime_dir / "ports.json"
    try:
        raw = ports_file.read_text(encoding="utf-8")
        data = json.loads(raw)
        record = data.get(name)
        if record and isinstance(record, dict):
            return int(record["port"])
    except Exception:
        pass
    return None


def get_popup_trigger_url() -> str:
    port = get_service_port("popup_trigger") or _DEFAULT_POPUP_TRIGGER_PORT
    return f"http://127.0.0.1:{port}/trigger"


def trigger_popup(message: str, session_id: str | None = None) -> bool:
    """向 Electron 主进程的 PopupTriggerServer 发送触发请求，显示悬浮聊天窗口。"""
    import urllib.request
    url = get_popup_trigger_url()
    payload: dict = {"message": message}
    if session_id:
        payload["session_id"] = session_id
    body = json.dumps(payload).encode("utf-8")
    try:
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except Exception as e:
        logger.debug(f"[popup_trigger] 触发悬浮窗失败 (非致命): {e}")
        return False
