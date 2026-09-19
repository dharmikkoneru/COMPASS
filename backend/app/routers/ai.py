"""The AI endpoints.

Three routes, matching the Supabase edge functions field for field so the
frontend can switch between them without noticing:

    POST /api/ai/generate-quiz    {materialId, difficulty, count} -> the quizzes row
    POST /api/ai/embed-material   {materialId}                    -> {chunks, dims}
    POST /api/ai/ask-material     {question, materialId?}         -> {answer, sources, model}

Plus GET /api/ai/models, a diagnostic that reports which Gemini models this
key can actually call — the fastest way to answer "why did generation break
today?" when Google retires a model.

Every database call goes through a client holding the officer's own token, so
RLS decides what is readable and writable here exactly as in the browser.
"""

from __future__ import annotations

import contextlib
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field

from .. import gemini
from ..auth import AuthError, CurrentUser, verify_token
from ..chunking import EMBED_BATCH, batches, chunk_text
from ..errors import AiError, require_settings
from ..gemini import MIN_ATTEMPT_SECONDS, Budget, GeminiError
from ..quiz import DIFFICULTIES, RESPONSE_SCHEMA, build_prompt, validate_questions
from ..rag import MAX_QUESTION_CHARS, NO_MATCH_ANSWER, TOP_K, build_answer_prompt
from ..supabase import Postgrest, PostgrestError

router = APIRouter(prefix="/api/ai", tags=["ai"])


# ── Requests ──────────────────────────────────────────────────────


class _CamelModel(BaseModel):
    # The browser sends camelCase; snake_case is accepted too so the API is
    # pleasant to call by hand.
    model_config = ConfigDict(populate_by_name=True)


class QuizRequest(_CamelModel):
    material_id: str = Field(alias="materialId")
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    count: int = Field(default=5, ge=1, le=15)


class EmbedRequest(_CamelModel):
    material_id: str = Field(alias="materialId")


class AskRequest(_CamelModel):
    question: str
    material_id: str | None = Field(default=None, alias="materialId")


# ── Dependencies ──────────────────────────────────────────────────


async def current_user(authorization: Annotated[str | None, Header()] = None) -> CurrentUser:
    """Verify the bearer token, or refuse with 401.

    Verification is against the project's published JWKS (ES256), so no shared
    secret exists to leak; the token is then reused for the database calls so
    RLS sees the same identity the browser would.
    """
    settings = require_settings()
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AiError("Not authenticated", 401)

    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = await verify_token(token, settings)
    except AuthError as err:
        raise AiError(f"Not authenticated: {err}", 401) from err

    return CurrentUser(id=str(claims.get("sub", "")), token=token, email=claims.get("email"))


User = Annotated[CurrentUser, Depends(current_user)]


# ── Helpers ───────────────────────────────────────────────────────


def write_error_message(err: Any) -> str:
    """Make a refused database write actionable.

    PostgREST failures are not exceptions with a stack; they are a sentence, and
    an RLS refusal in particular is worth naming the migration behind.
    """
    if isinstance(err, PostgrestError):
        message = err.message
        if err.code == "42501" or "row-level security" in message.lower():
            return (
                f"{message} — the database is missing a policy from supabase/migrations "
                "(see 0003_questions_insert_policy.sql)."
            )
        return f"{message} ({err.hint})" if err.hint else message
    return str(err) or "unknown database error"


async def load_material(db: Postgrest, material_id: str, columns: str) -> dict[str, Any]:
    """The officer's own material, or a 404 that says so.

    A PGRST116 ("no row") means not found; anything else — a permission or
    schema problem — is shown as itself rather than relabelled.
    """
    try:
        material = await db.select_one("materials", columns, {"id": material_id})
    except PostgrestError as err:
        if err.is_missing_row:
            material = None
        else:
            raise AiError(f"Could not load the material: {write_error_message(err)}", 400) from err

    if material is None:
        raise AiError("Material not found", 404)
    return material


