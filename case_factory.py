"""Generate targeted hidden cases for each version of the problem judges."""

from collections import Counter
from math import factorial
from secrets import SystemRandom


def test(name, args, expected):
    return {"name": name, "args": args, "expected": expected}


def network_cases(rng):
    a, b, c, d, e, f, g, h = rng.sample(range(3, 4999), 8)

    def network(name, start, edges, expected):
        rng.shuffle(edges)
        sources, targets = zip(*edges) if edges else ([], [])
        return test(name, [start, list(sources), list(targets)], expected)

    nodes = rng.sample(range(2, 5000), 4998)
    long_chain = list(zip(nodes, nodes[1:]))
    loop_start = rng.randrange(1, len(nodes) - 1)
    fan_in = [(node, 4999) for node in nodes if node != 4999]
    return [
        network("No links at minimum node ID", 2, [], 2),
        network("Single link between ID bounds", 4999, [(4999, 2)], 2),
        network("Start at a sink with incoming links", d, [(a, d), (b, d)], d),
        network("Start has no links among unrelated edges", a, [(b, c), (c, b)], a),
        network("Two-node cycle", a, [(a, b), (b, a)], b),
        network("Start inside a larger cycle", c, [(b, c), (c, d), (d, b), (a, c)], b),
        network("Ignore a disconnected cycle", f, [(f, h), (h, e), (a, b), (b, a), (g, h)], e),
        network("Maximum node count with a shared sink", a, fan_in, 4999),
        network("Maximum-length chain with unordered links", nodes[0], long_chain.copy(), nodes[-1]),
        network("Maximum-length walk with a late cycle closure", nodes[0],
                long_chain + [(nodes[-1], nodes[loop_start])], nodes[-1]),
    ]


def shop_count(shops, roads):
    # Count by the directed middle edge. Its endpoint types fix the two outer types.
    neighbors = [Counter() for _ in shops]
    for u, v in roads:
        neighbors[u][shops[v]] += 1
        neighbors[v][shops[u]] += 1

    routes = 0
    for u, v in roads:
        if shops[u] != shops[v]:
            a, b = sorted({0, 1, 2, 3} - {shops[u], shops[v]})
            routes += 2 * (neighbors[u][a] * neighbors[v][b] + neighbors[u][b] * neighbors[v][a])
    return routes


def shop_cases(rng):
    def town(name, shops, roads):
        rng.shuffle(roads)
        roads = [road if rng.randrange(2) else road[::-1] for road in roads]
        return test(name, [shops, roads], shop_count(shops, roads))

    types = rng.sample(range(4), 4)
    small_shops = types + [rng.choice(types) for _ in range(7)]
    small_roads = [[i, j] for i in range(len(small_shops)) for j in range(i) if rng.random() < .55]
    large_shops = types + [rng.choice(types) for _ in range(46)]
    dense_roads = rng.sample([(i, j) for i in range(50) for j in range(i)], 250)
    bipartite = [[i, j] for i in range(10) for j in range(10, 35)]
    bipartite_types = [types[i % 2] for i in range(10)] + [types[2 + i % 2] for i in range(40)]
    return [
        town("Minimum town", [types[0]], []),
        town("All types with no roads", types, []),
        town("Disconnected components", types * 2, [[0, 1], [1, 2], [4, 5], [5, 7]]),
        town("All permutations in a four-shop clique", types, [[i, j] for i in range(4) for j in range(i)]),
        town("Mixed town with cycles", small_shops, small_roads),
        town("Repeated type in a chain", [types[i] for i in [0, 1, 1, 2, 3, 0]], [[i, i + 1] for i in range(5)]),
        town("Maximum shops in a sparse chain", types * 12 + types[:2], [[i, i + 1] for i in range(49)]),
        town("Maximum shops and roads in a mixed graph", large_shops, dense_roads.copy()),
        town("Maximum roads concentrated between two shop groups", bipartite_types, bipartite),
        town("Missing shop type at maximum size", [types[i % 3] for i in range(50)], dense_roads),
    ]


def simulate(row):
    active = [(family, size, index) for index, (family, size) in enumerate(row)]
    while True:
        ate = set()
        cursor = 0
        while cursor < len(active):
            family, size, index = active[cursor]
            for target in (cursor - 1, cursor + 1):
                if not 0 <= target < len(active):
                    continue
                other, smaller, other_index = active[target]
                if other != family and smaller < size and other_index not in ate:
                    active[cursor] = (family, size + smaller, index)
                    del active[target]
                    cursor -= target < cursor
                    ate.add(index)
                    break
            cursor += 1
        if not ate:
            family, size, _ = max(active, key=lambda item: item[1])
            if sum(item[1] == size for item in active) == 1:
                return f"{family} {size}"
            return None


