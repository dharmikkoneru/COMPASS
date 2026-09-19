"""Gemini access, with the failure modes this project has already been bitten by.

Three hard-won rules are enforced here, all of them learned the expensive way:

1. **Models retire on a rolling basis.** A hard-coded name starts returning 404
   for new API keys ("no longer available to new users"), so the current family
   goes first, legacy names stay last, and anything else this key can actually
   call is discovered via ListModels before giving up.
2. **A deadline keeps failures debuggable.** The edge-function version of this
   code learned that without a wall-clock budget an invocation is killed by the
   platform with no body and no stack. The same budget discipline is kept here.
3. **The embedding width is checked, not assumed.** `material_chunks.embedding`
   is `vector(768)`; a model that returns 3072 values must be caught before it
   is stored, or search silently degrades.

Raw REST rather than a vendor SDK: it is the shape the existing, proven edge
functions use, it needs no extra dependency, and it keeps every error message
verbatim.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx

API_BASE = "https://generativelanguage.googleapis.com/v1beta"

# ── Budget ────────────────────────────────────────────────────────
# One invocation shares a single deadline. The reserve is time kept aside for
# the database writes that follow the model call, so a slow model cannot use up
# the time needed to store its own answer.
DEADLINE_SECONDS = 100.0
WRITE_RESERVE_SECONDS = 12.0
MIN_ATTEMPT_SECONDS = 8.0
MAX_REQUEST_SECONDS = 60.0
MAX_MODEL_ATTEMPTS = 6
RETRY_DELAY_SECONDS = 1.5

# Gemini answers 503 UNAVAILABLE in bursts that clear within seconds; treating
# that as fatal made a working model look broken.
TRANSIENT_STATUS = frozenset({429, 500, 502, 503, 504})

PREFERRED_MODELS = (
    "gemini-3.6-flash",  # Google's own migration target for gemini-2.5-flash
    "gemini-3.5-flash-lite",  # ...and for gemini-2.5-flash-lite
    "gemini-flash-latest",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
)


class GeminiError(Exception):
    """Gemini could not be reached, or refused every model offered."""


@dataclass
class Budget:
    """A wall-clock deadline shared by everything in one request."""

    deadline: float

    @classmethod
    def start(cls, seconds: float = DEADLINE_SECONDS) -> Budget:
        return cls(deadline=time.monotonic() + seconds)

    def remaining(self) -> float:
        return self.deadline - time.monotonic()

    def spent(self) -> float:
        return max(0.0, DEADLINE_SECONDS - self.remaining())


def seconds(ms: float) -> str:
    return f"{max(0, round(ms))}s"


def clip(text: str, limit: int = 240) -> str:
    return f"{text[:limit]}…" if len(text) > limit else text


# ── HTTP plumbing ─────────────────────────────────────────────────

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    """A shared client, so keep-alive works across the calls in one request."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient()
    return _client


async def aclose() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


async def _request(
    method: str,
    url: str,
    *,
    budget: Budget,
    params: dict[str, str] | None = None,
    json_body: Any = None,
) -> httpx.Response:
    """One bounded call. Raises :class:`GeminiError` on transport failure."""
    timeout = min(max(budget.remaining(), 1.0), MAX_REQUEST_SECONDS)
    try:
        return await client().request(
            method,
            url,
            params=params,
            json=json_body,
            timeout=httpx.Timeout(timeout, connect=min(10.0, timeout)),
        )
    except httpx.HTTPError as err:
        detail = f"{err.__class__.__name__}: {err}"
        raise GeminiError(f"the request did not complete ({detail})") from err


# ── Model discovery ───────────────────────────────────────────────

_MODEL_VERSION = re.compile(r"^gemini-(\d+(?:\.\d+)?)")
_UNSTABLE = re.compile(r"(preview|exp|experimental|thinking)")
_NOT_TEXT = re.compile(r"(embedding|aqa|image|tts|learnlm)")


def _version(name: str) -> float:
    match = _MODEL_VERSION.match(name)
    return float(match.group(1)) if match else 0.0


