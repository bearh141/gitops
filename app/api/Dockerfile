FROM python:3.12-slim

RUN pip install --no-cache-dir flask prometheus-flask-exporter

WORKDIR /app
COPY app.py /app/app.py

EXPOSE 8080

CMD ["python", "app.py"]
