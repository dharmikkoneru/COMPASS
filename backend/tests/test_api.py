"""Endpoint contracts.

These lock the JSON the frontend reads. The point is that switching the AI
transport from the Supabase edge functions to this service must be invisible to
the UI — so the assertions are on exact field names and shapes, not just status
codes. Gemini and PostgREST are faked; nothing here touches the network.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.auth import CurrentUser
from app.chunking import chunk_text
from app.config import reset_settings_cache
from app.main import app
from app.routers import ai
from app.supabase import PostgrestError

AUTH = {"Authorization": "Bearer test-token"}


def a_question(text: str = "What is a sampling frame?") -> dict[str, Any]:
    return {
        "text": text,
        "options": ["a", "b", "c", "d"],
        "correct_idx": 1,
        "explanation": "The material defines it in section 2.",
        "competency_tag": "Sampling Techniques",
        "difficulty": "medium",
    }


class FakeDb:
    """Stands in for Postgrest, recording what the route tried to do."""

    def __init__(
        self,
        *,
        material: dict[str, Any] | None = None,
        quiz: dict[str, Any] | None = None,
        rpc_rows: list[dict[str, Any]] | None = None,
        materials: list[dict[str, Any]] | None = None,
        fail_insert: str | None = None,
    ) -> None:
        self.material = material
        self.quiz = (
            quiz if quiz is not None else {"id": "quiz-1", "title": "T", "question_count": 1}
        )
        self.rpc_rows = rpc_rows or []
        self.materials = materials or []
        self.fail_insert = fail_insert
        self.rpc_call: tuple[str, dict[str, Any]] | None = None
        self.inserted: dict[str, Any] | None = None
        self.rows: list[dict[str, Any]] = []
        self.deleted: list[tuple[str, dict[str, Any]]] = []
        self.patched: tuple[str, dict[str, Any]] | None = None

    async def __aenter__(self) -> FakeDb:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def select_one(self, table: str, columns: str, filters: dict[str, Any]) -> Any:
        return self.material

    async def select_in(self, *_: Any, **__: Any) -> list[dict[str, Any]]:
        return self.materials

    async def insert_one(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        self.inserted = row
        return self.quiz

    async def insert(self, table: str, rows: list[dict[str, Any]]) -> None:
        if self.fail_insert == table:
            raise PostgrestError(
                'new row violates row-level security policy for table "questions"', code="42501"
            )
        self.rows = rows

    async def delete(self, table: str, filters: dict[str, Any]) -> None:
        self.deleted.append((table, filters))

    async def patch(self, table: str, values: dict[str, Any], filters: dict[str, Any]) -> None:
        self.patched = (table, values)

    async def rpc(self, function: str, args: dict[str, Any]) -> list[dict[str, Any]]:
        self.rpc_call = (function, args)
        return self.rpc_rows


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def as_officer():
    """Bypass token verification; the auth tests cover that separately."""
    app.dependency_overrides[ai.current_user] = lambda: CurrentUser(
        id="user-1", token="test-token", email="officer@gov.in"
    )
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def use_db(monkeypatch: pytest.MonkeyPatch):
    """Install a FakeDb as the route's database."""

    def install(db: FakeDb) -> FakeDb:
        monkeypatch.setattr(ai, "Postgrest", lambda *_, **__: db)
        return db

    return install


# ── Health and auth ───────────────────────────────────────────────


def test_health_reports_configuration_without_leaking_values(client: TestClient) -> None:
    body = client.get("/healthz").json()
    assert body["status"] == "ok"
    assert body["service"] == "compass-api"
    assert body["configured"] is True


def test_an_unauthenticated_request_is_401_with_a_sentence(client: TestClient) -> None:
    res = client.post("/api/ai/ask-material", json={"question": "hi"})
    assert res.status_code == 401
    assert res.json() == {"error": "Not authenticated"}