async def list_models(api_key: str, budget: Budget) -> list[dict[str, Any]]:
    """Every model this key can see, with the methods each supports."""
    res = await _request(
        "GET",
        f"{API_BASE}/models",
        budget=budget,
        params={"pageSize": "200", "key": api_key},
    )
    if res.status_code >= 400:
        raise GeminiError(f"ListModels HTTP {res.status_code}: {clip(res.text)}")
    try:
        body = res.json()
    except ValueError as err:
        raise GeminiError(f"ListModels returned unreadable JSON ({err})") from err
    models = body.get("models") if isinstance(body, dict) else None
    return models if isinstance(models, list) else []


def _supports(model: dict[str, Any], method: str) -> bool:
    methods = model.get("supportedGenerationMethods") or []
    return isinstance(methods, list) and method in methods


def generate_capable_names(models: list[dict[str, Any]], *, exclude: set[str]) -> list[str]:
    """Discovered text models fit for quiz generation, best first.

    Newest version wins, then stable over preview, then flash over pro — the
    same ordering the edge function settled on.
    """
    names = [
        str(model.get("name", "")).removeprefix("models/")
        for model in models
        if _supports(model, "generateContent")
    ]
    usable = [
        name
        for name in names
        if name.startswith("gemini") and not _NOT_TEXT.search(name) and name not in exclude
    ]
    return sorted(
        usable,
        key=lambda name: (
            -_version(name),
            bool(_UNSTABLE.search(name)),
            "flash" not in name,
            len(name),
        ),
    )


# ── Quiz generation ───────────────────────────────────────────────


def generation_config(model: str, temperature: float, schema: dict[str, Any]) -> dict[str, Any]:
    """Request config for one generateContent call.

    Gemini 2.5 Flash thinks before answering, and the minutes that can consume
    are what previously ran the Deno version past its worker limit. A thinking
    budget of 0 disables that; the pro models reject 0, so only the flash family
    is touched. The guard stays version-specific because a rejected field is a
    400 that would read as a broken model instead of a bad request.
    """
    config: dict[str, Any] = {
        "responseMimeType": "application/json",
        "responseSchema": schema,
        "temperature": temperature,
    }
    if model.startswith("gemini-2.5") and "pro" not in model:
        config["thinkingConfig"] = {"thinkingBudget": 0}
    return config


def candidate_text(body: Any) -> str | None:
    """The model's answer text, wherever it sits among the parts."""
    try:
        parts = body["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError, TypeError):
        return None
    if not isinstance(parts, list):
        return None
    for part in parts:
        text = part.get("text") if isinstance(part, dict) else None
        if isinstance(text, str) and text.strip():
            return text
    return None


async def _attempt_model(
    api_key: str,
    model: str,
    prompt: str,
    schema: dict[str, Any],
    budget: Budget,
    failures: list[str],
    tried: list[str],
) -> tuple[dict[str, Any], str] | None:
    """Try one model twice; a transient failure earns the second attempt."""
    for attempt in range(2):
        remaining = budget.remaining()
        if remaining < MIN_ATTEMPT_SECONDS:
            failures.append(f"{model}: not tried, only {seconds(remaining)} of the budget left")
            return None
        if attempt == 0:
            tried.append(model)

        try:
            res = await client().request(
                "POST",
                f"{API_BASE}/models/{model}:generateContent",
                params={"key": api_key},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": generation_config(
                        model, 0.4 if attempt == 0 else 0.8, schema
                    ),
                },
                timeout=httpx.Timeout(
                    min(max(remaining - WRITE_RESERVE_SECONDS, 1.0), MAX_REQUEST_SECONDS),
                    connect=10.0,
                ),
            )
        except httpx.HTTPError as err:
            # Retrying a hung endpoint rarely helps, and the budget is finite.
            failures.append(f"{model}: request did not complete ({err})")
            return None

        if res.status_code >= 400:
            failures.append(f"{model}: HTTP {res.status_code} {clip(res.text)}")
            # A 404/403 will not improve on retry; an overloaded or rate-limited
            # endpoint often does, so wait out the burst and try once more.
            if (
                res.status_code not in TRANSIENT_STATUS
                or budget.remaining() < MIN_ATTEMPT_SECONDS + RETRY_DELAY_SECONDS
            ):
                break
            await asyncio.sleep(RETRY_DELAY_SECONDS)
            continue

        try:
            body = res.json()
        except ValueError as err:
            failures.append(f"{model}: returned unreadable JSON ({err})")
            continue

        text = candidate_text(body)
        if not text:
            failures.append(f"{model}: response contained no candidate text")
            continue  # transient — try this model once more

        try:
            payload = json.loads(text)
        except json.JSONDecodeError as err:
            failures.append(f"{model}: returned invalid JSON ({err})")
            continue
        if not isinstance(payload, dict):
            failures.append(f"{model}: returned {type(payload).__name__}, expected an object")
            continue
        return payload, model

    return None