def microorganism_cases(rng):
    a, b, c, d = rng.sample("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 4)
    k = rng.randint(2, 20)
    patterns = [
        ("Left preference changes the winner", [(a, 1), (b, 5), (a, 4), (b, 1)]),
        ("A successful eater is protected for the round", [(b, 7), (b, 1), (a, 2), (c, 4)]),
        ("Equal sizes can block an otherwise valid round", [(a, 9), (a, 5), (b, 5), (b, 8)]),
        ("Two separate events in a round", [(a, 2), (b, 7), (c, 1), (d, 6)]),
        ("Recheck after a productive round", [(b, 5), (c, 3), (c, 4)]),
        ("One family cannot consume itself", [(a, 9), (a, 3), (a, 4)]),
    ]
    rows = [(name, [[family, size * k] for family, size in row]) for name, row in patterns]
    rows.extend([
        ("One organism at minimum size", [[a, 1]]),
        ("Maximum number of organisms across alternating families",
         [[(a, b)[i % 2], 2**i] for i in range(20)]),
        ("Maximum number of organisms across mixed families",
         [[rng.choice((a, b, c, d)), 2**i] for i in range(20)]),
        ("Maximum starting size with growth above the input bound",
         [[a, 999_999], [b, 1_000_000], [c, 700_000 + k]]),
    ])
    cases = []
    for name, row in rows:
        expected = simulate(row)
        if expected is None:
            raise ValueError(f"Hidden case must have a unique winner: {name}")
        cases.append(test(name, [row], expected))
    return cases


def reachability_cases(rng):
    nodes = rng.sample(range(10_000), 10_000)
    chain = list(zip(nodes, nodes[1:]))
    rng.shuffle(chain)
    return [
        test("Zero-road trip", [1, [], 0, 0], True),
        test("Destination is isolated", [4, [[0, 1], [1, 2], [2, 0]], 1, 3], False),
        test("Long undirected trip with shuffled roads", [10_000, chain, nodes[-1], nodes[0]], True),
    ]


def three_shop_cases(rng):
    types = rng.sample(range(3), 3)
    return [
        test("Missing type", [[0, 1, 0], [[0, 1], [1, 2]]], 0),
        test("Repeated type creates an invalid walk", [[0, 1, 0, 2], [[0, 1], [1, 2], [2, 3]]], 2),
        test("Disconnected triangles", [types * 2, [[0, 1], [0, 2], [1, 2], [3, 4], [3, 5], [4, 5]]], 12),
        test("Many choices for both ends", [[types[0]] * 100 + [types[1]] * 20 + [types[2]] * 100,
             [[mid, end] for mid in range(100, 120) for end in (*range(100), *range(120, 220))]], 400_000),
    ]


def islands_cases(rng):
    side = rng.randint(180, 200)
    return [
        test("Water only", [[[0]]], 0),
        test("One large island", [[[1] * 200 for _ in range(200)]], 1),
        test("Checkerboard", [[[(r + c + 1) % 2 for c in range(side)] for r in range(side)]],
             (side * side + 1) // 2),
    ]


def dominance_cases(rng):
    teams = rng.sample(range(10_000), 10_000)
    chain = list(zip(teams, teams[1:]))
    rng.shuffle(chain)
    return [
        test("No requirements", [1, []], True),
        test("Shared successor does not create a cycle", [4, [[0, 1], [0, 2], [1, 3], [2, 3]]], True),
        test("Cycle in another component", [6, [[0, 1], [3, 4], [4, 5], [5, 3]]], False),
        test("Long valid order", [10_000, chain], True),
        test("Long cycle", [10_000, chain + [(teams[-1], teams[0])]], False),
    ]


def dag_route_cases(rng):
    layers = 80
    nodes = rng.sample(range(2 * layers + 2), 2 * layers + 2)
    edges = [(nodes[0], nodes[1]), (nodes[0], nodes[2])]
    for index in range(1, 2 * layers - 1, 2):
        edges.extend((nodes[u], nodes[v]) for u in (index, index + 1) for v in (index + 2, index + 3))
    edges.extend((nodes[u], nodes[-1]) for u in (2 * layers - 1, 2 * layers))
    rng.shuffle(edges)
    return [
        test("Empty route", [1, [], 0, 0], 1),
        test("Unreachable target despite incoming edges", [5, [[0, 1], [2, 3], [3, 4]], 0, 4], 0),
        test("Long directed chain", [10_000, [[i, i - 1] for i in range(1, 10_000)], 9999, 0], 1),
        test("Exponential routes with shuffled IDs", [len(nodes), edges, nodes[0], nodes[-1]],
             pow(2, layers, 1_000_000_007)),
    ]


def data_center_cases(rng):
    nodes = rng.sample(range(10_000), 10_000)
    chain = list(zip(nodes, nodes[1:]))
    rng.shuffle(chain)
    return [
        test("Every city is a center", [3, [[1, 0], [2, 1]], [2, 1, 0]], 0),
        test("Branch beyond the closest center", [6, [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5]], [0, 3]], 5),
        test("Thousands of centers along a chain", [10_000, chain, nodes[::2]], min(nodes[1::2])),
    ]


def fastest_route_cases(rng):
    layers = 60
    cost = rng.randint(1, 100)
    edges = [(0, 1, cost), (0, 2, cost)]
    for index in range(1, 2 * layers - 1, 2):
        edges.extend((u, v, cost) for u in (index, index + 1) for v in (index + 2, index + 3))
    edges.extend((u, 2 * layers + 1, cost) for u in (2 * layers - 1, 2 * layers))
    rng.shuffle(edges)
    return [
        test("Single node", [1, []], 1),
        test("Disconnected destination", [3, [[1, 0, 7]]], 0),
        test("A better distance replaces an earlier count",
             [5, [[0, 1, 10], [0, 2, 1], [0, 3, 1], [2, 1, 1], [3, 1, 1], [1, 4, 1]]], 2),
        test("Large weights", [4, [[0, 1, 10**9], [1, 2, 10**9], [2, 3, 10**9]]], 1),
        test("Many equal-cost routes", [2 * layers + 2, edges], pow(2, layers, 1_000_000_007)),
    ]


def all_shop_cases(rng):
    types = list(range(10)) * 3
    rng.shuffle(types)
    roads = [(u, v) for u in range(30) for v in range(u) if types[u] != types[v]]
    rng.shuffle(roads)
    return [
        test("All types present in different components", [[0, 1, 2, 3], [[0, 1], [2, 3]], 4], 0),
        test("Two types with extra same-type roads", [[0, 1, 0], [[0, 1], [1, 2], [0, 2]], 2], 4),
        test("Repeated types still allow alternative shops", [[0, 1, 1, 2], [[0, 1], [0, 2], [1, 3], [2, 3]], 3], 4),
        test("Ten types with three choices each", [types, roads, 10],
             (factorial(10) * 3**10) % 1_000_000_007),
    ]


def bus_route_cases(rng):
    offset = rng.randint(1, 100)
    routes = [[offset + i + j for j in (0, 1)] for i in range(500)]
    rng.shuffle(routes)
    return [
        test("Already at destination with no buses", [[], 40, 40], 0),
        test("Destination has no service", [[[0, 1, 2]], 1, 3], -1),
        test("One bus loops back around", [[[0, 1, 2]], 2, 0], 1),
        test("Long chain of transfers", [routes, offset, offset + 500], 500),
        test("A busy transfer hub", [[[0] + list(range(1 + i * 199, 1 + (i + 1) * 199)) for i in range(500)],
             1, 99_500], 2),
    ]


def spreadsheet_cases(rng):
    value = rng.randint(-40, -1)
    chain = [["sum", f"A{i}", [f"A{i - 1}"]] for i in range(1, 1999)]
    return [
        test("Unset references become live after assignment",
             [[["sum", "X", ["A", "B", "A"]], ["get", "X"], ["set", "A", value], ["get", "X"]]],
             [1, 0, 1, 2 * value]),
        test("Reject direct and indirect cycles",
             [[["sum", "X", ["X"]], ["get", "X"], ["sum", "X", ["Y"]], ["sum", "Y", ["X"]],
               ["set", "Y", value], ["get", "X"]]], [0, 0, 1, 0, 1, value]),
        test("Replacing a formula removes old dependencies",
             [[["set", "A", 4], ["sum", "B", ["A"]], ["sum", "C", ["B"]], ["get", "C"],
               ["set", "B", 8], ["sum", "A", ["C"]], ["get", "A"], ["set", "B", 6], ["get", "A"]]],
             [1, 1, 1, 4, 1, 1, 8, 1, 6]),
        test("Shared dependencies count through each branch",
             [[["set", "A", value], ["sum", "B", ["A"]], ["sum", "C", ["A", "B"]], ["get", "C"],
               ["set", "A", 5], ["get", "C"]]], [1, 1, 1, 2 * value, 1, 10]),
        test("Deep chain with unrelated updates and repeated reads",
             [[["set", "A0", value]] + chain + [["get", "A1998"], ["set", "A0", 3]]
              + [["set", "Other", 1], ["get", "A1998"]] * 6_000],
             [1] * 1999 + [value, 1] + [1, 3] * 6_000),
    ]


def letters_cases(rng):
    split = rng.randint(1, 299_998)
    return [
        test("Only one letter", ["b"], True),
        test("Wrong order at the start", ["ba"], False),
        test("Maximum length in order", ["a" * split + "b" * (300_000 - split)], True),
        test("One misplaced letter at the end", ["a" * split + "b" * (299_999 - split) + "a"], False),
    ]


def interval_cases(rng):
    disjoint = [[i, i + 1] for i in range(-3000, 3000, 3)]
    shuffled = disjoint.copy()
    rng.shuffle(shuffled)
    chain = [[i, i + 1] for i in range(2000)]
    rng.shuffle(chain)
    return [
        test("Single-point duplicates", [[[2, 2], [2, 2]]], [[2, 2]]),
        test("Nested intervals cannot shorten the merged end", [[[-9, 10], [0, 4], [7, 14]]], [[-9, 14]]),
        test("Shuffled disjoint intervals", [shuffled], disjoint),
        test("Long chain touching at endpoints", [chain], [[0, 2000]]),
    ]


def session_cases(rng):
    ttl = rng.randint(100, 200)
    return [
        test("A stale expiration cannot remove a renewed token",
             [ttl, [["issue", "a", 0], ["issue", "b", 0], ["renew", "a", 1],
                    ["count", ttl], ["count", ttl + 1]]], [1, 0]),
        test("Commands at the same timestamp use input order",
             [1, [["renew", "new", 0], ["count", 0], ["issue", "new", 0], ["count", 0]]], [0, 1]),
        test("Reissuing a token replaces its expiration",
             [2, [["issue", "a", 0], ["issue", "a", 1], ["count", 2], ["count", 3]]], [1, 0]),
        test("Thousands of live sessions and repeated counts",
             [20_000, [["issue", f"id{i}", i] for i in range(15_000)]
              + [["count", 15_000]] * 4_998 + [["count", 20_000], ["count", 35_000]]],
             [15_000] * 4_998 + [14_999, 0]),
    ]


def iterator_cases(rng):
    a, b, c = rng.sample(range(-100, 101), 3)
    return [
        test("Snapshots remain valid across later restores",
             [[[a, b], [c]], [["save"], ["next"], ["save"], ["restore", 0], ["next"],
                              ["next"], ["restore", 1], ["next"], ["next"]]], [a, a, b, b, c]),
        test("Save an exhausted cursor", [[[a]], [["save"], ["next"], ["save"], ["restore", 0],
                                                  ["next"], ["restore", 1], ["next"]]], [a, a, None]),
        test("Replay across many empty rows",
             [[[] for _ in range(9999)] + [[a]], [["save"], ["next"], ["restore", 0]] * 5000], [a] * 5000),
    ]


def skills_cases(rng):
    a, b = rng.sample(range(100), 2)
    unique = rng.sample(range(100_000), 10_000)
    return [
        test("All identical skills", [[a] * 10_000, 0], 10_000),
        test("All distinct skills", [unique, 20], 21),
        test("Alternating skills", [[a, b] * 5000, 20], 5010),
        test("Best answer may finish with a different skill", [[a, a, b, a, b, b, b], 1], 6),
    ]


FACTORIES = {
    "as-before-bs": letters_cases,
    "merge-intervals": interval_cases,
    "active-session-counts": session_cases,
    "resumable-matrix-iterator": iterator_cases,
    "skill-subsequence": skills_cases,
    "reachable-by-road": reachability_cases,
    "three-shop-routes": three_shop_cases,
    "number-of-islands": islands_cases,
    "team-dominance-order": dominance_cases,
    "dag-route-count": dag_route_cases,
    "farthest-data-center": data_center_cases,
    "fastest-route-count": fastest_route_cases,
    "all-shop-types": all_shop_cases,
    "bus-routes": bus_route_cases,
    "spreadsheet-dependencies": spreadsheet_cases,
    "simple-network": network_cases,
    "four-shop-routes": shop_cases,
    "microorganism-simulation": microorganism_cases,
}
SUITE_VERSIONS = {
    "simple-network": 2,
    "four-shop-routes": 2,
    "microorganism-simulation": 2,
}


def make_hidden_suite(problem_id):
    factory = FACTORIES.get(problem_id)
    return factory(SystemRandom()) if factory else []
