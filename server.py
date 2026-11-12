"""Local HTTP server and SQLite storage for Practice Lab."""

import argparse
import json
import re
import secrets
import sqlite3
import threading
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from case_factory import SUITE_VERSIONS, make_hidden_suite
from complexity import BENCHMARKS, analyze_complexity
from runner import CASE_TIMEOUT, MEMORY_LIMIT_MIB, run_cases

ROOT = Path(__file__).resolve().parent
STATIC = {
    "/": ("index.html", "text/html"),
    "/style.css": ("style.css", "text/css"),
    "/practice-icon.png": ("practice-icon.png", "image/png"),
    "/appearance.js": ("appearance.js", "text/javascript"),
    "/app.js": ("app.js", "text/javascript"),
    "/catalog.js": ("catalog.js", "text/javascript"),
    "/companies.js": ("companies.js", "text/javascript"),
    "/layout.js": ("layout.js", "text/javascript"),
    "/editor.bundle.js": ("editor.bundle.js", "text/javascript"),
}
PROBLEM_ROUTE = re.compile(r"/problems/([a-z0-9-]+)/?")
API_PROBLEM_ROUTE = re.compile(r"/api" + PROBLEM_ROUTE.pattern)
LOGO_ROUTE = re.compile(r"/company-logos/([a-z0-9-]+\.(svg|png|ico))")
LOGO_TYPES = {"svg": "image/svg+xml", "png": "image/png", "ico": "image/x-icon"}
COMPANIES = json.loads((ROOT / "companies.json").read_text(encoding="utf-8"))
MAX_REQUEST = 8 * 1024 * 1024
MAX_CASES = 20
RUN_SLOT = threading.Lock()


class InvalidRequest(ValueError):
    pass


def string(value, label, limit, required=False):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise InvalidRequest(f"{label} must be {'nonempty ' if required else ''}text of at most {limit:,} characters.")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise InvalidRequest(f"{label} contains invalid Unicode.") from error
    return value


def canonical(value):
    return json.dumps(value, allow_nan=False, sort_keys=True, separators=(",", ":"))


def catalog_cases(cases):
    return [
        {"name": case["name"], "input": canonical(case["args"]), "expected": canonical(case["expected"])}
        for case in cases
    ]


def clean_custom_cases(cases):
    if not isinstance(cases, list) or len(cases) > MAX_CASES:
        raise InvalidRequest(f"Use at most {MAX_CASES} custom cases.")
    cleaned = []
    for index, case in enumerate(cases, 1):
        if not isinstance(case, dict):
            raise InvalidRequest(f"Test case {index} must be an object.")
        arguments = string(case.get("input"), f"Arguments for case {index}", 32000)
        expected = case.get("expected")
        if expected is not None:
            expected = string(expected, f"Expected return for case {index}", 32000)
        try:
            arguments = json.loads(arguments)
            if not isinstance(arguments, list):
                raise ValueError("Arguments must be a JSON array.")
            cleaned.append({
                "name": string(case.get("name", f"Case {index}"), "Case name", 100),
                "input": canonical(arguments),
                "expected": canonical(json.loads(expected)) if expected is not None else None,
            })
        except (ValueError, RecursionError) as error:
            raise InvalidRequest(f"Custom case {index}: {error}") from error
    return cleaned


