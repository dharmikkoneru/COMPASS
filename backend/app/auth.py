"""Supabase access-token verification.

This project signs logins asymmetrically (ES256, P-256) and publishes the
public half at `/.well-known/jwks.json`, so the API verifies a token against
the project's own key set. No shared JWT secret is needed, which means no
secret can leak out of this service — only public keys are involved. (The
legacy HS256 scheme would have required the project's JWT secret; tokens signed
that way are refused with a message saying so.)

The token's `sub` claim is the officer's id, and the token itself is what the
database calls are authorised with, so RLS keeps applying exactly as it does in
the browser.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx
import jwt
from jwt import PyJWKSet

from .config import Settings

# Keys rotate rarely; an hour of caching keeps one verification from costing a
# network round trip. A rejected token forces one refresh, so rotation is
# picked up without waiting out the TTL.
JWKS_TTL_SECONDS = 3600

_jwks: dict | None = None
_jwks_fetched_at = 0.0


class AuthError(Exception):
    """The caller is not who they claim to be."""


@dataclass(frozen=True)
class CurrentUser:
    """The verified caller, plus the token that authorises their database work."""

    id: str
    token: str
    email: str | None = None


async def fetch_jwks(url: str) -> dict:
    """Fetch the project's published keys. Separate so tests can patch it."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(url)
        res.raise_for_status()
        return res.json()


async def get_jwks(settings: Settings, *, refresh: bool = False) -> dict:
    global _jwks, _jwks_fetched_at

    fresh = _jwks is not None and (time.monotonic() - _jwks_fetched_at) < JWKS_TTL_SECONDS
    if fresh and not refresh:
        return _jwks

    try:
        keys = await fetch_jwks(settings.jwks_url)
    except (httpx.HTTPError, ValueError) as err:
        if _jwks is not None:
            # Stale keys that still validate are better than refusing everyone
            # because the auth server is briefly unreachable.
            return _jwks
        # Name the URL, not just the failure. A misconfigured SUPABASE_URL is
        # indistinguishable from a Supabase outage in the old message, and the
        # client only ever sees this string — "Name or service not known" with
        # no host sent us to the dashboard once already.
        raise AuthError(
            f"could not fetch the project's signing keys from {settings.jwks_url} "
            f"({err}) - check that SUPABASE_URL names this project's Supabase URL"
        ) from err

    _jwks = keys
    _jwks_fetched_at = time.monotonic()
    return keys


def reset_jwks_cache() -> None:
    """Testing helper."""
    global _jwks, _jwks_fetched_at
    _jwks = None
    _jwks_fetched_at = 0.0


def _select_key(jwks: dict, kid: str | None) -> object:
    """Pick the public key named by the token's `kid` header."""
    try:
        key_set = PyJWKSet.from_dict(jwks)
    except jwt.PyJWTError as err:
        raise AuthError(f"the published key set could not be read ({err})") from err

    candidates = [k for k in key_set.keys if (k.algorithm_name or "ES256") == "ES256"]
    if not candidates:
        raise AuthError("the project publishes no ES256 signing key")

    if kid:
        for key in candidates:
            if key.key_id == kid:
                return key.key
        raise AuthError(
            f"the token was signed with key {kid}, which the project no longer publishes"
        )

    if len(candidates) == 1:
        return candidates[0].key
    raise AuthError("the token carries no key id, but the project publishes several keys")


async def verify_token(token: str, settings: Settings) -> dict:
    """Return the token's claims, or raise :class:`AuthError`."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as err:
        raise AuthError(f"that token is malformed ({err})") from err

    algorithm = header.get("alg", "")
    if algorithm != "ES256":
        raise AuthError(
            f"this project signs tokens with ES256, not {algorithm or 'an unknown algorithm'}"
        )

    kid = header.get("kid")
    last_error: Exception | None = None

    # Two passes: the cached key set, then one forced refresh in case the key
    # was rotated between our last fetch and this token being issued.
    for refresh in (False, True):
        key = _select_key(await get_jwks(settings, refresh=refresh), kid)
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=["ES256"],
                audience=settings.jwt_audience,
                options={"require": ["exp", "sub"]},
            )
        except jwt.InvalidTokenError as err:
            last_error = err
            continue

        issuer = claims.get("iss")
        # Present on every Supabase token; checking it stops a token minted by
        # some other project from being accepted here.
        if issuer and issuer.rstrip("/") != settings.issuer:
            raise AuthError("that token was issued for a different project")

        return claims

    raise AuthError(f"that token is not valid ({last_error})")
