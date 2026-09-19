"""Token verification, tested against a real ES256 key pair.

These are the tests that matter most: if verification is wrong, either the API
is open to anyone or every officer is locked out. Nothing here touches the
network — the project's JWKS document is generated in-test from a key pair the
test also signs with, which is the same shape Supabase publishes.
"""

from __future__ import annotations

import asyncio
import base64
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app import auth
from app.config import get_settings


def _b64url(number: int) -> str:
    return base64.urlsafe_b64encode(number.to_bytes(32, "big")).rstrip(b"=").decode()


@pytest.fixture
def signing_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def jwks(signing_key: ec.EllipticCurvePrivateKey, monkeypatch: pytest.MonkeyPatch):
    numbers = signing_key.public_key().public_numbers()
    document = {
        "keys": [
            {
                "kty": "EC",
                "crv": "P-256",
                "x": _b64url(numbers.x),
                "y": _b64url(numbers.y),
                "kid": "current",
                "alg": "ES256",
                "use": "sig",
            }
        ]
    }
    seen: list[str] = []

    async def fake_fetch(url: str) -> dict:
        seen.append(url)
        return document

    monkeypatch.setattr(auth, "fetch_jwks", fake_fetch)
    auth.reset_jwks_cache()
    yield document, seen
    auth.reset_jwks_cache()


def make_token(
    signing_key: ec.EllipticCurvePrivateKey,
    *,
    kid: str | None = "current",
    **overrides: object,
) -> str:
    settings = get_settings()
    claims: dict[str, object] = {
        "sub": "user-1",
        "email": "officer@gov.in",
        "aud": "authenticated",
        "iss": f"{settings.supabase_url}/auth/v1",
        "exp": int(time.time()) + 3600,
    }
    claims.update(overrides)
    headers = {"kid": kid} if kid else None
    return jwt.encode(claims, signing_key, algorithm="ES256", headers=headers)


def verify(token: str) -> dict:
    return asyncio.run(auth.verify_token(token, get_settings()))


def test_accepts_a_token_this_project_signed(signing_key, jwks) -> None:
    claims = verify(make_token(signing_key))
    assert claims["sub"] == "user-1"
    assert claims["email"] == "officer@gov.in"


def test_fetches_the_key_set_from_the_project(signing_key, jwks) -> None:
    _, seen = jwks
    verify(make_token(signing_key))
    assert seen == ["https://demo.supabase.co/auth/v1/.well-known/jwks.json"]


def test_rejects_a_token_signed_by_someone_else(jwks) -> None:
    intruder = ec.generate_private_key(ec.SECP256R1())
    with pytest.raises(auth.AuthError, match="not valid"):
        verify(make_token(intruder))


def test_rejects_an_expired_token(signing_key, jwks) -> None:
    with pytest.raises(auth.AuthError, match="not valid"):
        verify(make_token(signing_key, exp=int(time.time()) - 10))


def test_rejects_a_token_from_another_project(signing_key, jwks) -> None:
    with pytest.raises(auth.AuthError, match="different project"):
        verify(make_token(signing_key, iss="https://someone-else.supabase.co/auth/v1"))


def test_rejects_the_wrong_audience(signing_key, jwks) -> None:
    with pytest.raises(auth.AuthError, match="not valid"):
        verify(make_token(signing_key, aud="service_role"))


def test_rejects_an_hs256_token_and_says_why(signing_key, jwks) -> None:
    legacy = jwt.encode(
        {
            "sub": "user-1",
            "aud": "authenticated",
            "iss": "https://demo.supabase.co/auth/v1",
            "exp": int(time.time()) + 3600,
        },
        "shared-secret-long-enough-to-avoid-a-warning",
        algorithm="HS256",
    )
    with pytest.raises(auth.AuthError, match="ES256"):
        verify(legacy)


def test_rejects_a_token_for_a_key_that_is_no_longer_published(signing_key, jwks) -> None:
    with pytest.raises(auth.AuthError, match="no longer publishes"):
        verify(make_token(signing_key, kid="rotated-away"))


def test_rejects_nonsense(signing_key, jwks) -> None:
    with pytest.raises(auth.AuthError, match="malformed"):
        verify("not.a.token")


def test_accepts_a_token_with_no_kid_when_one_key_is_published(signing_key, jwks) -> None:
    assert verify(make_token(signing_key, kid=None))["sub"] == "user-1"


def test_a_token_without_a_subject_is_refused(signing_key, jwks) -> None:
    settings = get_settings()
    token = jwt.encode(
        {
            "aud": "authenticated",
            "iss": f"{settings.supabase_url}/auth/v1",
            "exp": int(time.time()) + 3600,
        },
        signing_key,
        algorithm="ES256",
        headers={"kid": "current"},
    )
    with pytest.raises(auth.AuthError, match="not valid"):
        verify(token)
