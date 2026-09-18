"""
Adds a voice-over to docs/walkthrough.mp4 -> docs/walkthrough-vo.mp4.

Pipeline:
  1. Synthesize one MP3 per scene with edge-tts (Microsoft neural voices).
  2. Measure each segment's real duration with ffmpeg and FAIL if any
     segment overruns its scene budget (so narration never gets cut off).
  3. Mix all segments at their scene start offsets into one track
     (loudness-normalized, gentle fade-out).
  4. Mux onto the original video with stream copy (video untouched).

Usage:  python scripts/make_voiceover.py
"""

import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG = os.path.join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg.exe")
TMP = os.path.join(ROOT, "scripts", ".vo_tmp")
SRC_VIDEO = os.path.join(ROOT, "docs", "walkthrough.mp4")
OUT_VIDEO = os.path.join(ROOT, "docs", "walkthrough-vo.mp4")
FILTER_SCRIPT = os.path.join(TMP, "filter.txt")
MIX = os.path.join(TMP, "mix.wav")

VOICE = "en-IN-PrabhatNeural"   # confident Indian-English male; swap for en-IN-NeerjaNeural etc.
RATE = "+12%"

# (scene name, start_ms, budget_ms, narration)
SCENES = [
    ("Title",        0,   9000,
     "What if training knew what you've missed? "
     "This is COMPASS. Smart India Hackathon, 2026."),
    ("Problem",      9000,  11000,
     "Thousands of officers train every year. Then they forget it. "
     "Not because they didn't learn — nothing ever told them what to fix next."),
    ("Workflow",     20000, 12000,
     "COMPASS closes that loop. Assess what you know. Diagnose where you're weak. "
     "Train exactly there. A cycle that never stops."),
    ("AI quiz",      32000, 13000,
     "Paste any material. In seconds, Gemini writes a real quiz — tagged by "
     "competency, graded by difficulty, straight from your content. No templates."),
    ("Taking a quiz", 45000, 11000,
     "Every answer is evidence. And when you finish, you don't just get a score — "
     "you get the explanation behind every single question."),
    ("Mastery",      56000, 13000,
     "Here's the engine. A first attempt sets a cautious forty percent. Score full marks, "
     "and mastery lands at sixty-four — exactly as the math demands."),
    ("Dashboard",    69000, 12000,
     "One command dashboard. Overall readiness, open gaps, top strengths — and a live radar "
     "of every competency, sharpening with each attempt."),
    ("iGOT",         81000, 11000,
     "Weaknesses don't just get flagged. They get prescriptions — iGOT courses "
     "ranked against your exact gaps, so training finally points somewhere."),
    ("Heatmap",      92000,  9000,
     "For administrators: a whole department's readiness, every competency, one heat map. "
     "Intuition becomes data."),
    ("Architecture", 101000, 14000,
     "Under the hood: React on Netlify. Supabase with row-level security on every table. "
     "And a Gemini edge function that polices its own time budget — because reliability is a feature."),
    ("Rigor",        115000, 12000,
     "This isn't just a demo. Forty-five passing tests. Self-verifying "
     "migrations. Everything you just saw — verified live, end to end."),
    ("Summary",      127000, 10000,
     "COMPASS. Assess. Diagnose. Train. The platform that makes training stick. Thank you."),
]

TOTAL_MS = 137000  # sum of scene budgets; matches the rendered video length


def run(cmd, **kw):
    p = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if p.returncode != 0:
        raise SystemExit(f"FAILED ({' '.join(map(str, cmd[:4]))}...):\n{p.stderr[-1500:]}")
    return p


def measure_duration(path):
    p = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", p.stderr)
    if not m:
        raise SystemExit(f"Cannot measure {path}: {p.stderr[-500:]}")
    h, mn, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return h * 3600 + mn * 60 + s


def main():
    os.makedirs(TMP, exist_ok=True)
    segs = []

    print(f"Voice: {VOICE} (rate {RATE})")
    for i, (name, start, budget, text) in enumerate(SCENES):
        mp3 = os.path.join(TMP, f"seg{i:02d}.mp3")
        run([sys.executable, "-m", "edge_tts", "-v", VOICE, f"--rate={RATE}",
             "-t", text, "--write-media", mp3])
        dur = measure_duration(mp3)
        slack = budget / 1000 - dur
        flag = "OK " if slack >= 0.4 else "TIGHT"
        print(f"  {name:<14} {dur:5.1f}s of {budget/1000:4.1f}s  (slack {slack:+.1f}) {flag}")
        if slack < 0.2:
            raise SystemExit(f"Narration for '{name}' overruns its scene — shorten the text.")
        segs.append((start, mp3))

    # filter_complex: resample each segment to 44.1k stereo, delay to its scene start, mix.
    chains, labels = [], []
    for i, (start, _) in enumerate(segs):
        chains.append(
            f"[{i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,"
            f"adelay={start}|{start}[d{i}]")
        labels.append(f"[d{i}]")
    chains.append(
        "".join(labels) +
        f"amix=inputs={len(segs)}:duration=longest:normalize=0,"
        "loudnorm=I=-16:TP=-1.5:LRA=11,"
        f"apad=whole_dur={TOTAL_MS/1000 + 0.5:.1f},"
        f"afade=t=out:st={TOTAL_MS/1000 - 1.5:.1f}:d=1.4[aout]")
    with open(FILTER_SCRIPT, "w") as f:
        f.write(";\n".join(chains))

    print("Mixing audio track...")
    run([FFMPEG, "-y", *sum((["-i", p] for _, p in segs), []),
         "-filter_complex_script", FILTER_SCRIPT, "-map", "[aout]",
         "-ar", "44100", MIX])

    print("Muxing onto video (video stream copied, not re-encoded)...")
    run([FFMPEG, "-y", "-i", SRC_VIDEO, "-i", MIX,
         "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
         "-c:a", "aac", "-b:a", "192k", "-shortest", OUT_VIDEO])

    vd = measure_duration(SRC_VIDEO)
    od = measure_duration(OUT_VIDEO)
    print(f"\nDone: {os.path.relpath(OUT_VIDEO, ROOT)}")
    print(f"  source video {vd:.1f}s -> output {od:.1f}s, "
          f"{os.path.getsize(OUT_VIDEO)/1e6:.1f} MB")


if __name__ == "__main__":
    main()
