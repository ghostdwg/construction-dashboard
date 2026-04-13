FROM python:3.13-slim

WORKDIR /app

# System deps for PyMuPDF and pdfplumber
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001"]