async def generate_json(
    api_key: str,
    prompt: str,
    *,
    schema: dict[str, Any],
    budget: Budget,
) -> tuple[dict[str, Any], str]:
    """Ask Gemini for JSON matching `schema`. Returns the payload and the model.

    Curated names go first: discovery costs a round trip the common case does
    not need, so it waits until every known name has failed. Every failure is
    kept, because reporting only the last one hides the model that failed for
    the more interesting reason.
    """
    failures: list[str] = []
    tried: list[str] = []

    async def try_models(models: list[str]) -> tuple[dict[str, Any], str] | None:
        for model in models:
            answer = await _attempt_model(api_key, model, prompt, schema, budget, failures, tried)
            if answer is not None:
                return answer
        return None

    answer = await try_models(list(PREFERRED_MODELS[:MAX_MODEL_ATTEMPTS]))
    if answer is not None:
        return answer

    discovery_error: str | None = None
    try:
        discovered = generate_capable_names(
            await list_models(api_key, budget), exclude=set(PREFERRED_MODELS)
        )
        fallback = await try_models(discovered[:MAX_MODEL_ATTEMPTS])
        if fallback is not None:
            return fallback
    except GeminiError as err:
        discovery_error = str(err)

    raise GeminiError(
        "\n".join(
            [
                "No Gemini model could generate the quiz.",
                *( [f"ListModels failed: {discovery_error}"] if discovery_error else [] ),
                *( [f"Tried: {', '.join(tried)}"] if tried else [] ),
                *(
                    [
                        f"Out of time: stopped after {seconds(budget.spent())} to stay inside the "
                        "request budget. Try again, or ask for fewer questions."
                    ]
                    if budget.remaining() < MIN_ATTEMPT_SECONDS
                    else []
                ),
                *failures,
            ]
        )
    )


async def generate_text(
    api_key: str,
    prompt: str,
    *,
    budget: Budget,
    temperature: float = 0.2,
) -> tuple[str, str]:
    """Ask Gemini for prose (the grounded RAG answer). Returns text and model.

    Same retry shape as :func:`generate_json` — the difference is only that a
    free-form answer has no JSON contract to enforce, so there is no schema and
    nothing to parse.
    """
    failures: list[str] = []

    async def attempt(model: str) -> str | None:
        remaining = budget.remaining()
        if remaining < MIN_ATTEMPT_SECONDS:
            failures.append(f"{model}: not tried, time budget exhausted")
            return None
        try:
            res = await client().request(
                "POST",
                f"{API_BASE}/models/{model}:generateContent",
                params={"key": api_key},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": temperature},
                },
                timeout=httpx.Timeout(
                    min(max(remaining - WRITE_RESERVE_SECONDS, 1.0), MAX_REQUEST_SECONDS),
                    connect=10.0,
                ),
            )
        except httpx.HTTPError as err:
            failures.append(f"{model}: request did not complete ({err})")
            return None

        if res.status_code >= 400:
            failures.append(f"{model}: HTTP {res.status_code} {clip(res.text)}")
            return None

        try:
            body = res.json()
        except ValueError as err:
            failures.append(f"{model}: returned unreadable JSON ({err})")
            return None

        text = candidate_text(body)
        if not text:
            failures.append(f"{model}: empty candidate text")
            return None
        return text.strip()

    for model in PREFERRED_MODELS:
        answer = await attempt(model)
        if answer:
            return answer, model

    # The curated names failed; anything else this key can call gets one chance.
    try:
        discovered = generate_capable_names(
            await list_models(api_key, budget), exclude=set(PREFERRED_MODELS)
        )
        for model in discovered:
            answer = await attempt(model)
            if answer:
                return answer, model
    except GeminiError as err:
        failures.append(f"discovery failed: {err}")

    raise GeminiError("No Gemini model could answer.\n" + "\n".join(failures))


