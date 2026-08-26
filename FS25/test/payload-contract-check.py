#!/usr/bin/env python
"""End-to-end check of the mod<->server payload contract.

The mod shrinks what it writes twice over:
  * field records drop keys whose value equals the default
  * session-static sections move to dashboard_static.json

The server undoes both in enrich() via Server/payloadShape.js. If the two sides
drift, the frontend silently loses fields. This test runs the REAL Lua strip and
the REAL JS restore against a real payload and asserts the round trip is exact.

  pip install lupa
  python payload-contract-check.py [path-to-dashboard_data.json]
"""
import json
import os
import re
import subprocess
import sys
import tempfile

from lupa import LuaRuntime

HERE = os.path.dirname(os.path.abspath(__file__))
LUA_FILE = os.path.join(HERE, "..", "DashboardExport.lua")
SHAPE_JS = os.path.join(HERE, "..", "..", "Server", "payloadShape.js")
DEFAULT_PAYLOAD = os.path.expanduser(
    r"~/Documents/My Games/FarmingSimulator2025/dashboard_data.json"
)

sys.path.insert(0, HERE)
from encoder_support import lua_literal  # noqa: E402

failures = []


def check(ok, label, detail=""):
    print(("  PASS  " if ok else "  FAIL  ") + label + (f"  {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(label)


def lua_field_defaults(src):
    """Parse FIELD_DEFAULTS out of the Lua source."""
    block = re.search(r"local FIELD_DEFAULTS = \{(.*?)\n\}", src, re.S).group(1)
    out = {}
    for line in block.splitlines():
        line = line.split("--")[0].strip().rstrip(",")
        if not line or "=" not in line:
            continue
        k, v = (p.strip() for p in line.split("=", 1))
        if v == "false":
            out[k] = False
        elif v == "true":
            out[k] = True
        elif v in ('""', "''"):
            out[k] = ""
        else:
            out[k] = int(v)
    return out


def js_field_defaults():
    """Ask Node for the real exported table."""
    code = f"process.stdout.write(JSON.stringify(require({SHAPE_JS!r}).FIELD_DEFAULTS))"
    return json.loads(subprocess.run(
        ["node", "-e", code], capture_output=True, text=True, check=True,
        encoding="utf-8").stdout)


def main():
    src = open(LUA_FILE, encoding="utf-8").read()
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PAYLOAD
    if not os.path.exists(path):
        print(f"payload not found: {path}")
        return 1
    original = json.load(open(path, encoding="utf-8"))

    print("\nDefault tables in sync")
    lua_def, js_def = lua_field_defaults(src), js_field_defaults()
    check(lua_def == js_def, "Lua FIELD_DEFAULTS == JS FIELD_DEFAULTS",
          f"lua-only={set(lua_def) - set(js_def)} js-only={set(js_def) - set(lua_def)} "
          f"differing={ {k for k in set(lua_def) & set(js_def) if lua_def[k] != js_def[k]} }")
    print(f"        {len(lua_def)} keys")

    # ── run the real Lua strip ──────────────────────────────────────────────
    print("\nMod side (real Lua)")
    L = LuaRuntime(unpack_returned_tuples=True)
    enc = src[src.index("local JSON_ESCAPES"):src.index("-- Empty array sentinel")]
    defs_start = src.index("local FIELD_DEFAULTS = {")
    defs_end = src.index("return rec\nend", defs_start) + len("return rec\nend")
    strip = src[defs_start:defs_end]
    encode, strip_fn = L.execute(
        enc + "\n" + strip + "\nreturn encodeJson, stripFieldDefaults")

    build = L.eval("function(s) return load('return ' .. s)() end")
    fields_tbl = build(lua_literal(original.get("fields", [])))
    n = int(L.eval("function(t) return #t end")(fields_tbl))
    for i in range(1, n + 1):
        strip_fn(fields_tbl[i])
    stripped_fields = json.loads(encode(fields_tbl))
    check(len(stripped_fields) == len(original["fields"]),
          "strip keeps every field record",
          f"{len(stripped_fields)} vs {len(original['fields'])}")

    before = sum(len(json.dumps(f)) for f in original["fields"])
    after = sum(len(json.dumps(f)) for f in stripped_fields)
    print(f"        fields bytes {before:,} -> {after:,}  ({100 - 100 * after / before:.1f}% smaller)")

    # payload as the mod would now write it: stripped fields, static sections out
    slim = dict(original)
    slim["fields"] = stripped_fields
    statics = {
        "availableFruits": original.get("availableFruits", []),
        "priceForecastFillTypes": (original.get("priceForecast") or {}).get("fillTypes", []),
    }
    slim.pop("availableFruits", None)
    if isinstance(slim.get("priceForecast"), dict):
        slim["priceForecast"] = {k: v for k, v in slim["priceForecast"].items()
                                 if k != "fillTypes"}
    full_bytes = len(json.dumps(original, separators=(",", ":")))
    slim_bytes = len(json.dumps(slim, separators=(",", ":")))
    print(f"        payload      {full_bytes:,} -> {slim_bytes:,}  "
          f"({100 - 100 * slim_bytes / full_bytes:.1f}% smaller)")

    # ── run the real JS restore ─────────────────────────────────────────────
    print("\nServer side (real JS)")
    with tempfile.TemporaryDirectory() as tmp:
        pj, sj = os.path.join(tmp, "p.json"), os.path.join(tmp, "s.json")
        json.dump(slim, open(pj, "w", encoding="utf-8"))
        json.dump(statics, open(sj, "w", encoding="utf-8"))
        code = f"""
            const fs = require('fs');
            const shape = require({SHAPE_JS!r});
            const d = JSON.parse(fs.readFileSync({pj!r}, 'utf8'));
            const s = JSON.parse(fs.readFileSync({sj!r}, 'utf8'));
            process.stdout.write(JSON.stringify(shape.restorePayloadShape(d, s)));
        """
        r = subprocess.run(["node", "-e", code], capture_output=True, text=True,
                           encoding="utf-8")
        check(r.returncode == 0, "restorePayloadShape runs", r.stderr.strip())
        if r.returncode != 0:
            return 1
        restored = json.loads(r.stdout)

    check(restored == original, "restored payload is byte-identical in content",
          first_diff(original, restored))

    # ── an explicit null must survive (mock scenario relies on it) ───────────
    with tempfile.TemporaryDirectory() as tmp:
        pj, sj = os.path.join(tmp, "p.json"), os.path.join(tmp, "s.json")
        json.dump({"fields": [], "priceForecast": None}, open(pj, "w"))
        json.dump(statics, open(sj, "w"))
        code = f"""
            const fs = require('fs');
            const shape = require({SHAPE_JS!r});
            const d = JSON.parse(fs.readFileSync({pj!r}, 'utf8'));
            const s = JSON.parse(fs.readFileSync({sj!r}, 'utf8'));
            process.stdout.write(JSON.stringify(shape.restorePayloadShape(d, s)));
        """
        out = json.loads(subprocess.run(["node", "-e", code], capture_output=True,
                                        text=True, check=True, encoding="utf-8").stdout)
    check(out.get("priceForecast", "MISSING") is None,
          "explicit priceForecast:null is not overwritten", repr(out.get("priceForecast")))
    check("availableFruits" in out,
          "absent availableFruits IS filled from the static file")

    print()
    if failures:
        print(f"FAILED ({len(failures)}): " + "; ".join(failures))
        return 1
    print("All checks passed")
    return 0


def first_diff(a, b, path=""):
    if type(a) is not type(b):
        return f"at {path or '<root>'}: {type(a).__name__} vs {type(b).__name__}"
    if isinstance(a, dict):
        for k in set(a) | set(b):
            if k not in a:
                return f"at {path}: extra {k!r}"
            if k not in b:
                return f"at {path}: missing {k!r}"
            d = first_diff(a[k], b[k], f"{path}.{k}")
            if d:
                return d
        return ""
    if isinstance(a, list):
        if len(a) != len(b):
            return f"at {path}: length {len(a)} vs {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_diff(x, y, f"{path}[{i}]")
            if d:
                return d
        return ""
    return "" if a == b else f"at {path}: {a!r} vs {b!r}"


if __name__ == "__main__":
    sys.exit(main())
