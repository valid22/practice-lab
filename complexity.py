"""Estimate growth from Python source and dedicated, reproducible benchmarks."""

import json
import logging
import math
import random
from statistics import mean

from case_factory import shop_count
from runner import CASE_TIMEOUT, execute_case, validate_code

BENCHMARKS = {
    "simple-network": ("n is the number of nodes in a single chain with shuffled links.",
                       (16, 64, 256, 1024, 2500, 4998)),
    "four-shop-routes": ("n is the number of shops. Roads grow at two per shop.",
                         (6, 9, 14, 21, 33, 50)),
    "microorganism-simulation": ("n is the starting row length. One organism consumes its neighbors.",
                                 (2, 4, 7, 11, 15, 20)),
}


def benchmark_case(problem_id, size):
    if problem_id == "simple-network":
        rng = random.Random(7)
        nodes = rng.sample(range(2, 5000), size)
        edges = list(zip(nodes, nodes[1:]))
        rng.shuffle(edges)
        sources, targets = map(list, zip(*edges))
        args, expected = [nodes[0], sources, targets], nodes[-1]
    elif problem_id == "four-shop-routes":
        shops = [i % 4 for i in range(size)]
        roads = [sorted((i, (i + step) % size)) for i in range(size) for step in (1, 2)]
        args, expected = [shops, roads], shop_count(shops, roads)
    else:
        args, expected = [[["A", 2]] + [["B", 1] for _ in range(size - 1)]], f"A {size + 1}"
    return {"input": json.dumps(args), "expected": json.dumps(expected)}


def source_estimate(code, name):
    try:
        from bigopy import analyze_source
    except ModuleNotFoundError:
        return {"message": "Install the optional complexity dependency to analyze source."}
    try:
        # The last definition is the one available to the runner.
        result = next((f for f in reversed(analyze_source(code).functions) if f.name == name), None)
        if result is not None:
            return {"label": result.complexity.label, "reasons": list(result.reasons)[:4]}
    except Exception:
        logging.exception("Source complexity analysis failed")
    return {"message": "The source analyzer could not estimate this function."}


def growth_estimate(samples, field, *, noise_floor):
    sizes = [sample["size"] for sample in samples]
    values = [sample[field] for sample in samples]
    spread = max(values) - min(values)
    if spread <= noise_floor:
        return "Flat across tested sizes"
    if sizes[-1] / sizes[0] < 8 or sizes[-1] < 32 or values[-1] - values[0] <= noise_floor:
        return "Inconclusive"

    fit = best_fit(sizes, values)
    # The largest input can dominate the fit, especially at allocation boundaries.
    if fit != best_fit(sizes[:-1], values[:-1]):
        return "Inconclusive"
    return fit


def best_fit(sizes, values):
    # Fit a fixed overhead and nonnegative scale for each candidate growth curve.
    # Normalize measurements so the fit compares shape, independent of the units.
    spread = max(values) - min(values)
    if not spread:
        return "Inconclusive"
    observed = [(value - min(values)) / spread for value in values]
    models = {
        "O(log n)": math.log,
        "O(n)": float,
        "O(n log n)": lambda n: n * math.log(n),
        "O(n²)": lambda n: n**2,
        "O(n³)": lambda n: n**3,
    }
    scores = []
    observed_mean = mean(observed)
    for label, model in models.items():
        curve = [model(n) / model(sizes[-1]) for n in sizes]
        center = mean(curve)
        slope = max(0, sum((x - center) * (y - observed_mean) for x, y in zip(curve, observed))
                    / sum((x - center)**2 for x in curve))
        error = math.sqrt(mean((y - observed_mean - slope * (x - center))**2
                               for x, y in zip(curve, observed)))
        scores.append((error, label))
    best, next_best = sorted(scores)[:2]
    if best[0] > 0.09 or next_best[0] - best[0] < 0.015:
        return "Inconclusive"
    return best[1]


def analyze_complexity(problem, code, mode):
    name = problem["function"]
    validate_code(code, name)
    if mode == "source":
        return source_estimate(code, name)

    description, sizes = BENCHMARKS[problem["id"]]
    samples = []
    report = {"description": description, "samples": samples}
    for size in sizes:
        case = benchmark_case(problem["id"], size)
        result = execute_case(code, name, case, CASE_TIMEOUT, profile=True)
        if result["status"] != "Passed":
            return {**report, "failure": {"size": size, "status": result["status"],
                                         "stderr": result["stderr"]}}
        samples.append({"size": size, "time_ns": result["time_ns"],
                        "allocated_bytes": result["allocated_bytes"]})
    return {**report, "time_growth": growth_estimate(samples, "time_ns", noise_floor=500),
            "memory_growth": growth_estimate(samples, "allocated_bytes", noise_floor=128)}
