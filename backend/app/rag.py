"""The grounding contract for "Ask your material".

Retrieval is only half of RAG; the other half is refusing to answer from
anything but the retrieved passages. The prompt below is deliberately blunt
about that, because a model that invents a policy clause is worse than one that
says it does not know.
"""

from __future__ import annotations

# Returned verbatim when nothing in the officer's own materials matched, so the
# answer never depends on a model having been called at all.
NO_MATCH_ANSWER = (
    "I could not find this in your materials. (No indexed passages matched — try indexing "
    "the material first with the \"Index for Q&A\" button, or ask about something the "
    "documents cover.)"
)

MAX_QUESTION_CHARS = 500
TOP_K = 5

_SYSTEM = """You are a research assistant for officers at India's Ministry of Statistics and Programme Implementation (MoSPI).

Answer the QUESTION using ONLY the CONTEXT passages below, which come from the officer's own uploaded training materials.

Rules:
- If the context does not contain the answer, say exactly: "I could not find this in your materials." — and suggest what kind of document might cover it.
- Cite which passage(s) support the answer, like [Source 1], [Source 2].
- Be concise: 2-5 sentences unless a list is genuinely needed.
- Do not invent facts, numbers, or policy names."""


def build_answer_prompt(question: str, contexts: list[str]) -> str:
    numbered = "\n\n".join(
        f"[Source {i + 1}]\n{content}" for i, content in enumerate(contexts)
    )
    return f"{_SYSTEM}\n\nCONTEXT:\n{numbered}\n\nQUESTION: {question}"
