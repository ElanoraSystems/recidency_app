"""Renders the Jinja2 templates in app/templates/pdf/ to PDF bytes via
WeasyPrint. Kept as one small shared helper so every PDF-generating endpoint
(PO, meal-log invoice, stock-transfer invoice) goes through the same path."""

import base64
from pathlib import Path

from app.services.files import UPLOAD_ROOT

from jinja2 import Environment, FileSystemLoader

from weasyprint import HTML

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "pdf"

_env = Environment(loader=FileSystemLoader(TEMPLATES_DIR))


def render_pdf(template_name: str, context: dict) -> bytes:
    html = _env.get_template(template_name).render(**context)
    return HTML(string=html, base_url=str(TEMPLATES_DIR)).write_pdf()


def logo_data_uri(residence) -> str | None:
    """Inlines the uploaded logo as a base64 data URI — avoids configuring
    WeasyPrint's external-URL fetcher entirely. Reads the database copy, or a
    pre-migration file on disk."""
    if residence is None:
        return None
    if residence.logo_data:
        mime = (residence.logo_content_type or "image/png").split(";")[0]
        return f"data:{mime};base64,{base64.b64encode(bytes(residence.logo_data)).decode('ascii')}"
    if not residence.logo_path:
        return None
    full_path = UPLOAD_ROOT / residence.logo_path
    if not full_path.exists():
        return None
    ext = full_path.suffix.lstrip(".").lower() or "png"
    mime = "jpeg" if ext in ("jpg", "jpeg") else ext
    data = base64.b64encode(full_path.read_bytes()).decode("ascii")
    return f"data:image/{mime};base64,{data}"
