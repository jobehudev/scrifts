"""Round corners, like Illustrator's Live Corners: a sharp corner between two straight edges becomes a circular arc.
Pure geometry on [x, y, on-curve] lists so it can be tested without FontForge. (FontForge has no fillet call.)"""
import math


def round_points(pts, closed, picked, radius, kind="round", quadratic=False):
    """`pts` as [x, y, on] (cubic), `picked` the indexes to round. Only on-curve points whose two neighbours are
    on-curve too (both edges straight) are rounded; others stay. The radius shrinks to fit short edges.
    kind: "round" (an arc), "inverted" (the arc bulging into the corner, Illustrator's Inverted Round) or "chamfer" (a straight cut)."""
    n = len(pts)
    out = []
    for i, (x, y, on) in enumerate(pts):
        ok = i in picked and on and (closed or 0 < i < n - 1)
        if ok:
            a, b = pts[(i - 1) % n], pts[(i + 1) % n]
            ok = bool(a[2] and b[2])
        if ok:
            ux, uy, lu = _unit(a, x, y)
            vx, vy, lv = _unit(b, x, y)
            cos = max(-1.0, min(1.0, ux * vx + uy * vy))
            theta = math.acos(cos)  # the angle between the two edges, 0..pi
            if lu < 1e-6 or lv < 1e-6 or theta < 1e-3 or theta > math.pi - 1e-3:
                ok = False
        if not ok:
            out.append([x, y, on])
            continue
        half = theta / 2
        t = min(radius / math.tan(half), lu / 2, lv / 2)  # how far from the corner the arc starts
        r = t * math.tan(half)
        h = 4 / 3 * math.tan((math.pi - theta) / 4) * r  # the cubic handle for that arc
        t1 = (x + ux * t, y + uy * t)
        t2 = (x + vx * t, y + vy * t)
        if quadratic and kind != "chamfer":  # TrueType: one control point per curve, where the two edge lines meet
            q = (x, y) if kind == "round" else _mirror((x, y), t1, t2)
            out += [_pt(t1, 1), _pt(q, 0), _pt(t2, 1)]
            continue
        c1 = (t1[0] - ux * h, t1[1] - uy * h)
        c2 = (t2[0] - vx * h, t2[1] - vy * h)
        if kind == "chamfer":
            out += [_pt(t1, 1), _pt(t2, 1)]
            continue
        if kind == "inverted":  # the same arc mirrored across the line between its ends
            c1, c2 = _mirror(c1, t1, t2), _mirror(c2, t1, t2)
        out += [_pt(t1, 1), _pt(c1, 0), _pt(c2, 0), _pt(t2, 1)]
    return out


def _unit(a, x, y):
    dx, dy = a[0] - x, a[1] - y
    d = math.hypot(dx, dy)
    return (dx / d, dy / d, d) if d else (0.0, 0.0, 0.0)


def _pt(p, on):
    return [round(p[0]), round(p[1]), on]


def _mirror(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    k = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
    fx, fy = a[0] + k * dx, a[1] + k * dy  # the foot of the perpendicular
    return (2 * fx - p[0], 2 * fy - p[1])
