"""The COMPASS API application.

Deployed on Render as a Web Service; the frontend reaches it through
`VITE_API_BASE_URL`. Its only job is AI: quiz generation and retrieval-augmented
answers over the officer's own materials. Data, auth and storage stay in
Supabase, which is why nothing here holds a service-role key.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__, gemini
from .config import get_settings
from .errors import AiError
from .routers import ai


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await gemini.aclose()


app = FastAPI(
    title="COMPASS API",
    version=__version__,
    description="AI services for the COMPASS competency platform (MoSPI / SIH26101).",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    # Read at startup from ALLOWED_ORIGINS. The Netlify origin stays listed
    # while Vercel becomes primary, so neither deployment breaks in between.
    allow_origins=get_settings().origins,
    # The browser sends an explicit Authorization header rather than cookies.
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "apikey", "x-client-info"],
)

app.include_router(ai.router)


@app.exception_handler(AiError)
async def handle_ai_error(_: Request, exc: AiError) -> JSONResponse:
    """Answer the way the edge functions do: {"error": "..."} plus a status.

    The frontend already renders that field, so a failure here reads as a
    sentence on the Materials page instead of "non-2xx status code".
    """
    return JSONResponse({"error": exc.message}, status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    reasons = []
    for error in exc.errors():
        where = ".".join(str(part) for part in error.get("loc", ()) if part != "body")
        reasons.append(f"{where} {error.get('msg', 'is not valid')}".strip())
    return JSONResponse(
        {"error": "The COMPASS API rejected the request: " + "; ".join(reasons)}, status_code=422
    )


@app.exception_handler(Exception)
async def handle_unexpected(_: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        {"error": f"The COMPASS API hit an unexpected error: {exc.__class__.__name__}: {exc}"},
        status_code=500,
    )


@app.get("/healthz")
async def healthz() -> dict[str, object]:
    """Liveness probe for Render, and a one-line answer to "is it configured?".

    Reports only whether the variables are present — never their values.
    """
    settings = get_settings()
    return {
        "status": "ok",
        "service": "compass-api",
        "version": __version__,
        "configured": not settings.missing(),
    }