# ── Embeddings ────────────────────────────────────────────────────


@dataclass(frozen=True)
class EmbedCandidate:
    """An embedding model, and whether it accepts an explicit output width."""

    name: str
    explicit_dimensions: bool


CURATED_EMBED_MODELS = (
    # gemini-embedding-001 is current and natively 3072-wide, so the width must
    # be requested explicitly to match material_chunks.embedding vector(768).
    EmbedCandidate("gemini-embedding-001", True),
    # text-embedding-004 is 768-wide natively — what migration 0007 was written
    # for — but it now 404s for new API keys, so it is a fallback, not a default.
    EmbedCandidate("text-embedding-004", False),
)


async def _embed_candidates(api_key: str, budget: Budget) -> list[EmbedCandidate]:
    """Curated models first, then anything else this key can embed with."""
    seen = set()
    candidates: list[EmbedCandidate] = []
    for candidate in CURATED_EMBED_MODELS:
        seen.add(candidate.name)
        candidates.append(candidate)

    try:
        models = await list_models(api_key, budget)
    except GeminiError:
        return candidates

    for model in models:
        name = str(model.get("name", "")).removeprefix("models/")
        if name in seen or "embedding" not in name or not _supports(model, "embedContent"):
            continue
        seen.add(name)
        candidates.append(EmbedCandidate(name, not name.startswith("text-embedding")))
    return candidates


async def _embed_batch(
    api_key: str,
    candidate: EmbedCandidate,
    texts: list[str],
    budget: Budget,
    dimensions: int,
) -> list[list[float]]:
    requests: list[dict[str, Any]] = []
    for text in texts:
        entry: dict[str, Any] = {
            "model": f"models/{candidate.name}",
            "content": {"parts": [{"text": text}]},
        }
        if candidate.explicit_dimensions:
            entry["outputDimensionality"] = dimensions
        requests.append(entry)

    res = await _request(
        "POST",
        f"{API_BASE}/models/{candidate.name}:batchEmbedContents",
        budget=budget,
        params={"key": api_key},
        json_body={"requests": requests},
    )
    if res.status_code >= 400:
        raise GeminiError(f"HTTP {res.status_code} {clip(res.text)}")

    try:
        body = res.json()
    except ValueError as err:
        raise GeminiError(f"unreadable JSON ({err})") from err

    embeddings = body.get("embeddings") if isinstance(body, dict) else None
    vectors = [
        e.get("values") or [] for e in (embeddings if isinstance(embeddings, list) else [])
    ]
    if len(vectors) != len(texts):
        raise GeminiError(f"returned {len(vectors)} vectors for {len(texts)} texts")
    return vectors


async def embed_texts(
    api_key: str,
    texts: list[str],
    *,
    budget: Budget,
    dimensions: int = 768,
) -> list[list[float]]:
    """Embed a batch. Returns vectors in the same order as `texts`.

    Width is verified per model rather than assumed: storing a 3072-wide vector
    in a 768-wide column is refused by Postgres, but a model that quietly
    truncates would corrupt search instead. Either way the model that misbehaved
    is named.
    """
    if not texts:
        return []

    failures: list[str] = []
    for candidate in await _embed_candidates(api_key, budget):
        try:
            vectors = await _embed_batch(api_key, candidate, texts, budget, dimensions)
        except GeminiError as err:
            failures.append(f"{candidate.name}: {err}")
            continue

        widths = sorted({len(vector) for vector in vectors})
        if widths != [dimensions]:
            failures.append(
                f"{candidate.name}: returned {'/'.join(str(w) for w in widths)} dimensions, "
                f"expected {dimensions}"
            )
            continue
        return vectors

    raise GeminiError("No Gemini embedding model could embed the text.\n" + "\n".join(failures))