# ── Routes ────────────────────────────────────────────────────────


@router.post("/generate-quiz")
async def generate_quiz(request: QuizRequest, user: User) -> dict[str, Any]:
    settings = require_settings()
    budget = Budget.start()

    async with Postgrest(settings, user.token) as db:
        material = await load_material(db, request.material_id, "id,title,raw_text")

        prompt = build_prompt(material["raw_text"], request.difficulty, request.count)
        try:
            generated, _model = await gemini.generate_json(
                settings.gemini_api_key, prompt, schema=RESPONSE_SCHEMA, budget=budget
            )
        except GeminiError as err:
            raise AiError(str(err), 500) from err

        try:
            questions = validate_questions(generated.get("questions"), request.count)
        except ValueError as err:
            raise AiError(f"The AI returned an unusable quiz: {err}", 500) from err

        generated_difficulty = generated.get("difficulty")
        try:
            quiz = await db.insert_one(
                "quizzes",
                {
                    "material_id": material["id"],
                    "created_by": user.id,
                    "title": str(generated.get("title") or material["title"])[:120],
                    "difficulty": (
                        generated_difficulty
                        if generated_difficulty in DIFFICULTIES
                        else request.difficulty
                    ),
                    "question_count": len(questions),
                },
            )
        except PostgrestError as err:
            raise AiError(write_error_message(err), 500) from err

        rows = [
            {
                "quiz_id": quiz["id"],
                "idx": index,
                "text": question["text"],
                "options": question["options"],
                "correct_idx": question["correct_idx"],
                "explanation": question["explanation"],
                "competency_tag": question["competency_tag"],
                "difficulty": question["difficulty"],
            }
            for index, question in enumerate(questions)
        ]

        try:
            await db.insert("questions", rows)
        except PostgrestError as err:
            # The quiz row is already committed. Leaving it behind shows the
            # officer an empty quiz on the Materials page, so roll it back
            # before reporting the failure. Best effort: if the delete is
            # refused too, the original error is still the useful one.
            rollback = ""
            try:
                await db.delete("quizzes", {"id": quiz["id"]})
            except PostgrestError as rollback_err:
                rollback = (
                    f" (the empty quiz row {quiz['id']} could not be rolled back: "
                    f"{rollback_err.message})"
                )
            raise AiError(write_error_message(err) + rollback, 500) from err

        return quiz


@router.post("/embed-material")
async def embed_material(request: EmbedRequest, user: User) -> dict[str, Any]:
    settings = require_settings()
    budget = Budget.start()

    async with Postgrest(settings, user.token) as db:
        material = await load_material(db, request.material_id, "id,raw_text")

        chunks = chunk_text(material["raw_text"])
        if not chunks:
            raise AiError("Material has no text content to index", 400)

        # Delete-then-insert per material: re-indexing is idempotent with no
        # upsert bookkeeping on (material_id, chunk_index). Note the honest
        # consequence: a failure part-way through leaves the material with a
        # partial index, and pressing Index again rebuilds it from scratch.
        try:
            await db.delete("material_chunks", {"material_id": material["id"]})
        except PostgrestError as err:
            raise AiError(
                f"Could not clear old chunks (is migration 0007 applied?): {err.message}", 400
            ) from err

        done = 0
        for batch in batches(chunks, EMBED_BATCH):
            if budget.remaining() < MIN_ATTEMPT_SECONDS:
                raise AiError(
                    f"Indexing ran out of its time budget after {done}/{len(chunks)} chunks. "
                    "Press Index for Q&A again — it rebuilds from scratch safely.",
                    504,
                )

            try:
                vectors = await gemini.embed_texts(
                    settings.gemini_api_key,
                    batch,
                    budget=budget,
                    dimensions=settings.gemini_embed_dimensions,
                )
            except GeminiError as err:
                raise AiError(str(err), 502) from err

            rows = [
                {
                    "material_id": material["id"],
                    "user_id": user.id,
                    "chunk_index": done + offset,
                    "content": content,
                    # PostgREST accepts a JSON array for a pgvector column.
                    "embedding": vectors[offset],
                }
                for offset, content in enumerate(batch)
            ]
            try:
                await db.insert("material_chunks", rows)
            except PostgrestError as err:
                raise AiError(
                    f"Storing chunks failed (is migration 0007 applied?): {err.message} "
                    "Press Index for Q&A again to rebuild the index.",
                    400,
                ) from err
            done += len(batch)

        # Best effort: stamp the material as indexed so the UI can badge it.
        with contextlib.suppress(PostgrestError):
            await db.patch("materials", {"status": "ready"}, {"id": material["id"]})

        return {
            "materialId": material["id"],
            "chunks": done,
            "dims": settings.gemini_embed_dimensions,
        }


