FROM python:3.11-slim

# WeasyPrint (PDF generation for invoices/POs) links Pango, Cairo and
# GDK-Pixbuf via GObject introspection — these aren't Python packages, they
# have to come from the OS. Without them `from weasyprint import HTML`
# (imported at module load time by app/services/pdf.py) fails and the whole
# app fails to start. Render's native Python runtime has no apt access, so
# this app must deploy as a Docker Web Service, not native Python.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    shared-mime-info \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x docker-entrypoint.sh

EXPOSE 8010

ENTRYPOINT ["./docker-entrypoint.sh"]
