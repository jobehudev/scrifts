"""A stroke is an ordinary open path whose contour name says how thick it is: "~stroke 80 round round"
(width in font units, cap, join). The name is saved in the .sfd, so a skeleton survives save and reopen
and stays editable point by point. FontForge does the stroking itself (layer.stroke) when the outline is
drawn for other views, when a font is generated, and when the stroke is expanded for good.
"""
from typing import NamedTuple

PREFIX = "~stroke"
CAPS = ("butt", "round", "square")
JOINS = ("miter", "round", "bevel")


class Stroke(NamedTuple):
    width: float
    cap: str = "round"
    join: str = "round"


def mark(width: float, cap: str = "round", join: str = "round") -> str:
    return f"{PREFIX} {width:g} {cap} {join}"


def parse(name: str | None) -> Stroke | None:
    """The stroke settings a contour name carries, or None for an ordinary contour."""
    parts = (name or "").split()
    if len(parts) < 2 or parts[0] != PREFIX:
        return None
    try:
        width = float(parts[1])
    except ValueError:
        return None
    cap = parts[2] if len(parts) > 2 else "round"
    join = parts[3] if len(parts) > 3 else "round"
    if width <= 0 or cap not in CAPS or join not in JOINS:
        return None
    return Stroke(width, cap, join)