@router.post("/ask-material")
async def ask_material(request: AskRequest, user: User) -> dict[str, Any]:
    settings = require_settings()
    budget = Budget.start()

    question = (request.question or "").strip()
    if not question:
        raise AiError("Ask a question first", 400)
    if len(question) > MAX_QUESTION_CHARS:
        raise AiError(f"Keep the question under {MAX_QUESTION_CHARS} characters", 400)

    async with Postgrest(settings, user.token) as db:
        try:
            [query_vector] = await gemini.embed_texts(
                settings.gemini_api_key,
                [question],
                budget=budget,
                dimensions=settings.gemini_embed_dimensions,
            )
        except GeminiError as err:
            raise AiError(str(err), 502) from err

        try:
            matches = await db.rpc(
                "match_chunks",
                {
                    "query_embedding": query_vector,
                    "p_user_id": user.id,
                    "match_count": TOP_K,
                    "p_material_id": request.material_id,
                },
            )
        except PostgrestError as err:
            raise AiError(
                "Chunk search failed (is migration 0007 applied, and was this material "
                f"indexed?): {err.message}",
                400,
            ) from err

        rows = matches if isinstance(matches, list) else []
        if not rows:
            return {"answer": NO_MATCH_ANSWER, "sources": [], "model": "none"}

        # Material titles make the sources readable; RLS returns only the
        # officer's own rows, so a missing title means "deleted since indexing".
        material_ids = sorted({str(row["material_id"]) for row in rows})
        try:
            materials = await db.select_in("materials", "id,title", "id", material_ids)
        except PostgrestError:
            materials = []
        titles = {str(m["id"]): m.get("title") or "Untitled material" for m in materials}

        try:
            answer, model = await gemini.generate_text(
                settings.gemini_api_key,
                build_answer_prompt(question, [str(row["content"]) for row in rows]),
                budget=budget,
            )
        except GeminiError as err:
            raise AiError(str(err), 500) from err

        return {
            "answer": answer,
            "model": model,
            "sources": [
                {
                    "materialTitle": titles.get(str(row["material_id"]), "Untitled material"),
                    "chunkIndex": row["chunk_index"],
                    "content": row["content"],
                    "similarity": round(float(row["similarity"]), 3),
                }
                for row in rows
            ],
        }


@router.get("/models")
async def available_models(user: User) -> dict[str, Any]:
    """Which Gemini models this key can actually call.

    Google retires models on a rolling basis and the failure arrives as a 404
    from an unrelated-looking place. This route turns "why did it break today?"
    into one request.
    """
    settings = require_settings()
    budget = Budget.start(30)

    try:
        models = await gemini.list_models(settings.gemini_api_key, budget)
    except GeminiError as err:
        raise AiError(str(err), 502) from err

    return {
        "generate": gemini.generate_capable_names(models, exclude=set()) or list(
            gemini.PREFERRED_MODELS
        ),
        "embed": [
            str(model.get("name", "")).removeprefix("models/")
            for model in models
            if "embedding" in str(model.get("name", ""))
        ],
        "embeddingDimensions": settings.gemini_embed_dimensions,
    }
