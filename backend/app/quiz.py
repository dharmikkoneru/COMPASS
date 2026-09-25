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

# Cognitive demand, Bloom-style. Orthogonal to difficulty: difficulty is how
# deeply the material has to be known, the level is what kind of thinking the
# question asks for. Kept identical to the edge function's list and to migration
# 0013's check constraint — an unlisted value would be refused by the database.
COGNITIVE_LEVELS: tuple[str, ...] = ("Recall", "Application", "Analysis")

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
                    "cognitive_level": {"type": "STRING", "enum": list(COGNITIVE_LEVELS)},
                },
                "required": [
                    "text",
                    "options",
                    "correct_idx",
                    "explanation",
                    "competency_tag",
                    "difficulty",
                    "cognitive_level",
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

Every question must be a SCENARIO: a short workplace situation an officer would actually face, followed by a decision to make.

Scenario rules (this is what the assessment measures):
- Open with a concrete situation — a field team reports a problem, a supervisor questions submitted data, an estimate looks wrong, a release deadline slips, a questionnaire comes back incomplete.
- Ask what the officer should do, check, decide or conclude — or which reading of the situation is correct.
- The situation and the correct action must both come from the material. Use its actual methods, definitions and figures; invent no procedure, number or policy it does not state.
- No definitional or recall questions ("What is X?", "Which of the following is a dimension of…"). Test what the officer does with the knowledge, not recital of it.
- Wrong options must be plausible mistakes an officer could make — the wrong method applied, a validation step skipped, an indicator misread — never filler.

Rules:
- Every question must be answerable strictly from the material. Do not invent facts.
- Each question has exactly 4 options and exactly one correct option (correct_idx is 0-based).
- Tag each question with the single most relevant competency from this list:
  {tags}
- Overall difficulty target: "{difficulty}". Individual question difficulty must also be one of easy/medium/hard.
- Tag each question with the cognitive level it actually demands:
  "Recall" when the material states the rule or figure and the officer must recognise it,
  "Application" when a fact from the material has to be applied to a situation other than the one it was stated in, or
  "Analysis" when the officer must compare parts of the material, diagnose a cause, or infer a conclusion.
  Be strict: most scenario questions are "Application", and "Analysis" is earned only when more than one part of the material has to be weighed.
- Include a one-paragraph explanation: which part of the material justifies the correct action, and why the most tempting wrong option fails.
- Write in clear professional English suitable for serving officers.
- Give the quiz a short descriptive title mentioning the material's topic.

Return ONLY JSON matching the provided schema.

LEARNING MATERIAL:
\"\"\"
{material_text}
\"\"\""""


def normalize_cognitive_level(value: Any) -> str | None:
    """The canonical level name, or None when the model supplied no usable one.

    Case-insensitive because a model occasionally ignores an enum's spelling
    while still answering correctly; dropping "application" as unknown would
    hide a tag that is right. None is the honest answer for anything else — the
    UI shows no chip rather than inventing a level for the question.
    """
    text = str(value or "").strip().lower()
    for level in COGNITIVE_LEVELS:
        if text == level.lower():
            return level
    return None


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
                    "cognitive_level": normalize_cognitive_level(question.get("cognitive_level")),
                }
            )
        if len(valid) >= count:
            break

    if not valid:
        raise ValueError("AI returned no valid questions")
    return valid
