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
            # an edge may be used up to its neighbour's tangent point when that neighbour can't be rounded itself (a curve starts there);
            # next to another sharp corner each takes half
            cu = lu if not pts[(i - 2) % n][2] or (not closed and i - 1 == 0) else lu / 2
            cv = lv if not pts[(i + 2) % n][2] or (not closed and i + 1 == n - 1) else lv / 2
            cos = max(-1.0, min(1.0, ux * vx + uy * vy))
            theta = math.acos(cos)  # the angle between the two edges, 0..pi
            if lu < 1e-6 or lv < 1e-6 or theta < 1e-3 or theta > math.pi - 1e-3:
                ok = False
        if not ok:
            out.append([x, y, on])
            continue
        half = theta / 2
        t = min(radius / math.tan(half), cu, cv)  # how far from the corner the arc starts
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


def find_rounded(pts, closed, i, tol=3.0):
    """If points i..i+3 are a round corner made by round_points (on, handle, handle, on, with the handles along the two straight
    edges), return (corner x, corner y) where those edges would meet; else None."""
    n = len(pts)
    if n < 5 or (not closed and not (1 <= i <= n - 5)):
        return None
    p0, t1, c1, c2, t2, pn = (pts[(i + k) % n] for k in (-1, 0, 1, 2, 3, 4))
    if not (p0[2] and t1[2] and t2[2] and pn[2]) or c1[2] or c2[2]:
        return None
    d1 = (t1[0] - p0[0], t1[1] - p0[1])
    d2 = (t2[0] - pn[0], t2[1] - pn[1])
    l1, l2 = math.hypot(*d1), math.hypot(*d2)
    det = d1[0] * d2[1] - d1[1] * d2[0]
    if l1 < 1e-6 or l2 < 1e-6 or abs(det) < 1e-3 * l1 * l2:
        return None
    w = (t2[0] - t1[0], t2[1] - t1[1])
    s = (w[0] * d2[1] - w[1] * d2[0]) / det
    u = (w[0] * d1[1] - w[1] * d1[0]) / det
    if s <= 0 or u <= 0:
        return None
    if abs((c1[0] - t1[0]) * d1[1] - (c1[1] - t1[1]) * d1[0]) / l1 > tol or abs((c2[0] - t2[0]) * d2[1] - (c2[1] - t2[1]) * d2[0]) / l2 > tol:
        return None
    return (t1[0] + d1[0] * s, t1[1] + d1[1] * s)


def sharpen_points(pts, closed, picked):
    """Turn the round corners that touch a picked index back into sharp ones. Returns (points, indexes of the restored corners)."""
    n = len(pts)
    arcs = {}
    used = set()
    for i in range(n):
        idx = {(i + k) % n for k in range(4)}
        if not (idx & picked) or idx & used:
            continue
        c = find_rounded(pts, closed, i)
        if c:
            arcs[i] = c
            used |= idx
    out, corners = [], []
    for i in range(n):
        if i in arcs:
            corners.append(len(out))
            out.append(_pt(arcs[i], 1))
        elif i not in used:
            out.append(list(pts[i]))
    return out, corners
