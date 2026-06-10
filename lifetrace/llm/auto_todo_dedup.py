"""Helpers for suppressing repeated automatic todo suggestions."""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta
from typing import Any

from lifetrace.util.time_utils import get_utc_now, naive_as_utc

AUTO_TODO_FINGERPRINT_LABEL = "自动提取指纹"


def _normalize_text(value: Any) -> str:
    text = str(value or "").lower()
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[^\w\u4e00-\u9fff]", "", text)
    return text


def _raw_time_text(todo_data: dict[str, Any]) -> str:
    time_info = todo_data.get("time_info") or {}
    if isinstance(time_info, dict):
        return str(time_info.get("raw_text") or "")
    return ""


def build_auto_todo_fingerprint(todo_data: dict[str, Any]) -> str:
    """Build a stable fingerprint from fields that survive repeated screenshots."""
    title = _normalize_text(todo_data.get("title"))
    source_text = _normalize_text(todo_data.get("source_text"))
    raw_time = _normalize_text(_raw_time_text(todo_data))
    description = _normalize_text(todo_data.get("description"))
    payload = f"{title}|{source_text}|{raw_time}|{description}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def append_auto_todo_fingerprint(user_notes: str, fingerprint: str) -> str:
    if not fingerprint:
        return user_notes
    return f"{user_notes}\n{AUTO_TODO_FINGERPRINT_LABEL}: {fingerprint}"


def _extract_existing_fingerprint(todo: dict[str, Any]) -> str | None:
    notes = todo.get("user_notes") or ""
    match = re.search(rf"{AUTO_TODO_FINGERPRINT_LABEL}:\s*([a-f0-9]{{40}})", notes)
    return match.group(1) if match else None


def _extract_existing_source_text(todo: dict[str, Any]) -> str:
    notes = todo.get("user_notes") or ""
    match = re.search(r"来源文本:\s*(.+?)(?:\n|$)", notes)
    return match.group(1).strip() if match else ""


def _created_recently(todo: dict[str, Any], window_hours: int) -> bool:
    created_at = todo.get("created_at")
    if not created_at:
        return True
    if isinstance(created_at, str):
        try:
            created_at = datetime.fromisoformat(created_at)
        except ValueError:
            return True
    if not isinstance(created_at, datetime):
        return True
    return naive_as_utc(created_at) >= get_utc_now() - timedelta(hours=window_hours)


def is_duplicate_auto_todo(
    todo_data: dict[str, Any],
    existing_todos: list[dict[str, Any]],
    *,
    window_hours: int,
) -> bool:
    """Return True when a detected todo already exists or was already handled."""
    fingerprint = build_auto_todo_fingerprint(todo_data)
    title = _normalize_text(todo_data.get("title"))
    source_text = _normalize_text(todo_data.get("source_text"))

    if not title:
        return True

    for todo in existing_todos:
        if not _created_recently(todo, window_hours):
            continue

        if _extract_existing_fingerprint(todo) == fingerprint:
            return True

        existing_title = _normalize_text(todo.get("name"))
        if existing_title != title:
            continue

        existing_source = _normalize_text(_extract_existing_source_text(todo))
        if source_text and existing_source and source_text == existing_source:
            return True

        existing_description = _normalize_text(todo.get("description"))
        description = _normalize_text(todo_data.get("description"))
        if description and existing_description and description == existing_description:
            return True

    return False
