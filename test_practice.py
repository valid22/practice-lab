"""Regression tests for resource verdicts and versioned hidden-case disclosure."""

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from complexity import BENCHMARKS, analyze_complexity, growth_estimate
from runner import execute_case
from server import Handler, catalog_cases, database, hidden_suite, initialize, is_completed


class HiddenCaseTests(unittest.TestCase):
    def test_failed_submission_reveals_one_case_and_passing_unlocks_the_suite(self):
        with tempfile.TemporaryDirectory() as directory:
            data_path = Path(directory) / "practice.sqlite3"
            initialize(data_path)
            problem_id = "function-test"
            secret = "only-visible-after-completion"
            problem = {
                "id": problem_id,
                "title": "Test identity",
                "function": "identity",
                "samples": catalog_cases([{"name": "Public", "args": [7], "expected": 7}]),
            }
            suite = catalog_cases([
                {"name": "Hidden one", "args": [secret], "expected": secret},
                {"name": "Hidden two", "args": ["second-secret"], "expected": "second-secret"},
            ])
            with database(data_path) as db:
                db.execute("INSERT INTO problems VALUES (?, ?)", (problem_id, json.dumps(problem)))
                db.execute("INSERT INTO hidden_suites (problem_id, data) VALUES (?, ?)", (problem_id, json.dumps(suite)))

            handler = Handler.__new__(Handler)
            handler.server = SimpleNamespace(data_path=data_path, token="test-token")

            def respond(status, payload):
                self.assertIn(status, (200, 201))
                handler.payload = payload

            handler.respond = respond

            def problem_detail():
                handler.handle_get(f"/api/problems/{problem_id}")
                return handler.payload["problem"]

            def attempt(action, code):
                handler.handle_post("/api/" + action, {
                    "problem_id": problem_id, "code": code, "scope": "samples",
                })
                return handler.payload

            self.assertEqual(problem_detail()["hidden"], [])
            public_only = """def identity(value):
    print(value)
    return 7 if value == 7 else len(value)
"""
            run = attempt("run", public_only)
            self.assertEqual(run["results"][0]["status"], "Passed")
            self.assertEqual(run["results"][0]["group"], "public")
            self.assertEqual(problem_detail()["hidden"], [])

            failed = attempt("submit", public_only)
            self.assertFalse(failed["completed"])
            self.assertEqual(failed["hidden_summary"], {"passed": 0, "total": 2, "verdicts": {"Wrong answer": 2}})
            first = failed["first_wrong_answer"]
            for field in ("name", "input", "expected"):
                self.assertEqual(first[field], suite[0][field])
            self.assertEqual(first["status"], "Wrong answer")
            self.assertEqual(first["group"], "private")
            self.assertEqual(first["returned"], str(len(secret)))
            self.assertGreater(first["elapsed_ms"], 0)
            self.assertGreater(first["peak_memory_bytes"], 0)
            self.assertEqual(len(failed["results"]), 1)
            self.assertNotIn("second-secret", json.dumps(failed))
            self.assertEqual(problem_detail()["hidden"], [])

            failed_public = attempt("submit", "def identity(value):\n    return 0\n")
            self.assertEqual(failed_public["first_wrong_answer"], failed_public["results"][0])
            self.assertNotIn(secret, json.dumps(failed_public))

            passed = attempt("submit", "def identity(value):\n    return value\n")
            self.assertTrue(passed["completed"])
            self.assertNotIn("first_wrong_answer", passed)
            self.assertEqual(passed["unlocked"], suite)
            self.assertEqual([result["group"] for result in passed["results"]], ["public", "private", "private"])
            self.assertEqual(problem_detail()["hidden"], suite)
            handler.handle_get("/api/library")
            listing = next(item for item in handler.payload["problems"] if item["id"] == problem_id)
            self.assertTrue(listing["completed"])
            self.assertNotIn(secret, json.dumps(handler.payload))

            handler.handle_get(f"/api/problems/{problem_id}/attempts/{failed['id']}")
            self.assertEqual(handler.payload["first_wrong_answer"], failed["first_wrong_answer"])
            self.assertNotIn("second-secret", json.dumps(handler.payload))

    def test_upgrading_a_suite_preserves_attempts_but_requires_a_new_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            data_path = Path(directory) / "practice.sqlite3"
            initialize(data_path)
            problem_id = "simple-network"
            with database(data_path) as db:
                db.execute("UPDATE hidden_suites SET suite_version = 1, data = '[]' WHERE problem_id = ?", (problem_id,))
                db.execute("INSERT INTO completions (problem_id, completed_at) VALUES (?, 'old')", (problem_id,))
                db.execute("""
                    INSERT INTO attempts (problem_id, created, code, scope, results)
                    VALUES (?, 'old', 'old code', 'submission', '[]')
                """, (problem_id,))
                self.assertTrue(is_completed(db, problem_id))
            initialize(data_path)
            with database(data_path) as db:
                self.assertFalse(is_completed(db, problem_id))
                version, cases = hidden_suite(db, problem_id)
                self.assertEqual(version, 2)
                self.assertGreater(len(cases), 5)
                self.assertEqual(db.execute("SELECT code FROM attempts").fetchone()["code"], "old code")
            initialize(data_path)
            with database(data_path) as db:
                self.assertEqual(hidden_suite(db, problem_id), (version, cases))


