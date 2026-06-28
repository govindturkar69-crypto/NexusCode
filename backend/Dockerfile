# Start from a small, official Python image
FROM python:3.12-slim

# Set the working directory inside the container
WORKDIR /app

# Copy just the requirements file first (this lets Docker cache
# the pip install step, so it doesn't reinstall everything on every rebuild
# unless requirements.txt itself changes)
COPY requirements.txt .

# Install all Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Now copy the rest of the backend code
COPY . .

# Tell Docker this container listens on port 8000
EXPOSE 8000

# The command that runs when the container starts
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]