def test_a_missing_gemini_key_names_the_variable(
    client: TestClient, as_officer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("GEMINI_API_KEY")
    reset_settings_cache()

    res = client.post("/api/ai/ask-material", json={"question": "hi"}, headers=AUTH)
    assert res.status_code == 500
    assert "GEMINI_API_KEY" in res.json()["error"]


def test_a_bad_body_comes_back_as_a_readable_sentence(client: TestClient, as_officer) -> None:
    res = client.post(
        "/api/ai/generate-quiz", json={"materialId": "m1", "count": 0}, headers=AUTH
    )
    assert res.status_code == 422
    # FastAPI's own error shape would be {"detail": [...]}; the frontend needs
    # the same {"error": "..."} the edge functions produce.
    assert "count" in res.json()["error"]


# ── ask-material ──────────────────────────────────────────────────


def test_ask_material_returns_the_answer_with_cited_sources(
    client: TestClient, as_officer, use_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = use_db(
        FakeDb(
            rpc_rows=[
                {
                    "chunk_id": "c1",
                    "material_id": "m1",
                    "chunk_index": 3,
                    "content": "CPI is computed from a basket of goods.",
                    "similarity": 0.812345,
                }
            ],
            materials=[{"id": "m1", "title": "Price Statistics Handbook"}],
        )
    )

    async def fake_embed(api_key: str, texts: list[str], *, budget, dimensions: int):
        assert texts == ["How is CPI computed?"]
        assert dimensions == 768
        return [[0.5] * dimensions for _ in texts]

    async def fake_generate(api_key: str, prompt: str, *, budget, temperature: float = 0.2):
        assert "CPI is computed from a basket of goods." in prompt
        return "[Source 1] From a fixed basket of goods.", "gemini-3.6-flash"

    monkeypatch.setattr(ai.gemini, "embed_texts", fake_embed)
    monkeypatch.setattr(ai.gemini, "generate_text", fake_generate)

    res = client.post(
        "/api/ai/ask-material",
        json={"question": "How is CPI computed?", "materialId": "m1"},
        headers=AUTH,
    )

    assert res.status_code == 200
    assert res.json() == {
        "answer": "[Source 1] From a fixed basket of goods.",
        "model": "gemini-3.6-flash",
        "sources": [
            {
                "materialTitle": "Price Statistics Handbook",
                "chunkIndex": 3,
                "content": "CPI is computed from a basket of goods.",
                "similarity": 0.812,
            }
        ],
    }
    assert db.rpc_call is not None
    function, args = db.rpc_call
    assert function == "match_chunks"
    assert args["p_user_id"] == "user-1"
    assert args["p_material_id"] == "m1"
    assert args["match_count"] == 5


def test_ask_material_answers_without_a_model_when_nothing_matched(
    client: TestClient, as_officer, use_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_db(FakeDb(rpc_rows=[]))

    async def fake_embed(api_key: str, texts: list[str], *, budget, dimensions: int):
        return [[0.0] * dimensions for _ in texts]

    async def never_called(*_: Any, **__: Any):  # pragma: no cover - asserted below
        raise AssertionError("the model must not be called when nothing matched")

    monkeypatch.setattr(ai.gemini, "embed_texts", fake_embed)
    monkeypatch.setattr(ai.gemini, "generate_text", never_called)

    body = client.post("/api/ai/ask-material", json={"question": "anything"}, headers=AUTH).json()
    assert body["model"] == "none"
    assert body["sources"] == []
    assert "Index for Q&A" in body["answer"]


def test_ask_material_refuses_an_empty_question(client: TestClient, as_officer, use_db) -> None:
    use_db(FakeDb())
    res = client.post("/api/ai/ask-material", json={"question": "   "}, headers=AUTH)
    assert res.status_code == 400
    assert res.json() == {"error": "Ask a question first"}


# ── embed-material ────────────────────────────────────────────────


def test_embed_material_indexes_every_chunk(
    client: TestClient, as_officer, use_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    text = "statistics " * 200
    db = use_db(FakeDb(material={"id": "m1", "raw_text": text}))

    async def fake_embed(api_key: str, texts: list[str], *, budget, dimensions: int):
        return [[0.1] * dimensions for _ in texts]

    monkeypatch.setattr(ai.gemini, "embed_texts", fake_embed)

    body = client.post("/api/ai/embed-material", json={"materialId": "m1"}, headers=AUTH).json()

    expected = len(chunk_text(text))
    assert body == {"materialId": "m1", "chunks": expected, "dims": 768}
    # Re-indexing must clear the previous index first, or chunk indexes collide.
    assert ("material_chunks", {"material_id": "m1"}) in db.deleted
    assert len(db.rows) == expected
    assert [row["chunk_index"] for row in db.rows] == list(range(expected))
    assert db.rows[0]["user_id"] == "user-1"
    assert db.rows[0]["embedding"] == [0.1] * 768
    assert db.patched == ("materials", {"status": "ready"})


def test_embed_material_refuses_text_with_nothing_to_index(
    client: TestClient, as_officer, use_db
) -> None:
    use_db(FakeDb(material={"id": "m1", "raw_text": "   "}))
    res = client.post("/api/ai/embed-material", json={"materialId": "m1"}, headers=AUTH)
    assert res.status_code == 400
    assert "no text content" in res.json()["error"]


def test_a_material_the_officer_cannot_see_is_a_404(
    client: TestClient, as_officer, use_db
) -> None:
    # RLS returns no row rather than a permission error, so "not found" is the
    # honest answer — and it does not reveal that the row exists.
    use_db(FakeDb(material=None))
    res = client.post("/api/ai/embed-material", json={"materialId": "someone-elses"}, headers=AUTH)
    assert res.status_code == 404
    assert res.json() == {"error": "Material not found"}


# ── generate-quiz ─────────────────────────────────────────────────


def test_generate_quiz_stores_the_quiz_and_its_questions(
    client: TestClient, as_officer, use_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = use_db(
        FakeDb(
            material={"id": "m1", "title": "Handbook", "raw_text": "material text"},
            quiz={"id": "quiz-1", "title": "Sampling", "question_count": 2},
        )
    )

    async def fake_generate_json(api_key: str, prompt: str, *, schema, budget):
        assert schema["required"] == ["title", "difficulty", "questions"]
        return (
            {
                "title": "Sampling",
                "difficulty": "hard",
                "questions": [a_question("one"), a_question("two")],
            },
            "gemini-3.6-flash",
        )

    monkeypatch.setattr(ai.gemini, "generate_json", fake_generate_json)

    res = client.post(
        "/api/ai/generate-quiz",
        json={"materialId": "m1", "difficulty": "medium", "count": 2},
        headers=AUTH,
    )

    assert res.status_code == 200
    assert res.json() == {"id": "quiz-1", "title": "Sampling", "question_count": 2}
    assert db.inserted is not None
    assert db.inserted["created_by"] == "user-1"
    assert db.inserted["question_count"] == 2
    # The model's own difficulty is honoured when it is one of the three valid ones.
    assert db.inserted["difficulty"] == "hard"
    assert [row["idx"] for row in db.rows] == [0, 1]
    assert db.rows[0]["quiz_id"] == "quiz-1"


def test_an_empty_quiz_row_is_rolled_back_when_questions_fail(
    client: TestClient, as_officer, use_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = use_db(
        FakeDb(
            material={"id": "m1", "title": "Handbook", "raw_text": "material text"},
            quiz={"id": "quiz-1"},
            fail_insert="questions",
        )
    )

    async def fake_generate_json(api_key: str, prompt: str, *, schema, budget):
        return ({"title": "T", "difficulty": "easy", "questions": [a_question()]}, "m")

    monkeypatch.setattr(ai.gemini, "generate_json", fake_generate_json)

    res = client.post("/api/ai/generate-quiz", json={"materialId": "m1"}, headers=AUTH)

    assert res.status_code == 500
    # Leaving the quiz row behind shows the officer an empty quiz, so it must go.
    assert ("quizzes", {"id": "quiz-1"}) in db.deleted
    assert "0003_questions_insert_policy.sql" in res.json()["error"]


def test_an_unusable_ai_response_is_explained(
    client: TestClient, as_officer, use_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_db(FakeDb(material={"id": "m1", "title": "Handbook", "raw_text": "text"}))

    async def fake_generate_json(*_: Any, **__: Any):
        return ({"title": "T", "questions": [{"text": "broken"}]}, "m")

    monkeypatch.setattr(ai.gemini, "generate_json", fake_generate_json)

    res = client.post("/api/ai/generate-quiz", json={"materialId": "m1"}, headers=AUTH)
    assert res.status_code == 500
    assert "unusable quiz" in res.json()["error"]


# ── the models diagnostic ─────────────────────────────────────────


def test_models_lists_what_the_key_can_call(
    client: TestClient, as_officer, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_list_models(api_key: str, budget) -> list[dict[str, Any]]:
        return [
            {"name": "models/gemini-3.6-flash", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-embedding-001", "supportedGenerationMethods": ["embedContent"]},
        ]

    monkeypatch.setattr(ai.gemini, "list_models", fake_list_models)

    body = client.get("/api/ai/models", headers=AUTH).json()
    assert body["generate"][0] == "gemini-3.6-flash"
    assert "gemini-embedding-001" in body["embed"]
    assert body["embeddingDimensions"] == 768


# ── database error translation ────────────────────────────────────


def test_an_rls_refusal_names_the_migration() -> None:
    message = ai.write_error_message(
        PostgrestError(
            'new row violates row-level security policy for table "questions"', code="42501"
        )
    )
    assert "0003_questions_insert_policy.sql" in message


def test_a_plain_database_error_keeps_its_message() -> None:
    assert ai.write_error_message(PostgrestError("connection refused")) == "connection refused"
