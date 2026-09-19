"""Split a material into passages worth embedding.

Size is a compromise: ~700 characters is usually one topic, small enough that a
retrieved passage is about the question asked and not the whole handbook.
Overlap stops a sentence that straddles a boundary from disappearing from both
neighbours.
"""

from __future__ import annotations

import re

CHUNK_CHARS = 700
OVERLAP_CHARS = 120
# One embedding round trip per batch keeps the request count low.
EMBED_BATCH = 32

_WHITESPACE = re.compile(r"\s+")


def chunk_text(text: str) -> list[str]:
    """Whitespace-normalised, overlapping chunks. Empty text yields no chunks."""
    clean = _WHITESPACE.sub(" ", text or "").strip()
    if not clean:
        return []
    if len(clean) <= CHUNK_CHARS:
        return [clean]

    step = CHUNK_CHARS - OVERLAP_CHARS
    chunks: list[str] = []
    for start in range(0, len(clean), step):
        chunks.append(clean[start : start + CHUNK_CHARS])
        if start + CHUNK_CHARS >= len(clean):
            break
    return chunks


def batches(items: list[str], size: int = EMBED_BATCH) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]
