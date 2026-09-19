"""Configuration for the COMPASS API.

Every value comes from the environment so a deployment needs no code change:
Render sets them in the dashboard, local development reads `backend/.env`.

Nothing here is required at import time. Secrets are only demanded when a route
actually needs them (:func:`require_settings`), which keeps the test suite and
the `/healthz` probe working on a machine with no credentials at all.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed settings. Field names map to upper-case env vars."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # ── Supabase ──────────────────────────────────────────────────
    # The anon key is public by design (it ships in the browser bundle). It is
    # here so PostgREST can be addressed the same way the browser does, with
    # the officer's own token doing the authorising — never a service key.
    supabase_url: str = ""
    supabase_anon_key: str = ""

    # ── Gemini ────────────────────────────────────────────────────
    gemini_api_key: str = ""
    # material_chunks.embedding is vector(768); a model that returns any other
    # width is refused rather than silently stored wrong.
    gemini_embed_dimensions: int = 768

    # ── HTTP ──────────────────────────────────────────────────────
    # Comma-separated. The Netlify site stays listed while Vercel is the new
    # primary, so neither deploy breaks during the transition.
    allowed_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "https://compassprototype2026.netlify.app,https://compass.vercel.app"
    )

    # ── Auth ──────────────────────────────────────────────────────
    # Supabase access tokens carry aud="authenticated".
    jwt_audience: str = "authenticated"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def rest_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/rest/v1"

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    @property
    def issuer(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    def missing(self) -> list[str]:
        """Names of the required settings that are still empty."""
        required = {
            "SUPABASE_URL": self.supabase_url,
            "SUPABASE_ANON_KEY": self.supabase_anon_key,
            "GEMINI_API_KEY": self.gemini_api_key,
        }
        return [name for name, value in required.items() if not value.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    """Testing helper: re-read the environment on the next call."""
    get_settings.cache_clear()
