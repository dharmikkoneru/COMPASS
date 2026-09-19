"""Shared test setup.

Settings are environment-backed and cached, so every test starts from a known
environment and an empty cache. Values here are fakes — no test should ever
need a real Supabase project or Gemini key.
"""

from __future__ import annotations

import pytest

from app.config import reset_settings_cache


@pytest.fixture(autouse=True)
def clean_settings(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://demo.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    reset_settings_cache()
    yield
    reset_settings_cache()
