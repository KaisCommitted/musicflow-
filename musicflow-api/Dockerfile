FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

EXPOSE 5000

CMD ["python", "-m", "flask", "--app", "server:app", "run", "--host", "0.0.0.0", "--port", "5000", "--reload"]
