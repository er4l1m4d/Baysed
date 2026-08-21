FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PYTHONUNBUFFERED=1 BOT_RUN_MODE=observation
CMD ["python", "-m", "bayse_bot"]
