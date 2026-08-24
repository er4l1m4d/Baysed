FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Environment
ENV PYTHONUNBUFFERED=1
ENV BOT_RUN_MODE=observation

# Expose API port
EXPOSE 8000

# Run both bot and API server
CMD ["python", "-m", "api.run"]
