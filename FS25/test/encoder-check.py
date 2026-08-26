#!/usr/bin/env python
"""Verifies DashboardExport.lua: syntax of the whole file, plus semantic
equivalence of its JSON encoder against a real dashboard_data.json.

The encoder is pure Lua with no FS25 dependencies, so it can be sliced out of
the mod and run under lupa. Round-trip test: real payload -> Lua table ->
encodeJson -> json.loads -> compare with the original.

  pip install lupa
  python encoder-check.py [path-to-dashboard_data.json]
"""
import json
import math
import os
import re
import sys

from lupa import LuaRuntime

HERE = os.path.dirname(os.path.abspath(__file__))
LUA_FILE = os.path.join(HERE, "..", "DashboardExport.lua")
DEFAULT_PAYLOAD = os.path.expanduser(
    r"~/Documents/My Games/FarmingSimulator2025/dashboard_data.json"
)

failures = []


def check(ok, label, detail=""):
    print(("  PASS  " if ok else "  FAIL  ") + label + (f"  {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(label)


def lua_literal(v, indent=0):
    """JSON value -> Lua table constructor. Empty arrays become the mod's
    __emptyArray sentinel, since Lua cannot tell {} from []."""
    pad = "  " * indent
    if v is None:
        return "nil"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return "0/0" if math.isnan(v) else ("math.huge" if v > 0 else "-math.huge")
        return repr(v)
    if isinstance(v, str):
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t") + '"'
    if isinstance(v, list):
        if not v:
            return "{__emptyArray=true}"
        items = ",\n".join(pad + "  " + lua_literal(x, indent + 1) for x in v)
        return "{\n" + items + "\n" + pad + "}"
    if isinstance(v, dict):
        if not v:
            return "{}"
        items = ",\n".join(
            pad + "  [" + lua_literal(k) + "]=" + lua_literal(val, indent + 1)
            for k, val in v.items()
        )
        return "{\n" + items + "\n" + pad + "}"
    raise TypeError(type(v))


def slice_encoder(src):
    """Extract the self-contained encoder block from the mod source."""
    start = src.index("local JSON_ESCAPES")
    end = src.index("-- Empty array sentinel")
    return src[start:end]


def main():
    src = open(LUA_FILE, encoding="utf-8").read()
    print(f"\nDashboardExport.lua — {len(src.splitlines())} lines\n")

    L = LuaRuntime(unpack_returned_tuples=True)
    print(f"Lua: {L.eval('_VERSION')}\n")

    # ── 1. syntax of the ENTIRE mod file ────────────────────────────────────
    print("Syntax")
    fn, err = L.eval("function(s) return load(s) end")(src), None
    if fn is None:
        # re-run to capture the message (load returns nil, msg)
        err = L.eval("function(s) local f, e = load(s); return e end")(src)
    check(fn is not None, "whole file compiles", str(err))

    # ── 2. encoder behaviour ────────────────────────────────────────────────
    print("\nEncoder unit cases")
    enc_src = slice_encoder(src)
    encode = L.execute(enc_src + "\nreturn encodeJson")

    cases = [
        (None, "null"),
        (True, "true"),
        (False, "false"),
        (0, "0"),
        (512, "512"),
        (513, "513"),
        (-7, "-7"),
        (1.5, "1.5"),
        (2.25, "2.25"),
        ("plain", '"plain"'),
        ('quote"inside', '"quote\\"inside"'),
        ("back\\slash", '"back\\\\slash"'),
        ("new\nline", '"new\\nline"'),
        ("tab\there", '"tab\\there"'),
        ("Příliš žluťoučký kůň", '"Příliš žluťoučký kůň"'),
    ]
    for value, expected in cases:
        got = encode(lua_value(L, value))
        check(got == expected, f"encode({value!r})", f"got {got!r}, want {expected!r}")

    # structural cases via Lua literals
    struct = [
        ("{__emptyArray=true}", "[]"),
        ("{}", "{}"),
        ("{1,2,3}", "[1,2,3]"),
        ('{[ "a" ]=1}', '{"a":1}'),
        ("{{1,2},{3,4}}", "[[1,2],[3,4]]"),
        ('{[ "n" ]=0/0}', '{"n":null}'),
        ('{[ "i" ]=math.huge}', '{"i":null}'),
    ]
    build = L.eval("function(s) return load('return ' .. s)() end")
    for literal, expected in struct:
        got = encode(build(literal))
        check(got == expected, f"encode({literal})", f"got {got!r}, want {expected!r}")

    # non-string keys must be skipped in the object branch (documented behaviour)
    got = encode(build('{[ "keep" ]=1, [true]=2}'))
    check(got == '{"keep":1}', "object branch skips non-string keys", f"got {got!r}")

    # ── 3. round-trip against the real payload ──────────────────────────────
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PAYLOAD
    print(f"\nRound-trip vs real payload\n  {path}")
    if not os.path.exists(path):
        print("  SKIP  payload not found")
    else:
        original = json.load(open(path, encoding="utf-8"))
        lua_tbl = build(lua_literal(original))
        out = encode(lua_tbl)
        check(isinstance(out, str) and len(out) > 0, "encoder produced output")
        try:
            reparsed = json.loads(out)
            parsed_ok = True
        except Exception as e:  # noqa: BLE001
            reparsed, parsed_ok = None, False
            check(False, "output is valid JSON", str(e))
        if parsed_ok:
            check(True, "output is valid JSON")
            check(
                normalize(reparsed) == normalize(original),
                "round-trip preserves every value",
                diff_hint(normalize(original), normalize(reparsed)),
            )
            print(f"        payload in : {os.path.getsize(path):,} B")
            print(f"        encoded out: {len(out.encode('utf-8')):,} B")

    print()
    if failures:
        print(f"FAILED ({len(failures)}): " + "; ".join(failures))
        return 1
    print("All checks passed")
    return 0


def lua_value(L, v):
    """Wrap a scalar so it survives the Python->Lua boundary unchanged."""
    if v is None:
        return None
    if isinstance(v, str):
        return L.eval("function(s) return s end")(v)
    return v


def normalize(v):
    """Floats that are whole numbers compare equal to their int form; the
    encoder legitimately writes 5.0 as 5."""
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, float):
        return int(v) if v == int(v) else round(v, 4)
    if isinstance(v, int):
        return v
    if isinstance(v, list):
        return [normalize(x) for x in v]
    if isinstance(v, dict):
        return {k: normalize(x) for k, x in v.items()}
    return v


def diff_hint(a, b, path=""):
    """First differing path, for a readable failure message."""
    if type(a) is not type(b):
        return f"at {path or '<root>'}: {type(a).__name__} vs {type(b).__name__}"
    if isinstance(a, dict):
        for k in set(a) | set(b):
            if k not in a:
                return f"at {path}: extra key {k!r}"
            if k not in b:
                return f"at {path}: missing key {k!r}"
            d = diff_hint(a[k], b[k], f"{path}.{k}")
            if d:
                return d
        return ""
    if isinstance(a, list):
        if len(a) != len(b):
            return f"at {path}: length {len(a)} vs {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = diff_hint(x, y, f"{path}[{i}]")
            if d:
                return d
        return ""
    return "" if a == b else f"at {path}: {a!r} vs {b!r}"


if __name__ == "__main__":
    sys.exit(main())
