"""Invoke one Python function per test case in a temporary working directory."""

import ast
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CASE_TIMEOUT = 2.0
RUN_TIMEOUT = 20.0
MEMORY_LIMIT_MIB = 128
MEMORY_LIMIT = MEMORY_LIMIT_MIB * 1024 * 1024
MEMORY_EXIT = 86
OUTPUT_LIMIT = 32 * 1024

# Apply limits inside the child before the submitted script starts.
BOOTSTRAP = f"""
import json
import os
import resource
import runpy
import sys

resource.setrlimit(resource.RLIMIT_FSIZE, ({OUTPUT_LIMIT}, {OUTPUT_LIMIT}))
resource.setrlimit(resource.RLIMIT_CPU, ({int(CASE_TIMEOUT)}, {int(CASE_TIMEOUT) + 1}))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
if sys.platform.startswith("linux"):
    resource.setrlimit(resource.RLIMIT_AS, ({MEMORY_LIMIT}, {MEMORY_LIMIT}))

def check_peak_memory():
    # macOS reports peak resident memory in bytes, even after objects are freed.
    if resource.getrusage(resource.RUSAGE_SELF).ru_maxrss > {MEMORY_LIMIT}:
        os._exit({MEMORY_EXIT})

def monitor_memory():
    while True:
        check_peak_memory()
        time.sleep(0.02)

if sys.platform == "darwin":
    import threading
    import time
    threading.Thread(target=monitor_memory, daemon=True).start()

try:
    name, result_fd, profile = sys.argv[1:]
    with open("args.json", encoding="utf-8") as stream:
        if profile:
            raw_args = stream.read()
        else:
            args = json.load(stream)
    module = runpy.run_path("solution.py")
    function = module[name]
    if profile:
        import time
        import tracemalloc

        durations = []
        for _ in range(5):
            args = json.loads(raw_args)
            start_ns = time.perf_counter_ns()
            returned = function(*args)
            durations.append(time.perf_counter_ns() - start_ns)
            del returned, args
        args = json.loads(raw_args)
        tracemalloc.start()
        returned = function(*args)
        _, allocated = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        returned = [returned, sorted(durations)[2], allocated]
    else:
        returned = function(*args)
    with os.fdopen(int(result_fd), "w", encoding="utf-8") as stream:
        json.dump(returned, stream, allow_nan=False, sort_keys=True, separators=(",", ":"))
except MemoryError:
    os._exit({MEMORY_EXIT})
finally:
    if sys.platform == "darwin":
        check_peak_memory()
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


def stop_process_group(pid):
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def wait_for_case(proc, timeout):
    # Reap with wait4 instead of Popen.wait to retain this child's peak RSS.
    deadline = time.monotonic() + timeout
    timed_out = False
    while True:
        pid, status, usage = os.wait4(proc.pid, os.WNOHANG)
        if pid:
            break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            timed_out = True
            stop_process_group(proc.pid)
            _, status, usage = os.wait4(proc.pid, 0)
            break
        time.sleep(min(0.01, remaining))
    proc.returncode = os.waitstatus_to_exitcode(status)
    peak_bytes = usage.ru_maxrss if sys.platform == "darwin" else usage.ru_maxrss * 1024
    return timed_out, peak_bytes or None


def execute_case(code, function_name, case, timeout, *, profile=False):
    start = time.monotonic()
    if timeout <= 0:
        return {"status": "Not run", "stdout": "", "returned": "", "stderr": "Run budget exhausted.",
                "elapsed_ms": 0, "peak_memory_bytes": None}

    with tempfile.TemporaryDirectory(prefix="practice-case-") as directory:
        root = Path(directory)
        (root / "solution.py").write_text(code, encoding="utf-8")
        (root / "args.json").write_text(case["input"], encoding="utf-8")
        with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err, tempfile.TemporaryFile() as result:
            proc = subprocess.Popen(
                [sys.executable, "-I", "-B", "-X", "utf8", "-c", BOOTSTRAP,
                 function_name, str(result.fileno()), "profile" if profile else ""],
                cwd=root, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                pass_fds=(result.fileno(),),
                env={"PATH": os.defpath, "HOME": directory, "TMPDIR": directory},
                start_new_session=True,
            )
            try:
                timed_out, peak_memory = wait_for_case(proc, timeout)
            finally:
                stop_process_group(proc.pid)
                if proc.returncode is None:
                    proc.wait()
            stdout = read_output(out)
            stderr = read_output(err).replace(str(root) + "/", "")
            returned = read_output(result)
            output_capped = any(
                os.fstat(stream.fileno()).st_size >= OUTPUT_LIMIT for stream in (out, err, result)
            )
        measurement = {}
        if profile and not (output_capped or timed_out or proc.returncode) and returned:
            try:
                value, duration, allocated = json.loads(returned)
                if type(duration) is not int or type(allocated) is not int or min(duration, allocated) < 0:
                    raise ValueError("Invalid benchmark measurements.")
                returned = json.dumps(value, allow_nan=False, sort_keys=True, separators=(",", ":"))
                measurement = {"time_ns": duration, "allocated_bytes": allocated}
            except (TypeError, ValueError, RecursionError):
                returned = ""
        if output_capped:
            status = "Output limit"
        elif proc.returncode == MEMORY_EXIT:
            status = "Memory limit"
        elif timed_out or proc.returncode == -signal.SIGXCPU:
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
            "elapsed_ms": round((time.monotonic() - start) * 1000), "peak_memory_bytes": peak_memory,
            **measurement}


def run_cases(code, function_name, cases):
    validate_code(code, function_name)
    deadline = time.monotonic() + RUN_TIMEOUT
    return [
        {**case, **execute_case(code, function_name, case, min(CASE_TIMEOUT, deadline - time.monotonic()))}
        for case in cases
    ]
