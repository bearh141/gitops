import os
import random

from flask import Flask, jsonify
from prometheus_flask_exporter import PrometheusMetrics


app = Flask(__name__)
metrics = PrometheusMetrics(app)

ERROR_RATE = float(os.getenv("ERROR_RATE", "0"))
VERSION = os.getenv("VERSION", "v1")


@app.route("/")
def index():
    if random.random() < ERROR_RATE:
        return jsonify({
            "status": "error",
            "message": "Injected error for canary and alert testing",
            "version": VERSION,
        }), 500

    return jsonify({
        "status": "ok",
        "service": "w9-api",
        "version": VERSION,
    })


@app.route("/healthz")
def healthz():
    return jsonify({
        "status": "ok",
        "service": "w9-api",
        "version": VERSION,
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
