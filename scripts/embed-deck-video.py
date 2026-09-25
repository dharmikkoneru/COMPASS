"""
Embeds docs/walkthrough-vo.mp4 into slide 6 of COMPASS_final.pptx.

Usage:  python scripts/embed-deck-video.py

`python-pptx` is not a dependency of this project (and F5 in BACKLOG.md records
that deck edits previously had to be done by hand), so the OOXML is written
directly. An embedded video needs four things, and missing any one of them makes
PowerPoint either drop the video silently or offer to "repair" the file:

  1. the video part itself, under ppt/media/
  2. a poster image part — a video is drawn as a picture, with a video
     relationship behind it
  3. three relationships on the slide: video, poster image, and the Microsoft
     media extension that PowerPoint 2010+ actually plays
  4. `<Default Extension="mp4" ContentType="video/mp4"/>` in [Content_Types].xml —
     and it has to go *before* the first `<Override>`, because the part's schema is a
     sequence of Defaults followed by Overrides. Appending it before `</Types>` puts
     it after thirty overrides, which is the kind of thing that makes PowerPoint
     offer to repair the file.

Every other part is copied across byte-for-byte. The finished deck is re-opened,
its slide XML is parsed, and the new relationships are checked against the ids
the slide actually references before this script claims success.

Placement is deliberate: the three reference cards on slide 6 end at y=4137600 and
the "view prototype" link starts at x=4447275, so the video sits in the band to
its left without covering a card, the title or the footer (y=6354762). Resize or
move it in PowerPoint if you would rather it were larger.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECK = os.path.join(ROOT, "COMPASS_final.pptx")
BACKUP = os.path.join(ROOT, "COMPASS_final.pre-video-slide6.pptx")
VIDEO = os.path.join(ROOT, "docs", "walkthrough-vo.mp4")
FFMPEG = os.path.join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg.exe")

SLIDE = "ppt/slides/slide6.xml"
RELS = "ppt/slides/_rels/slide6.xml.rels"
MEDIA_VIDEO = "ppt/media/embedVideo1.mp4"
MEDIA_POSTER = "ppt/media/embedPoster1.png"

# 16:9 at 3.9in x 2.2in (914400 EMU per inch).
OFF_X, OFF_Y = 609600, 4220000
CX, CY = 3600000, 2025000

# Poster frame from the dashboard scene (69-81 s), so the thumbnail shows the
# product rather than repeating the deck's own title card.
POSTER_AT = "70"

R_VIDEO, R_POSTER, R_MEDIA = "rIdVideo1", "rIdPoster1", "rIdMedia1"
SHAPE_ID = "900"

PIC = (
    f'<p:pic><p:nvPicPr><p:cNvPr id="{SHAPE_ID}" name="COMPASS walkthrough (2:18)">'
    f'<a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr>'
    f'<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>'
    f'<p:nvPr><a:videoFile r:link="{R_VIDEO}"/><p:extLst>'
    f'<p:ext uri="{{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}}">'
    f'<p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" '
    f'r:embed="{R_MEDIA}"/></p:ext></p:extLst></p:nvPr></p:nvPicPr>'
    f'<p:blipFill><a:blip r:embed="{R_POSTER}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
    f'<p:spPr><a:xfrm><a:off x="{OFF_X}" y="{OFF_Y}"/><a:ext cx="{CX}" cy="{CY}"/></a:xfrm>'
    f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
)

REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NEW_RELS = (
    f'<Relationship Id="{R_VIDEO}" Type="{REL_NS}/video" '
    f'Target="../media/{os.path.basename(MEDIA_VIDEO)}"/>'
    f'<Relationship Id="{R_POSTER}" Type="{REL_NS}/image" '
    f'Target="../media/{os.path.basename(MEDIA_POSTER)}"/>'
    f'<Relationship Id="{R_MEDIA}" '
    f'Type="http://schemas.microsoft.com/office/2007/relationships/media" '
    f'Target="../media/{os.path.basename(MEDIA_VIDEO)}"/>'
)


def fail(message):
    raise SystemExit(message)


def make_poster(target):
    subprocess.run(
        [FFMPEG, "-y", "-v", "error", "-ss", POSTER_AT, "-i", VIDEO,
         "-frames:v", "1", target],
        check=True,
    )
    return target


def main():
    if not os.path.exists(VIDEO):
        fail(f"{VIDEO} is missing — run scripts/make_voiceover.py first")

    workdir = tempfile.mkdtemp(prefix="compass-deck-")
    poster = make_poster(os.path.join(workdir, "poster.png"))
    print(f"poster frame at t={POSTER_AT}s -> {os.path.getsize(poster) // 1024} KB")

    shutil.copy2(DECK, BACKUP)
    print(f"backup -> {os.path.basename(BACKUP)}")

    with zipfile.ZipFile(DECK) as archive:
        entries = [(info, archive.read(info.filename)) for info in archive.infolist()]
    names = {info.filename for info, _ in entries}
    for part in (MEDIA_VIDEO, MEDIA_POSTER):
        if part in names:
            fail(f"{part} already exists in the deck")

    rewritten = []
    for info, data in entries:
        if info.filename == "[Content_Types].xml":
            xml = data.decode("utf-8")
            if 'Extension="png"' not in xml:
                fail("[Content_Types].xml has no png default; guessing one is not safe")
            if 'Extension="mp4"' not in xml:
                entry = '<Default Extension="mp4" ContentType="video/mp4"/>'
                first_override = xml.find("<Override")
                if first_override == -1:
                    xml = xml.replace("</Types>", entry + "</Types>")
                else:
                    xml = xml[:first_override] + entry + xml[first_override:]
            data = xml.encode("utf-8")
        elif info.filename == RELS:
            xml = data.decode("utf-8")
            if "</Relationships>" not in xml:
                fail(f"{RELS} is not a relationships part")
            for rid in (R_VIDEO, R_POSTER, R_MEDIA):
                if f'Id="{rid}"' in xml:
                    fail(f"{RELS} already defines {rid}")
            data = xml.replace("</Relationships>", NEW_RELS + "</Relationships>").encode("utf-8")
        elif info.filename == SLIDE:
            xml = data.decode("utf-8")
            if "</p:spTree>" not in xml:
                fail(f"{SLIDE} has no shape tree")
            if "xmlns:r=" not in xml.split(">", 2)[1]:
                fail(f"{SLIDE} does not declare the relationships namespace")
            if f'id="{SHAPE_ID}"' in xml:
                fail(f"shape id {SHAPE_ID} is already in use on slide 6")
            data = xml.replace("</p:spTree>", PIC + "</p:spTree>").encode("utf-8")
        rewritten.append((info, data))

    with zipfile.ZipFile(DECK, "w", zipfile.ZIP_DEFLATED) as archive:
        for info, data in rewritten:
            archive.writestr(info, data)
        # The two new parts, under names no existing entry uses.
        with open(VIDEO, "rb") as video:
            archive.writestr(MEDIA_VIDEO, video.read())
        with open(poster, "rb") as image:
            archive.writestr(MEDIA_POSTER, image.read())

    with zipfile.ZipFile(DECK) as archive:
        if archive.testzip() is not None:
            fail("the finished archive is corrupt")
        present = set(archive.namelist())
        for part in (MEDIA_VIDEO, MEDIA_POSTER):
            if part not in present:
                fail(f"{part} was not written")
        slide_xml = archive.read(SLIDE).decode("utf-8")
        ET.fromstring(slide_xml)  # a real parse, not a regex
        rels = archive.read(RELS).decode("utf-8")
        types = archive.read("[Content_Types].xml").decode("utf-8")

    referenced = set(re.findall(r'r:(?:link|embed)="([^"]+)"', slide_xml))
    for rid in (R_VIDEO, R_POSTER, R_MEDIA):
        if rid not in referenced:
            fail(f"{rid} is declared but never referenced by the slide")
        if f'Id="{rid}"' not in rels:
            fail(f"{rid} is referenced by the slide but not declared")
    if 'Extension="mp4"' not in types:
        fail("the mp4 content type was not added")
    # The schema is Defaults then Overrides; a Default after an Override is what
    # makes PowerPoint offer to repair an otherwise valid file.
    first_override = types.find("<Override")
    if first_override != -1 and types.find('Extension="mp4"') > first_override:
        fail("the mp4 Default landed after an Override — the content-type order is invalid")

    print(f"embedded {os.path.basename(VIDEO)} at x={OFF_X} y={OFF_Y} cx={CX} cy={CY}")
    print(
        f"deck size: {os.path.getsize(BACKUP) // 1024} KB -> "
        f"{os.path.getsize(DECK) // 1024} KB"
    )
    print("verified: parts present, relationships consistent, slide XML parses")
    print("Open it in PowerPoint to confirm playback before presenting.")


if __name__ == "__main__":
    main()
