"""Renders the Jinja2 templates in app/templates/pdf/ to PDF bytes via
WeasyPrint. Kept as one small shared helper so every PDF-generating endpoint
(PO, meal-log invoice, stock-transfer invoice) goes through the same path."""

import base64
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from weasyprint import HTML

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "pdf"
UPLOAD_ROOT = Path(__file__).resolve().parent.parent.parent / "uploads"

_env = Environment(loader=FileSystemLoader(TEMPLATES_DIR))


def render_pdf(template_name: str, context: dict) -> bytes:
    html = _env.get_template(template_name).render(**context)
    return HTML(string=html, base_url=str(TEMPLATES_DIR)).write_pdf()


def logo_data_uri(logo_path: str | None) -> str | None:
    """Reads the uploaded logo off disk and inlines it as a base64 data URI
    — avoids configuring WeasyPrint's external-URL fetcher entirely."""
    if not logo_path:
        return None
    full_path = UPLOAD_ROOT / logo_path
    if not full_path.exists():
        return None
    ext = full_path.suffix.lstrip(".").lower() or "png"
    mime = "jpeg" if ext in ("jpg", "jpeg") else ext
    data = base64.b64encode(full_path.read_bytes()).decode("ascii")
    return f"data:image/{mime};base64,{data}"
