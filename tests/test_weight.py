import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
from weight import offsets

CW = [[0, 0, 1], [0, 100, 1], [100, 100, 1], [100, 0, 1]]  # clockwise outer (y up)


def test_square_grows_by_half_the_delta_on_every_side():
    m = offsets(CW, True, 10)
    assert [(round(dx), round(dy)) for dx, dy in m] == [(-5, -5), (-5, 5), (5, 5), (5, -5)]
    assert [(round(dx), round(dy)) for dx, dy in offsets(CW, True, -10)] == [(5, 5), (5, -5), (-5, -5), (-5, 5)]


def test_a_hole_shrinks_when_the_ink_grows():
    hole = list(reversed(CW))  # counter-clockwise
    assert all(abs(abs(dx) - 5) < 1e-9 and abs(abs(dy) - 5) < 1e-9 for dx, dy in offsets(hole, True, 10))
    # each corner of the hole moves toward the middle of the hole
    for (x, y, _), (dx, dy) in zip(hole, offsets(hole, True, 10)):
        assert (x + dx - 50) ** 2 + (y + dy - 50) ** 2 < (x - 50) ** 2 + (y - 50) ** 2


def test_handles_follow_their_point_and_no_point_is_added():
    circle = [[0, 50, 1], [0, 78, 0], [22, 100, 0], [50, 100, 1], [78, 100, 0], [100, 78, 0], [100, 50, 1], [100, 22, 0], [78, 0, 0], [50, 0, 1], [22, 0, 0], [0, 22, 0]]
    m = offsets(circle, True, 10)
    assert len(m) == len(circle)
    assert m[1] == m[0] and m[2] == m[3]  # the handles on either side of a point move with it
    assert abs(m[0][0] + 5) < 1e-9 and abs(m[0][1]) < 1e-9  # the left-most point moves out by 5


def test_sharp_corner_is_capped():
    spike = [[0, 0, 1], [50, 200, 1], [100, 0, 1]]  # clockwise spike pointing up
    dx, dy = offsets(spike, True, 10)[1]
    assert (dx * dx + dy * dy) ** 0.5 <= 5 * 3 + 1e-9
