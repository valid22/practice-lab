"""Regression test for hidden-case disclosure through the local API."""

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from server import Handler, catalog_cases, database, initialize


class HiddenCaseTests(unittest.TestCase):
    def test_only_passing_submission_unlocks_hidden_cases(self):
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
            suite = catalog_cases([{"name": "Hidden", "args": [secret], "expected": secret}])
            with database(data_path) as db:
                db.execute("INSERT INTO problems VALUES (?, ?)", (problem_id, json.dumps(problem)))
                db.execute("INSERT INTO hidden_suites VALUES (?, ?)", (problem_id, json.dumps(suite)))

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
            public_only = "def identity(value):\n    print(value)\n    return 7\n"
            run = attempt("run", public_only)
            self.assertEqual(run["results"][0]["status"], "Passed")
            self.assertEqual(problem_detail()["hidden"], [])

            failed = attempt("submit", public_only)
            self.assertFalse(failed["completed"])
            self.assertEqual(failed["hidden_summary"], {"passed": 0, "total": 1})
            self.assertNotIn(secret, json.dumps(failed))

            passed = attempt("submit", "def identity(value):\n    return value\n")
            self.assertTrue(passed["completed"])
            self.assertEqual(passed["unlocked"], suite)
            self.assertEqual(problem_detail()["hidden"], suite)
            handler.handle_get("/api/library")
            listing = next(item for item in handler.payload["problems"] if item["id"] == problem_id)
            self.assertTrue(listing["completed"])
            self.assertNotIn(secret, json.dumps(handler.payload))

            handler.handle_get(f"/api/problems/{problem_id}/attempts/{failed['id']}")
            self.assertNotIn(secret, json.dumps(handler.payload))


if __name__ == "__main__":
    unittest.main()
