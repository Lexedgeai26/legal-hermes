from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from textwrap import wrap
from typing import Iterable, Literal
from xml.sax.saxutils import escape


DraftExportFormat = Literal["docx", "pdf"]


@dataclass
class MarkdownBlock:
    kind: Literal["heading", "paragraph", "bullet", "numbered", "blank"]
    text: str = ""
    level: int = 0


def _clean_markdown_text(text: str) -> str:
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[*_]{1,3}([^*_]+)[*_]{1,3}", r"\1", text)
    return text.strip()


def parse_markdown_blocks(markdown: str) -> list[MarkdownBlock]:
    blocks: list[MarkdownBlock] = []
    paragraph: list[str] = []

    def flush_paragraph() -> None:
        if paragraph:
            blocks.append(MarkdownBlock("paragraph", _clean_markdown_text(" ".join(paragraph))))
            paragraph.clear()

    for raw_line in markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip()

        if not line:
            flush_paragraph()
            blocks.append(MarkdownBlock("blank"))
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading:
            flush_paragraph()
            blocks.append(MarkdownBlock("heading", _clean_markdown_text(heading.group(2)), len(heading.group(1))))
            continue

        bullet = re.match(r"^[-*+]\s+(.+)$", line)
        if bullet:
            flush_paragraph()
            blocks.append(MarkdownBlock("bullet", _clean_markdown_text(bullet.group(1))))
            continue

        numbered = re.match(r"^\d+[.)]\s+(.+)$", line)
        if numbered:
            flush_paragraph()
            blocks.append(MarkdownBlock("numbered", _clean_markdown_text(numbered.group(1))))
            continue

        paragraph.append(line)

    flush_paragraph()
    return blocks


def export_markdown_draft(source_path: Path, export_format: DraftExportFormat) -> Path:
    source_path = source_path.expanduser().resolve()
    if not source_path.exists():
        raise FileNotFoundError(f"Draft not found: {source_path}")
    if not source_path.is_file():
        raise ValueError("Draft path is not a file")
    if source_path.suffix.lower() not in {".md", ".markdown", ".txt"}:
        raise ValueError("Only Markdown or text drafts can be exported")
    if export_format not in {"docx", "pdf"}:
        raise ValueError("Export format must be 'docx' or 'pdf'")

    markdown = source_path.read_text(encoding="utf-8", errors="replace")
    blocks = parse_markdown_blocks(markdown)
    target = source_path.with_suffix(f".{export_format}")

    if export_format == "docx":
        _write_docx(blocks, target)
    else:
        _write_pdf(blocks, target)

    return target


def _docx_paragraph(block: MarkdownBlock, index: int) -> str:
    text = escape(block.text)

    if block.kind == "blank":
        return "<w:p/>"

    p_style = ""
    prefix = ""
    bold = False

    if block.kind == "heading":
        style = f"Heading{min(max(block.level, 1), 3)}"
        p_style = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>'
        bold = True
    elif block.kind == "bullet":
        prefix = "• "
    elif block.kind == "numbered":
        prefix = f"{index}. "

    run_props = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f"<w:p>{p_style}<w:r>{run_props}<w:t xml:space=\"preserve\">{escape(prefix)}{text}</w:t></w:r></w:p>"


def _write_docx(blocks: Iterable[MarkdownBlock], target: Path) -> None:
    paragraphs: list[str] = []
    numbered_index = 1
    for block in blocks:
        if block.kind == "numbered":
            paragraphs.append(_docx_paragraph(block, numbered_index))
            numbered_index += 1
        else:
            paragraphs.append(_docx_paragraph(block, 0))
            if block.kind != "blank":
                numbered_index = 1

    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {''.join(paragraphs)}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>"""
    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>"""

    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>""")
        docx.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>""")
        docx.writestr("word/_rels/document.xml.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>""")
        docx.writestr("word/document.xml", document_xml)
        docx.writestr("word/styles.xml", styles_xml)


def _pdf_safe(text: str) -> str:
    replacements = {
        "“": '"',
        "”": '"',
        "‘": "'",
        "’": "'",
        "–": "-",
        "—": "-",
        "…": "...",
        "\u00a0": " ",
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    text = text.encode("latin-1", errors="replace").decode("latin-1")
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _pdf_line(text: str, x: int, y: int, size: int, font: str) -> str:
    return f"BT /{font} {size} Tf {x} {y} Td ({_pdf_safe(text)}) Tj ET\n"


def _write_pdf(blocks: Iterable[MarkdownBlock], target: Path) -> None:
    page_width = 612
    page_height = 792
    margin_x = 72
    y_start = 720
    y_min = 72
    content_streams: list[str] = []
    current = ""
    y = y_start
    numbered_index = 1

    def new_page() -> None:
        nonlocal current, y
        if current:
            content_streams.append(current)
        current = ""
        y = y_start

    def write_wrapped(text: str, *, size: int = 11, font: str = "F1", indent: int = 0, gap: int = 7) -> None:
        nonlocal current, y
        max_chars = max(28, int((page_width - margin_x * 2 - indent) / (size * 0.48)))
        for line in wrap(text, width=max_chars, replace_whitespace=False) or [""]:
            if y < y_min:
                new_page()
            current += _pdf_line(line, margin_x + indent, y, size, font)
            y -= size + 5
        y -= gap

    for block in blocks:
        if block.kind == "blank":
            y -= 6
            if y < y_min:
                new_page()
            continue
        if block.kind == "heading":
            size = 18 if block.level == 1 else 15 if block.level == 2 else 13
            write_wrapped(block.text, size=size, font="F2", gap=10)
            numbered_index = 1
        elif block.kind == "bullet":
            write_wrapped(f"- {block.text}", indent=18)
            numbered_index = 1
        elif block.kind == "numbered":
            write_wrapped(f"{numbered_index}. {block.text}", indent=18)
            numbered_index += 1
        else:
            write_wrapped(block.text)
            numbered_index = 1

    if current or not content_streams:
        content_streams.append(current)

    objects: list[bytes] = []

    def add(obj: str | bytes) -> int:
        objects.append(obj.encode("latin-1") if isinstance(obj, str) else obj)
        return len(objects)

    catalog_id = add("<< /Type /Catalog /Pages 2 0 R >>")
    pages_placeholder_id = add("")
    font_regular_id = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    font_bold_id = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
    page_ids: list[int] = []

    for stream in content_streams:
        encoded = stream.encode("latin-1", errors="replace")
        content_id = add(b"<< /Length " + str(len(encoded)).encode("ascii") + b" >>\nstream\n" + encoded + b"endstream")
        page_id = add(
            f"<< /Type /Page /Parent {pages_placeholder_id} 0 R /MediaBox [0 0 {page_width} {page_height}] "
            f"/Resources << /Font << /F1 {font_regular_id} 0 R /F2 {font_bold_id} 0 R >> >> "
            f"/Contents {content_id} 0 R >>"
        )
        page_ids.append(page_id)

    objects[pages_placeholder_id - 1] = (
        f"<< /Type /Pages /Kids [{' '.join(f'{page_id} 0 R' for page_id in page_ids)}] /Count {len(page_ids)} >>"
    ).encode("latin-1")

    pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode("ascii"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")
    xref = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode(
            "ascii"
        )
    )
    target.write_bytes(pdf)
