"""Bolder / lighter that never adds or removes a point, so masters stay compatible for interpolation.
FontForge's own Change Weight finds stems and rebuilds the outline (a W of 21 points comes back with 34), which
makes interpolating the result with another master impossible. Here every point only moves: on-curve points along
the line that halves the corner they sit in, handles with their on-curve neighbour.
Pure geometry on [x, y, on-curve] lists, so it can be tested without FontForge."""
import math

MITER = 3.0  # a sharp corner would shoot out far; its move is capped at this many times the offset


def _unit(ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    d = math.hypot(dx, dy)
    return (dx / d, dy / d) if d > 1e-9 else None


def offsets(pts, closed, delta):
    """How far each point moves (dx, dy) to make the ink `delta` units thicker (negative: thinner): each edge
    moves delta/2. Outer contours run clockwise and holes counter-clockwise, so the left of the travel direction
    always points away from the ink and the same rule fattens both."""
    n = len(pts)
    half = delta / 2.0
    move = [(0.0, 0.0)] * n
    on = [i for i in range(n) if pts[i][2]]
    if len(on) < 2:
        return move

    def toward(i, step):
        """The nearest other point that is not at this point's place, walking in `step` direction."""
        j = i
        for _ in range(n - 1):
            j = j + step
            if closed:
                j %= n
            elif not 0 <= j < n:
                return None
            if (pts[j][0], pts[j][1]) != (pts[i][0], pts[i][1]):
                return j
        return None

    for i in on:
        p, q = toward(i, -1), toward(i, +1)
        d1 = _unit(pts[p][0], pts[p][1], pts[i][0], pts[i][1]) if p is not None else None  # arriving
        d2 = _unit(pts[i][0], pts[i][1], pts[q][0], pts[q][1]) if q is not None else None  # leaving
        d1, d2 = d1 or d2, d2 or d1
        if not d1:
            continue
        n1, n2 = (-d1[1], d1[0]), (-d2[1], d2[0])  # left normals
        sx, sy = n1[0] + n2[0], n1[1] + n2[1]
        k = 1 + n1[0] * n2[0] + n1[1] * n2[1]  # the move is half * sqrt(2 / k) long: 1 on a straight line, 1.41 on a right angle
        k = max(k, 2 / (MITER * MITER))  # a corner that nearly doubles back would shoot out: cap it
        move[i] = (half * sx / k, half * sy / k)
    # handles follow the on-curve point they hang from (one off-curve between two on-curves: the average of both)
    for i in range(n):
        if pts[i][2]:
            continue
        a = b = None
        j = i
        for _ in range(n):
            j = (j - 1) % n if closed else j - 1
            if not 0 <= j < n:
                break
            if pts[j][2]:
                a = j
                break
        j = i
        for _ in range(n):
            j = (j + 1) % n if closed else j + 1
            if not 0 <= j < n:
                break
            if pts[j][2]:
                b = j
                break
        nxt = (i + 1) % n if closed else i + 1
        prv = (i - 1) % n if closed else i - 1
        alone = 0 <= nxt < n and 0 <= prv < n and pts[nxt][2] and pts[prv][2]  # a quadratic control point
        if alone and a is not None and b is not None:
            move[i] = ((move[a][0] + move[b][0]) / 2, (move[a][1] + move[b][1]) / 2)
        elif 0 <= prv < n and pts[prv][2]:
            move[i] = move[prv]  # first handle of a cubic: with the point before it
        elif 0 <= nxt < n and pts[nxt][2]:
            move[i] = move[nxt]  # second handle: with the point after it
        elif a is not None:
            move[i] = move[a]
    return move
