from __future__ import annotations

from app.rag import NO_MATCH_ANSWER, build_answer_prompt


def test_prompt_numbers_the_passages_and_keeps_the_question() -> None:
    prompt = build_answer_prompt("How is CPI computed?", ["first passage", "second passage"])
    assert "[Source 1]\nfirst passage" in prompt
    assert "[Source 2]\nsecond passage" in prompt
    assert prompt.rstrip().endswith("QUESTION: How is CPI computed?")


def test_prompt_requires_refusing_to_invent_an_answer() -> None:
    prompt = build_answer_prompt("anything", ["context"])
    assert "ONLY the CONTEXT" in prompt
    assert "I could not find this in your materials." in prompt


def test_no_match_answer_points_at_the_fix() -> None:
    assert "Index for Q&A" in NO_MATCH_ANSWER
