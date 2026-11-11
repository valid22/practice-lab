FROM python:3.12-slim

RUN useradd --uid 10001 --user-group --no-create-home practice \
    && install -d -o practice -g practice /data

WORKDIR /app
COPY server.py runner.py case_factory.py problems.json companies.json ./
COPY web/ ./web/

USER practice
ENTRYPOINT ["python", "-B", "-u", "server.py", "--bind", "0.0.0.0", "--data-dir", "/data"]
