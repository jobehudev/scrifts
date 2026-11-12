import sys, pathlib, math
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
from corners import round_points

SQ = [[0, 0, 1], [0, 100, 1], [100, 100, 1], [100, 0, 1]]


def test_square_corner_becomes_a_quarter_circle():
    out = round_points(SQ, True, {2}, 20)
    assert len(out) == 7
    assert out[2:6] == [[80, 100, 1], [91, 100, 0], [100, 91, 0], [100, 80, 1]]  # 4/3*tan(pi/8)*20 = 11.05 handle


def test_all_corners_and_short_edges_clamp():
    out = round_points(SQ, True, {0, 1, 2, 3}, 500)  # radius far too big: half an edge at most
    assert len(out) == 16 and all(0 <= x <= 100 and 0 <= y <= 100 for x, y, _ in out)
    assert [0, 50, 1] in out


def test_curves_open_ends_and_unpicked_stay():
    assert round_points(SQ, True, set(), 10) == SQ
    line = [[0, 0, 1], [50, 50, 1], [100, 0, 1]]
    assert len(round_points(line, False, {0, 2}, 10)) == 3  # the ends of an open path are not corners
    curved = [[0, 0, 1], [10, 50, 0], [50, 90, 0], [100, 100, 1], [100, 0, 1]]
    assert round_points(curved, True, {0}, 10)[0] == [0, 0, 1]  # a neighbour with a handle: left alone


def test_chamfer_and_inverted():
    assert round_points(SQ, True, {2}, 20, "chamfer")[2:4] == [[80, 100, 1], [100, 80, 1]]
    assert round_points(SQ, True, {2}, 20, "inverted")[2:6] == [[80, 100, 1], [80, 89, 0], [89, 80, 0], [100, 80, 1]]  # bulges into the corner


def test_quadratic_arc_is_one_control_point():
    assert round_points(SQ, True, {2}, 20, "round", True)[2:5] == [[80, 100, 1], [100, 100, 0], [100, 80, 1]]
