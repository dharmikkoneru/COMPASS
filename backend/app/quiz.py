"""The quiz contract: prompt, response schema, and validation.

A port of the edge function's logic, kept byte-compatible on purpose — the
frontend reads `quizzes` rows and question fields directly, so the two
implementations must agree on every name.

The tag list below is the single source of truth in the app
(`src/lib/competencies.ts`); question tags, mastery rows, iGOT course tags and
the dashboard radar all key off it. A tag outside this list is replaced rather
than stored, because an unknown tag would silently vanish from every chart.
"""

from __future__ import annotations

from typing import Any

COMPETENCY_TAGS: tuple[str, ...] = (
    "Survey Methodology",
    "Sampling Techniques",
    "Data Collection & Field Ops",
    "Data Quality & Validation",
    "Statistical Computing",
    "Data Indexing & Storage",
    "Official Statistics & Indicators",
    "Data Governance & Privacy",
)

DIFFICULTIES = ("easy", "medium", "hard")

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "title": {"type": "STRING"},
        "difficulty": {"type": "STRING", "enum": list(DIFFICULTIES)},
        "questions": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "text": {"type": "STRING"},
                    "options": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "correct_idx": {"type": "INTEGER"},
                    "explanation": {"type": "STRING"},
                    "competency_tag": {"type": "STRING", "enum": list(COMPETENCY_TAGS)},
                    "difficulty": {"type": "STRING", "enum": list(DIFFICULTIES)},
                },
                "required": [
                    "text",
                    "options",
                    "correct_idx",
                    "explanation",
                    "competency_tag",
                    "difficulty",
                ],
            },
        },
    },
    "required": ["title", "difficulty", "questions"],
}


def build_prompt(material_text: str, difficulty: str, count: int) -> str:
    tags = ", ".join(f'"{tag}"' for tag in COMPETENCY_TAGS)
    return f"""You are an assessment designer for India's Ministry of Statistics and Programme Implementation (MoSPI).

Create exactly {count} multiple-choice questions from the LEARNING MATERIAL below.

Rules:
- Every question must be answerable strictly from the material. Do not invent facts.
- Each question has exactly 4 options and exactly one correct option (correct_idx is 0-based).
- Tag each question with the single most relevant competency from this list:
  {tags}
- Overall difficulty target: "{difficulty}". Individual question difficulty must also be one of easy/medium/hard.
- Include a one-paragraph explanation citing the part of the material that justifies the answer.
- Write in clear professional English suitable for serving officers.
- Give the quiz a short descriptive title mentioning the material's topic.

Return ONLY JSON matching the provided schema.

LEARNING MATERIAL:
\"\"\"
{material_text}
\"\"\""""


def validate_questions(questions: Any, count: int) -> list[dict[str, Any]]:
    """Keep only well-formed questions, up to `count` of them.

    A model that returns a question with three options or an out-of-range answer
    index would otherwise store a question nobody can answer correctly.
    """
    if not isinstance(questions, list):
        raise ValueError("AI returned no questions array")

    valid: list[dict[str, Any]] = []
    for question in questions:
        if not isinstance(question, dict):
            continue
        options = question.get("options")
        options = [str(o) for o in options] if isinstance(options, list) else []
        try:
            correct = int(question.get("correct_idx"))
        except (TypeError, ValueError):
            continue

        text = question.get("text")
        explanation = question.get("explanation")
        if text and options and len(options) == 4 and 0 <= correct < 4 and explanation:
            tag = str(question.get("competency_tag"))
            difficulty = question.get("difficulty")
            valid.append(
                {
                    "text": str(text),
                    "options": options,
                    "correct_idx": correct,
                    "explanation": str(explanation),
                    "competency_tag": tag if tag in COMPETENCY_TAGS else COMPETENCY_TAGS[0],
                    "difficulty": difficulty if difficulty in DIFFICULTIES else "medium",
                }
            )
        if len(valid) >= count:
            break

    if not valid:
        raise ValueError("AI returned no valid questions")
    return valid
