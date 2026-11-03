# Start from a small, official Python image
FROM python:3.12-slim

# Don't write .pyc files, and flush logs straight to stdout
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Set the working directory inside the container
WORKDIR /app

# Copy just the requirements file first (this lets Docker cache
# the pip install step, so it doesn't reinstall everything on every rebuild
# unless requirements.txt itself changes)
COPY requirements.txt .

# Install all Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Unprivileged user to run the app. The code stays owned by root, so the
# running process can't modify it.
RUN useradd --create-home --uid 10001 appuser

# Now copy the rest of the backend code (.dockerignore keeps .env and venv out)
COPY . .

USER appuser

# Tell Docker this container listens on port 8000
EXPOSE 8000

# Marks the container unhealthy if the API or its database stops responding.
# python:slim has no curl, so use the standard library.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]

# Bring the schema up to date (refuses to touch an un-stamped legacy DB),
# then hand PID 1 over to uvicorn so it receives stop signals directly.
CMD ["sh", "-c", "python scripts/migrate.py && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
