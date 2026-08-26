"""Shared helper for the Lua-side tests: JSON value -> Lua table constructor."""
import math


def lua_literal(v, indent=0):
    """Render a JSON value as a Lua table constructor.

    Empty arrays become the mod's __emptyArray sentinel, since Lua cannot tell
    {} from [] — which is exactly why the encoder has that sentinel.
    """
    pad = "  " * indent
    if v is None:
        return "nil"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        if isinstance(v, float) and math.isnan(v):
            return "0/0"
        if isinstance(v, float) and math.isinf(v):
            return "math.huge" if v > 0 else "-math.huge"
        return repr(v)
    if isinstance(v, str):
        return ('"' + v.replace("\\", "\\\\").replace('"', '\\"')
                .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t") + '"')
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
            for k, val in v.items())
        return "{\n" + items + "\n" + pad + "}"
    raise TypeError(type(v))
