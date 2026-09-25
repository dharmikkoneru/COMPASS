from __future__ import annotations

import pytest

from app.quiz import (
    COGNITIVE_LEVELS,
    COMPETENCY_TAGS,
    RESPONSE_SCHEMA,
    build_prompt,
    normalize_cognitive_level,
    validate_questions,
)


def question(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "text": "What is a sampling frame?",
        "options": ["a", "b", "c", "d"],
        "correct_idx": 2,
        "explanation": "Because the material says so.",
        "competency_tag": "Sampling Techniques",
        "difficulty": "medium",
        "cognitive_level": "Application",
    }
    base.update(overrides)
    return base


def test_prompt_states_count_material_and_every_tag() -> None:
    prompt = build_prompt("THE MATERIAL TEXT", "hard", 7)
    assert "exactly 7 multiple-choice questions" in prompt
    assert "THE MATERIAL TEXT" in prompt
    assert '"hard"' in prompt
    for tag in COMPETENCY_TAGS:
        assert tag in prompt


def test_a_complete_question_survives() -> None:
    valid = validate_questions([question()], 5)
    assert len(valid) == 1
    assert valid[0]["correct_idx"] == 2
    assert valid[0]["options"] == ["a", "b", "c", "d"]


@pytest.mark.parametrize(
    "broken",
    [
        question(options=["a", "b", "c"]),  # not four options
        question(correct_idx=4),  # answer index outside the options
        question(correct_idx=-1),
        question(explanation=""),  # nothing to review
        question(text=""),
        question(options="not a list"),
        question(correct_idx="two"),
    ],
)
def test_malformed_questions_are_dropped(broken: dict[str, object]) -> None:
    with pytest.raises(ValueError, match="no valid questions"):
        validate_questions([broken], 5)


def test_an_unknown_competency_tag_is_replaced_not_stored() -> None:
    # A tag outside the taxonomy would vanish from every chart, so it becomes
    # the taxonomy's first entry rather than being written as-is.
    valid = validate_questions([question(competency_tag="Astrology")], 5)
    assert valid[0]["competency_tag"] == COMPETENCY_TAGS[0]


def test_an_unknown_difficulty_falls_back_to_medium() -> None:
    valid = validate_questions([question(difficulty="impossible")], 5)
    assert valid[0]["difficulty"] == "medium"


def test_results_are_capped_at_the_requested_count() -> None:
    valid = validate_questions([question(text=f"q{i}") for i in range(10)], 3)
    assert [q["text"] for q in valid] == ["q0", "q1", "q2"]


def test_a_non_list_payload_is_refused() -> None:
    with pytest.raises(ValueError, match="no questions array"):
        validate_questions({"questions": []}, 5)


def test_the_schema_requires_a_cognitive_level_from_the_enum() -> None:
    # The database's check constraint (0013) allows only these three, so the
    # request schema has to constrain the model to the same three.
    item = RESPONSE_SCHEMA["properties"]["questions"]["items"]
    assert item["properties"]["cognitive_level"]["enum"] == list(COGNITIVE_LEVELS)
    assert "cognitive_level" in item["required"]


def test_the_prompt_asks_for_a_cognitive_level() -> None:
    prompt = build_prompt("THE MATERIAL TEXT", "hard", 7)
    for level in COGNITIVE_LEVELS:
        assert f'"{level}"' in prompt


def test_a_cognitive_level_survives_validation() -> None:
    valid = validate_questions([question(cognitive_level="Analysis")], 5)
    assert valid[0]["cognitive_level"] == "Analysis"


def test_a_misspelled_level_is_normalised_not_dropped() -> None:
    valid = validate_questions([question(cognitive_level="  analysis ")], 5)
    assert valid[0]["cognitive_level"] == "Analysis"


def test_an_invented_level_becomes_null_rather_than_a_guess() -> None:
    # "Evaluation" is Bloom but outside the taxonomy the database accepts; the
    # UI shows no chip instead of mislabelling the question.
    valid = validate_questions([question(cognitive_level="Evaluation")], 5)
    assert valid[0]["cognitive_level"] is None


def test_a_missing_level_is_null_not_a_default() -> None:
    valid = validate_questions([question(cognitive_level=None)], 5)
    assert valid[0]["cognitive_level"] is None


@pytest.mark.parametrize("raw", ["Recall", "recall", " ANALYSIS ", None, "Synthesis", 7])
def test_normalize_cognitive_level(raw: object) -> None:
    assert normalize_cognitive_level(raw) in (*COGNITIVE_LEVELS, None)
