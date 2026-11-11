"""Build the local hidden suites. Concrete cases are generated once per database."""

from itertools import permutations
from secrets import SystemRandom


def test(name, args, expected):
    return {"name": name, "args": args, "expected": expected}


def network_cases(rng):
    a, b, c, d, e, f, g, h, i, j = rng.sample(range(2, 5000), 10)

    def network(name, start, edges, expected):
        rng.shuffle(edges)
        sources, targets = zip(*edges) if edges else ([], [])
        return test(name, [start, list(sources), list(targets)], expected)

    chain = rng.sample(range(2, 5000), 900)
    return [
        network("No links", a, [], a),
        network("Start in the middle of a cycle", c, [(b, c), (c, d), (d, b), (a, c)], b),
        network("Ignore a disconnected cycle", f, [(f, h), (h, i), (a, b), (b, a), (g, h)], i),
        network("Tail enters a cycle", a, [(a, b), (b, c), (c, j), (j, d), (d, c)], d),
        network("Long chain with unordered links", chain[0], list(zip(chain, chain[1:])), chain[-1]),
    ]


def shop_count(shops, roads):
    edges = {frozenset(road) for road in roads}
    return sum(
        len({shops[i] for i in route}) == 4
        and all(frozenset(pair) in edges for pair in zip(route, route[1:]))
        for route in permutations(range(len(shops)), 4)
    )


def shop_cases(rng):
    def town(name, shops, roads):
        rng.shuffle(roads)
        roads = [road if rng.randrange(2) else road[::-1] for road in roads]
        return test(name, [shops, roads], shop_count(shops, roads))

    types = rng.sample(range(4), 4)
    shops = types + [rng.choice(types) for _ in range(7)]
    connected = [[i, j] for i in range(len(shops)) for j in range(i) if rng.random() < .55]
    size = rng.randint(18, 22)
    complete = [[i, j] for i in range(size) for j in range(i)]
    return [
        town("All types with no roads", types, []),
        town("Disconnected components", types * 2, [[0, 1], [1, 2], [4, 5], [5, 7]]),
        town("Mixed town with cycles", shops, connected),
        town("Dense town", [types[i % 4] for i in range(size)], complete),
        town("Repeated type in a chain", [types[i] for i in [0, 1, 1, 2, 3, 0]], [[i, i+1] for i in range(5)]),
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
    rows = [
        ("Protected eater can win the next round", [[a, 2*k], [b, 5*k], [c, 6*k]]),
        ("Equal size stalls consumption", [[a, 9*k], [a, 5*k], [b, 5*k], [b, 8*k]]),
        ("Two events in one round", [[a, 2*k], [b, 7*k], [c, k], [d, 6*k]]),
        ("Alternating families", [[rng.choice((a, b)), 2**i] for i in range(20)]),
        ("Maximum size bounds", [[a, 999_999], [b, 1_000_000], [c, 700_000 + k]]),
    ]
    return [test(name, [row], simulate(row)) for name, row in rows]


FACTORIES = {
    "simple-network": network_cases,
    "four-shop-routes": shop_cases,
    "microorganism-simulation": microorganism_cases,
}


def make_hidden_suite(problem_id):
    factory = FACTORIES.get(problem_id)
    return factory(SystemRandom()) if factory else []
