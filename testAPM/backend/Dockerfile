# Use official Python image
FROM python:3.11-slim

# Set work directory
WORKDIR /app

# Install system deps (optional but handy)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY . .

# Expose app port
EXPOSE 8000

# Run FastAPI with Uvicorn
CMD ["ddtrace-run", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]

