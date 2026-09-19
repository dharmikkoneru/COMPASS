from __future__ import annotations

from app.chunking import CHUNK_CHARS, OVERLAP_CHARS, batches, chunk_text


def test_empty_text_yields_no_chunks() -> None:
    assert chunk_text("") == []
    assert chunk_text("   \n\t ") == []


def test_short_text_is_one_chunk() -> None:
    assert chunk_text("  A short   note\nabout sampling. ") == ["A short note about sampling."]


def test_text_at_the_limit_stays_one_chunk() -> None:
    text = "x" * CHUNK_CHARS
    assert chunk_text(text) == [text]


def test_long_text_is_split_with_overlap_and_loses_nothing() -> None:
    text = "".join(str(i % 10) for i in range(2000))
    chunks = chunk_text(text)

    assert len(chunks) > 1
    assert all(len(chunk) <= CHUNK_CHARS for chunk in chunks)
    # Every chunk after the first re-reads the tail of its predecessor, so a
    # sentence straddling a boundary survives in one of them.
    # strict=False is deliberate: there is one fewer overlap than chunks.
    for previous, current in zip(chunks, chunks[1:], strict=False):
        assert previous[-OVERLAP_CHARS:] == current[:OVERLAP_CHARS]
    # Nothing is dropped between chunks.
    assert text.startswith(chunks[0])
    assert text.endswith(chunks[-1][-OVERLAP_CHARS:])
    assert "".join(chunks[0].split()) == text[: len(chunks[0])]


def test_no_runaway_chunk_when_text_is_just_over_the_limit() -> None:
    chunks = chunk_text("y" * (CHUNK_CHARS + 1))
    assert len(chunks) == 2
    assert chunks[1].endswith("y")


def test_batches_group_in_order() -> None:
    assert batches(["a", "b", "c", "d", "e"], 2) == [["a", "b"], ["c", "d"], ["e"]]
    assert batches([], 3) == []
