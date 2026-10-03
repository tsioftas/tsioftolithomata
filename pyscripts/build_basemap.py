"""Write jsondata/basemap.json: land and land borders around the collection's localities.

The homepage's place view draws real coastlines behind the specimens. They come from
Natural Earth (public domain), cropped to the localities with a margin and simplified,
so the committed file stays small. Run again when a locality falls outside the box.

    python3 -m pyscripts.build_basemap
"""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent
SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
MARGIN_LON, MARGIN_LAT = 9.0, 6.0
TOLERANCE = 0.04  # degrees


def fetch(name: str) -> dict:
    with urllib.request.urlopen(SOURCE + name, timeout=60) as r:
        return json.load(r)


def bbox() -> tuple[float, float, float, float]:
    locs = json.loads((ROOT / "jsondata/geochronology.json").read_text())["localities"].values()
    lons = [float(l["coords_lon"]) for l in locs if "coords_lon" in l]
    lats = [float(l["coords_lat"]) for l in locs if "coords_lat" in l]
    return min(lons) - MARGIN_LON, min(lats) - MARGIN_LAT, max(lons) + MARGIN_LON, max(lats) + MARGIN_LAT


def clip_ring(ring, box):
    """Sutherland-Hodgman against the four edges of the box."""
    x0, y0, x1, y1 = box
    edges = [(lambda p: p[0] >= x0, lambda a, b: _at_x(a, b, x0)),
             (lambda p: p[0] <= x1, lambda a, b: _at_x(a, b, x1)),
             (lambda p: p[1] >= y0, lambda a, b: _at_y(a, b, y0)),
             (lambda p: p[1] <= y1, lambda a, b: _at_y(a, b, y1))]
    out = ring
    for inside, cross in edges:
        if not out:
            break
        src, out = out, []
        prev = src[-1]
        for cur in src:
            if inside(cur):
                if not inside(prev):
                    out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cross(prev, cur))
            prev = cur
    return out


def _at_x(a, b, x):
    t = (x - a[0]) / (b[0] - a[0])
    return [x, a[1] + t * (b[1] - a[1])]


def _at_y(a, b, y):
    t = (y - a[1]) / (b[1] - a[1])
    return [a[0] + t * (b[0] - a[0]), y]


def simplify(points, tol):
    """Douglas-Peucker."""
    if len(points) < 3:
        return points
    (ax, ay), (bx, by) = points[0], points[-1]
    dx, dy = bx - ax, by - ay
    norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
    far, idx = 0.0, 0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
        if d > far:
            far, idx = d, i
    if far <= tol:
        return [points[0], points[-1]]
    return simplify(points[: idx + 1], tol)[:-1] + simplify(points[idx:], tol)


def rounded(points):
    return [[round(x, 2), round(y, 2)] for x, y in points]


def main():
    box = bbox()
    land = []
    for feature in fetch("ne_50m_land.geojson")["features"]:
        geom = feature["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            ring = clip_ring(poly[0], box)
            if len(ring) > 3:
                # A closed ring starts and ends on one point, which Douglas-Peucker
                # reads as a zero-length baseline; halve it first.
                mid = len(ring) // 2
                ring = simplify(ring[: mid + 1], TOLERANCE)[:-1] + simplify(ring[mid:], TOLERANCE)
            if len(ring) >= 4:
                land.append(rounded(ring))

    x0, y0, x1, y1 = box
    inside = lambda p: x0 <= p[0] <= x1 and y0 <= p[1] <= y1
    borders = []
    for feature in fetch("ne_50m_admin_0_boundary_lines_land.geojson")["features"]:
        geom = feature["geometry"]
        lines = geom["coordinates"] if geom["type"] == "MultiLineString" else [geom["coordinates"]]
        for line in lines:
            run = []
            for p in line + [None]:
                if p is not None and inside(p):
                    run.append(p)
                    continue
                if len(run) > 1:
                    borders.append(rounded(simplify(run, TOLERANCE)))
                run = []

    out = {"bbox": [round(v, 2) for v in box], "land": land, "borders": borders,
           "source": "Natural Earth 1:50m, public domain"}
    (ROOT / "jsondata/basemap.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"{len(land)} land rings, {len(borders)} border lines")


if __name__ == "__main__":
    main()
