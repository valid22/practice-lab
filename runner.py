"""Invoke one Python function per test case in a temporary working directory."""

import ast
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CASE_TIMEOUT = 2.0
RUN_TIMEOUT = 8.0
OUTPUT_LIMIT = 32 * 1024

# Apply limits inside the child before the submitted script starts.
BOOTSTRAP = """
import json
import os
import resource
import runpy
import sys

resource.setrlimit(resource.RLIMIT_FSIZE, (32768, 32768))
resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
name, result_fd = sys.argv[1:]
with open("args.json", encoding="utf-8") as stream:
    args = json.load(stream)
module = runpy.run_path("solution.py")
returned = module[name](*args)
with os.fdopen(int(result_fd), "w", encoding="utf-8") as stream:
    json.dump(returned, stream, allow_nan=False, sort_keys=True, separators=(",", ":"))
"""


def validate_code(code, function_name):
    try:
        module = ast.parse(code, filename="solution.py")
    except SyntaxError as error:
        raise ValueError(f"Python syntax error on line {error.lineno}: {error.msg}") from error
    allowed = (ast.Import, ast.ImportFrom, ast.FunctionDef)
    if any(not isinstance(node, allowed) for node in module.body):
        raise ValueError("Use function definitions and imports at the top level.")
    if not any(isinstance(node, ast.FunctionDef) and node.name == function_name for node in module.body):
        raise ValueError(f"Define the required function: {function_name}.")


def read_output(stream):
    stream.seek(0)
    return stream.read(OUTPUT_LIMIT).decode("utf-8", errors="replace")


def execute_case(code, function_name, case, timeout):
    start = time.monotonic()
    status, stdout, stderr = "Time limit", "", ""
    if timeout <= 0:
        return {"status": status, "stdout": stdout, "returned": "", "stderr": "Run budget exhausted.",
                "elapsed_ms": 0}

    with tempfile.TemporaryDirectory(prefix="practice-case-") as directory:
        root = Path(directory)
        (root / "solution.py").write_text(code, encoding="utf-8")
        (root / "args.json").write_text(case["input"], encoding="utf-8")
        with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err, tempfile.TemporaryFile() as result:
            proc = subprocess.Popen(
                [sys.executable, "-I", "-B", "-X", "utf8", "-c", BOOTSTRAP,
                 function_name, str(result.fileno())],
                cwd=root, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                pass_fds=(result.fileno(),),
                env={"PATH": os.defpath, "HOME": directory, "TMPDIR": directory},
                start_new_session=True,
            )
            timed_out = False
            try:
                proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
            finally:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                proc.wait()
            stdout = read_output(out)
            stderr = read_output(err).replace(str(root) + "/", "")
            returned = read_output(result)
            output_capped = any(
                os.fstat(stream.fileno()).st_size >= OUTPUT_LIMIT for stream in (out, err, result)
            )
        if output_capped:
            status = "Output limit"
        elif timed_out or proc.returncode in (-signal.SIGKILL, -signal.SIGXCPU):
            status = "Time limit"
        elif proc.returncode or not returned:
            status = "Runtime error"
        elif case["expected"] is None:
            status = "Ran"
        elif returned == case["expected"]:
            status = "Passed"
        else:
            status = "Wrong answer"

    return {"status": status, "stdout": stdout, "returned": returned, "stderr": stderr,
            "elapsed_ms": round((time.monotonic() - start) * 1000)}


def run_cases(code, function_name, cases):
    validate_code(code, function_name)
    deadline = time.monotonic() + RUN_TIMEOUT
    return [
        {**case, **execute_case(code, function_name, case, min(CASE_TIMEOUT, deadline - time.monotonic()))}
        for case in cases
    ]