class RunnerLimitTests(unittest.TestCase):
    case = {"name": "Limit probe", "input": "[]", "expected": "1"}

    def test_time_limit_and_run_budget(self):
        code = "def solve():\n    while True:\n        pass"
        self.assertEqual(execute_case(code, "solve", self.case, .15)["status"], "Time limit")
        self.assertEqual(execute_case(code, "solve", self.case, 0)["status"], "Not run")

    def test_reports_peak_memory_and_elapsed_time(self):
        code = "def solve():\n    data = bytearray(b'x' * (24 * 1024 * 1024))\n    return 1"
        result = execute_case(code, "solve", self.case, 2)
        self.assertEqual(result["status"], "Passed")
        self.assertGreaterEqual(result["peak_memory_bytes"], 24 * 1024 * 1024)
        self.assertGreater(result["elapsed_ms"], 0)

    def test_memory_limit(self):
        code = "def solve():\n    data = bytearray(b'x' * (160 * 1024 * 1024))\n    return 1"
        self.assertEqual(execute_case(code, "solve", self.case, 2)["status"], "Memory limit")

    def test_profile_measures_the_call_and_recreates_mutated_arguments(self):
        code = """def solve(items):
    buffer = bytearray(4096)
    return items.pop() + buffer[0]
"""
        case = {"input": "[[1]]", "expected": "1"}
        result = execute_case(code, "solve", case, 2, profile=True)
        self.assertEqual(result["status"], "Passed")
        self.assertEqual(result["returned"], "1")
        self.assertGreater(result["time_ns"], 0)
        self.assertGreaterEqual(result["allocated_bytes"], 4096)


class ComplexityTests(unittest.TestCase):
    def test_wrong_answer_stops_the_benchmark(self):
        problem = {"id": "simple-network", "function": "compute"}
        report = analyze_complexity(problem, "def compute(*args):\n    return -1", "benchmark")
        self.assertEqual(report["samples"], [])
        self.assertEqual(report["failure"]["size"], BENCHMARKS[problem["id"]][1][0])
        self.assertEqual(report["failure"]["status"], "Wrong answer")

    def test_growth_fit_and_small_input_range(self):
        sizes = BENCHMARKS["simple-network"][1]
        samples = [{"size": n, "value": 1000 + n**2} for n in sizes]
        self.assertEqual(growth_estimate(samples, "value", noise_floor=128), "O(n²)")
        samples = [{"size": n, "value": memory} for n, memory in
                   zip(sizes, (1376, 5048, 19760, 78128, 237880, 803120))]
        self.assertEqual(growth_estimate(samples, "value", noise_floor=128), "Inconclusive")
        small_sizes = BENCHMARKS["microorganism-simulation"][1]
        samples = [{"size": n, "value": 1000 + n**2} for n in small_sizes]
        self.assertEqual(growth_estimate(samples, "value", noise_floor=128), "Inconclusive")


if __name__ == "__main__":
    unittest.main()
