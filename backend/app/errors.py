"""Errors that reach the officer as a sentence.

The FastAPI service answers the same way the edge functions do — a non-2xx
status with `{"error": "..."}` — because the frontend already knows how to show
that string (`src/lib/ai.ts`). A raw 500 with an empty body would reach the
Materials page as nothing at all.
"""

from __future__ import annotations

from .config import Settings, get_settings


class AiError(Exception):
    """An expected failure with a status code and a readable message."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def require_settings() -> Settings:
    """Settings, or an error that names exactly which variables are unset.

    A misconfigured deploy is the single most likely reason this service fails,
    and "SUPABASE_URL is not set" is a 30-second fix while `KeyError` in a log
    is a 30-minute one.
    """
    settings = get_settings()
    missing = settings.missing()
    if missing:
        raise AiError(
            "The COMPASS API is not configured: "
            + ", ".join(missing)
            + " is not set. Add the variable on Render (or copy backend/.env.example "
            "to backend/.env locally) and redeploy.",
            500,
        )
    return settings