@contextmanager
def database(path):
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    seeds = json.loads((ROOT / "problems.json").read_text(encoding="utf-8"))
    with database(path) as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS problems (
                id TEXT PRIMARY KEY, data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS attempts (
                id INTEGER PRIMARY KEY, problem_id TEXT NOT NULL,
                created TEXT NOT NULL, code TEXT NOT NULL,
                scope TEXT NOT NULL, results TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS attempts_problem ON attempts (problem_id, id DESC);
            CREATE TABLE IF NOT EXISTS hidden_suites (
                problem_id TEXT PRIMARY KEY, data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS completions (
                problem_id TEXT PRIMARY KEY, completed_at TEXT NOT NULL
            );
        """)
        db.execute("BEGIN IMMEDIATE")
        for table in ("hidden_suites", "completions"):
            columns = {column["name"] for column in db.execute(f"PRAGMA table_info({table})")}
            if "suite_version" not in columns:
                db.execute(f"ALTER TABLE {table} ADD COLUMN suite_version INTEGER NOT NULL DEFAULT 1")
        for seed in seeds:
            problem_id = seed["id"]
            seed["samples"] = catalog_cases(seed["samples"])
            db.execute(
                "INSERT INTO problems VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
                (problem_id, json.dumps(seed)),
            )
            version = SUITE_VERSIONS.get(problem_id, 1)
            saved = db.execute(
                "SELECT suite_version FROM hidden_suites WHERE problem_id = ?", (problem_id,)
            ).fetchone()
            if not saved or saved["suite_version"] < version:
                suite = make_hidden_suite(problem_id)
                db.execute("""
                    INSERT INTO hidden_suites (problem_id, data, suite_version) VALUES (?, ?, ?)
                    ON CONFLICT(problem_id) DO UPDATE
                    SET data = excluded.data, suite_version = excluded.suite_version
                """, (problem_id, json.dumps(catalog_cases(suite)), version))


def is_completed(db, problem_id):
    return db.execute("""
        SELECT 1 FROM completions JOIN hidden_suites USING (problem_id, suite_version)
        WHERE problem_id = ?
    """, (problem_id,)).fetchone() is not None


def hidden_suite(db, problem_id):
    row = db.execute(
        "SELECT suite_version, data FROM hidden_suites WHERE problem_id = ?", (problem_id,)
    ).fetchone()
    return (row["suite_version"], json.loads(row["data"])) if row else (0, [])


def problem_detail(db, problem):
    problem_id = problem["id"]
    _, suite = hidden_suite(db, problem_id)
    completed = is_completed(db, problem_id)
    return {**problem, "companies": company_tags(problem), "completed": completed, "hidden_count": len(suite),
            "judge": {"seconds": CASE_TIMEOUT, "memory_mib": MEMORY_LIMIT_MIB},
            "benchmark": BENCHMARKS[problem_id][0] if problem_id in BENCHMARKS else None,
            "hidden": suite if completed else []}


def company_tags(problem):
    tags = []
    for company_id in problem.get("companies", []):
        company = COMPANIES.get(company_id)
        if company:
            filename = company.get("logo")
            tags.append({"id": company_id, "name": company["name"],
                         "logo": f"/company-logos/{filename}" if filename else None})
    return tags


def catalog_entry(db, problem):
    return {
        "id": problem["id"],
        "title": problem["title"],
        "topics": problem.get("topics", []),
        "companies": company_tags(problem),
        "difficulty": problem.get("difficulty"),
        "completed": is_completed(db, problem["id"]),
    }


def fetch_problem(db, problem_id):
    row = db.execute("SELECT data FROM problems WHERE id = ?", (problem_id,)).fetchone()
    if row is None:
        raise InvalidRequest("Problem not found.")
    problem = json.loads(row["data"])
    if not problem.get("function"):
        raise InvalidRequest("This older problem needs a function signature before it can run.")
    return problem


def attempt_data(row):
    data = json.loads(row["results"])
    return {"results": data, "hidden_summary": None, "completed": False} if isinstance(data, list) else data


def attempt_summary(row):
    data = attempt_data(row)
    results = data["results"]
    hidden = data["hidden_summary"]
    public = [result for result in results if not result.get("hidden")]
    checked = sum(result["expected"] is not None for result in public)
    passed = sum(result["status"] == "Passed" for result in public)
    return {
        "id": row["id"], "created": row["created"], "scope": row["scope"],
        "passed": passed + (hidden["passed"] if hidden else 0),
        "checked": checked + (hidden["total"] if hidden else 0),
        "total": len(public) + (hidden["total"] if hidden else 0),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "PracticeLab"

    def respond(self, status, payload, content_type="application/json", *, style_nonce=None):
        if isinstance(payload, (dict, list)):
            payload = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        policy = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        if style_nonce:
            policy += f"; style-src 'self' 'nonce-{style_nonce}'"
        self.send_header("Content-Security-Policy", policy)
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        if self.headers.get("Host") not in self.server.allowed_hosts:
            self.respond(403, {"error": "Open the local address printed in the terminal."})
            return
        try:
            path = urlsplit(self.path).path
            if self.command == "GET":
                asset = STATIC.get(path)
                if PROBLEM_ROUTE.fullmatch(path):
                    asset = ("problem.html", "text/html")
                logo = LOGO_ROUTE.fullmatch(path)
                if logo and (ROOT / "web" / path.lstrip("/")).is_file():
                    asset = (path.lstrip("/"), LOGO_TYPES[logo[2]])
                if asset:
                    filename, content_type = asset
                    payload = (ROOT / "web" / filename).read_bytes()
                    if filename == "problem.html":
                        nonce = secrets.token_urlsafe(18)
                        payload = payload.replace(b"__EDITOR_STYLE_NONCE__", nonce.encode("ascii"), 1)
                        self.respond(200, payload, content_type, style_nonce=nonce)
                    else:
                        self.respond(200, payload, content_type)
                    return
            if self.command == "POST":
                if self.headers.get("X-Practice-Token") != self.server.token:
                    self.respond(403, {"error": "Reload the app to reconnect."})
                    return
                size = int(self.headers.get("Content-Length", 0))
                if not 0 < size <= MAX_REQUEST:
                    raise InvalidRequest("Request is empty or too large.")
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise InvalidRequest("Expected a JSON object.")
                self.handle_post(path, body)
                return
            self.handle_get(path)
        except (ValueError, RecursionError) as error:
            self.respond(400, {"error": str(error)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (OSError, sqlite3.Error) as error:
            self.log_error("%s", error)
            self.respond(500, {"error": "The local server could not complete the request. Check its terminal output."})

    def handle_get(self, path):
        with database(self.server.data_path) as db:
            if path == "/api/library":
                rows = db.execute("SELECT data FROM problems ORDER BY rowid").fetchall()
                problems = [json.loads(row["data"]) for row in rows]
                library = [catalog_entry(db, problem) for problem in problems if problem.get("function")]
                self.respond(200, {"problems": library})
                return
            detail = API_PROBLEM_ROUTE.fullmatch(path)
            if detail:
                try:
                    problem = fetch_problem(db, detail[1])
                except InvalidRequest as error:
                    self.respond(404, {"error": str(error)})
                    return
                self.respond(200, {"token": self.server.token, "problem": problem_detail(db, problem)})
                return
            match = re.fullmatch(r"/api/problems/([a-z0-9-]+)/attempts(?:/(\d+))?", path)
            if match:
                problem_id, attempt_id = match.groups()
                if attempt_id:
                    row = db.execute("SELECT * FROM attempts WHERE problem_id = ? AND id = ?",
                                     (problem_id, attempt_id)).fetchone()
                    if row:
                        self.respond(200, {**attempt_summary(row), **attempt_data(row), "code": row["code"]})
                        return
                else:
                    rows = db.execute("SELECT * FROM attempts WHERE problem_id = ? ORDER BY id DESC",
                                      (problem_id,)).fetchall()
                    self.respond(200, [attempt_summary(row) for row in rows])
                    return
        self.respond(404, {"error": "Page or attempt not found."})

    def handle_post(self, path, body):
        if path not in ("/api/run", "/api/submit", "/api/save", "/api/complexity"):
            self.respond(404, {"error": "Action not found."})
            return
        problem_id = string(body.get("problem_id"), "Problem ID", 100, required=True)
        code = string(body.get("code"), "Python code", 64000)
        submit = path == "/api/submit"
        with database(self.server.data_path) as db:
            problem = fetch_problem(db, problem_id)
            version, suite = hidden_suite(db, problem_id) if submit else (0, [])
        if path == "/api/complexity":
            mode = body.get("mode")
            if mode not in ("source", "benchmark"):
                raise InvalidRequest("Choose source analysis or benchmarking.")
            if mode == "benchmark" and problem_id not in BENCHMARKS:
                raise InvalidRequest("Benchmarks are unavailable for this problem.")
            if not RUN_SLOT.acquire(blocking=False):
                self.respond(409, {"error": "A run is already in progress."})
                return
            try:
                report = analyze_complexity(problem, code, mode)
            finally:
                RUN_SLOT.release()
            self.respond(200, report)
            return
        results = []
        hidden_summary = None
        first_wrong_answer = None
        scope = "snapshot"
        if path != "/api/save":
            scope = "submission" if submit else body.get("scope")
            if scope not in ("samples", "custom", "all", "submission"):
                raise InvalidRequest("Choose public or custom tests.")
            if scope == "submission" and not submit:
                raise InvalidRequest("Use Submit to check hidden cases.")
            if submit and not suite:
                raise InvalidRequest("This problem has no hidden tests configured.")
            cases = ([{**case, "group": "public"} for case in problem["samples"]]
                     if scope in ("samples", "all", "submission") else [])
            if scope in ("custom", "all"):
                cases.extend({**case, "group": "custom"} for case in clean_custom_cases(body.get("cases", [])))
            if not cases and not suite:
                raise InvalidRequest("Add a test case before running.")
            if not RUN_SLOT.acquire(blocking=False):
                self.respond(409, {"error": "A test run is already in progress."})
                return
            try:
                private = [{**case, "group": "private"} for case in suite]
                results = run_cases(code, problem["function"], cases + private)
            finally:
                RUN_SLOT.release()
            if submit:
                first_wrong_answer = next(
                    (result for result in results if result["status"] == "Wrong answer"), None
                )
                hidden_results = results[len(cases):]
                verdicts = Counter(result["status"] for result in hidden_results)
                hidden_summary = {
                    "passed": verdicts.pop("Passed", 0),
                    "total": len(suite),
                    "verdicts": dict(verdicts),
                }
                passed = all(result["status"] == "Passed" for result in results)
                public_results = results[:len(cases)]

        created = datetime.now(timezone.utc).isoformat()
        with database(self.server.data_path) as db:
            if submit:
                if passed:
                    db.execute("""
                        INSERT INTO completions (problem_id, completed_at, suite_version) VALUES (?, ?, ?)
                        ON CONFLICT(problem_id) DO UPDATE
                        SET completed_at = excluded.completed_at, suite_version = excluded.suite_version
                        WHERE completions.suite_version < excluded.suite_version
                    """, (problem_id, created, version))
                completed = is_completed(db, problem_id)
                results = public_results
                if completed:
                    results += [{**result, "hidden": True} for result in hidden_results]
            else:
                completed = False
            data = {"results": results, "hidden_summary": hidden_summary, "completed": completed}
            if first_wrong_answer is not None:
                data["first_wrong_answer"] = first_wrong_answer
            cursor = db.execute(
                "INSERT INTO attempts (problem_id, created, code, scope, results) VALUES (?, ?, ?, ?, ?)",
                (problem_id, created, code, scope, json.dumps(data)),
            )
            attempt_id = cursor.lastrowid
        response = {"id": attempt_id, "created": created, "scope": scope, **data}
        if submit and completed:
            response["unlocked"] = suite
        self.respond(201, response)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--bind", choices=("127.0.0.1", "0.0.0.0"), default="127.0.0.1",
                        help="Listen on all container interfaces when running in Docker.")
    parser.add_argument("--data-dir", type=Path, default=ROOT / ".practice")
    args = parser.parse_args()
    data_path = args.data_dir.resolve() / "practice.sqlite3"
    initialize(data_path)
    with ThreadingHTTPServer((args.bind, args.port), Handler) as server:
        port = server.server_address[1]
        server.allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        server.token = secrets.token_urlsafe(24)
        server.data_path = data_path
        print(f"Practice Lab is ready at http://127.0.0.1:{port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
