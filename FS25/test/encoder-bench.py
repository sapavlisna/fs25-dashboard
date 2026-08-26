#!/usr/bin/env python
"""Benchmarks the current JSON encoder against the pre-optimization one.

The old encoder is pulled from git (HEAD version of DashboardExport.lua) so the
comparison is against what actually shipped, not a reconstruction.

Absolute timings differ from FS25 (this runs a stock Lua build, the game embeds
its own), but the RATIO is what the change is judged on. Also reports the two
payload shapes: the mod now writes a slimmer file as well as encoding it faster.

  python encoder-bench.py [path-to-dashboard_data.json] [git-ref]
"""
import json
import os
import subprocess
import sys

from lupa import LuaRuntime

HERE = os.path.dirname(os.path.abspath(__file__))
LUA_FILE = os.path.join(HERE, "..", "DashboardExport.lua")
REPO = os.path.join(HERE, "..", "..", "..", "..")
REL = "src/Dashboard/FS25/DashboardExport.lua"
DEFAULT_PAYLOAD = os.path.expanduser(
    r"~/Documents/My Games/FarmingSimulator2025/dashboard_data.json")

sys.path.insert(0, HERE)
from encoder_support import lua_literal  # noqa: E402

ROUNDS = 40


def slice_new(src):
    return src[src.index("local JSON_ESCAPES"):src.index("-- Empty array sentinel")]


def slice_old(src):
    """The old encoder ended at the same sentinel comment."""
    return src[src.index("local JSON_ESCAPES"):src.index("-- Empty array sentinel")]


def bench(L, enc_src, payload_literal, label):
    encode = L.execute(enc_src + "\nreturn encodeJson")
    build = L.eval("function(s) return load('return ' .. s)() end")
    tbl = build(payload_literal)
    timer = L.eval("""
        function(fn, tbl, rounds)
            local best, total, out = math.huge, 0, nil
            for _ = 1, rounds do
                local t0 = os.clock()
                out = fn(tbl)
                local dt = (os.clock() - t0) * 1000
                total = total + dt
                if dt < best then best = dt end
            end
            return best, total / rounds, #out
        end
    """)
    best, avg, size = timer(encode, tbl, ROUNDS)
    print(f"  {label:<28} best {best:6.2f} ms   avg {avg:6.2f} ms   out {int(size):,} B")
    return best, avg


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PAYLOAD
    ref = sys.argv[2] if len(sys.argv) > 2 else "HEAD"
    if not os.path.exists(path):
        print(f"payload not found: {path}")
        return 1

    payload = json.load(open(path, encoding="utf-8"))
    lit = lua_literal(payload)

    old_src = subprocess.run(["git", "show", f"{ref}:{REL}"], cwd=REPO,
                             capture_output=True, text=True, encoding="utf-8",
                             check=True).stdout
    new_src = open(LUA_FILE, encoding="utf-8").read()

    print(f"\npayload : {os.path.getsize(path):,} B  ({len(payload.get('fields', []))} fields)")
    print(f"rounds  : {ROUNDS}\n")

    L = LuaRuntime(unpack_returned_tuples=True)
    print("Encoder, same full payload")
    old_best, old_avg = bench(L, slice_old(old_src), lit, f"old ({ref})")
    new_best, new_avg = bench(L, slice_new(new_src), lit, "new (working tree)")

    print(f"\n  speedup: {old_best / new_best:.2f}x on best, "
          f"{old_avg / new_avg:.2f}x on average")
    print(f"  encode time saved per export: {old_avg - new_avg:.2f} ms "
          f"({100 - 100 * new_avg / old_avg:.0f}%)")

    # The mod now also writes LESS: defaulted field keys are stripped and the
    # session-static sections moved to their own file. Encoding the shape the mod
    # actually produces shows the combined effect.
    slim = dict(payload)
    slim["fields"] = [
        {k: v for k, v in f.items()
         if not (k in FIELD_DEFAULTS and v == FIELD_DEFAULTS[k])}
        for f in payload.get("fields", [])
    ]
    slim.pop("availableFruits", None)
    if isinstance(slim.get("priceForecast"), dict):
        slim["priceForecast"] = {k: v for k, v in slim["priceForecast"].items()
                                 if k != "fillTypes"}

    print("\nEncoder, payload shape the mod now writes")
    slim_best, slim_avg = bench(L, slice_new(new_src), lua_literal(slim), "new + slim payload")
    print(f"\n  vs old encoder on old payload: {old_best / slim_best:.2f}x on best, "
          f"{old_avg / slim_avg:.2f}x on average")
    print(f"  total encode time saved per export: {old_avg - slim_avg:.2f} ms "
          f"({100 - 100 * slim_avg / old_avg:.0f}%)\n")
    return 0


# Mirrors FIELD_DEFAULTS on both sides; payload-contract-check.py asserts they
# stay in sync, this only needs them to model the slim shape.
FIELD_DEFAULTS = {
    "fruitTypeId": "", "fruitName": "", "growthState": 0, "maxGrowthState": 0,
    "growthPercent": 0, "isReadyToHarvest": False, "isCut": False,
    "isWithered": False, "daysToHarvest": 0, "needsSowing": False,
    "plannedFruit": "", "needsPlowing": False, "needsCultivating": False,
    "needsLime": False, "fertilizationLevel": 0, "weedLevel": 0,
    "stoneLevel": 0, "owned": False,
}


if __name__ == "__main__":
    sys.exit(main())
