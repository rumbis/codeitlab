#!/usr/bin/env python3
"""Generate the committed CodeItLab icon set (requires Pillow and macOS sips/iconutil).

Original artwork: near-black body, phosphor-green ring with a cyan node core.
No CodeItLab or Matrix trademarks are used.

Usage:
  python3 -m pip install pillow
  python3 apps/desktop/scripts/generate-codeitlab-icons.py
"""

import math
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

NEAR_BLACK = (5, 8, 10)
BODY_TOP = (11, 18, 20)
BODY_BOTTOM = (3, 5, 6)
GREEN = (61, 255, 158)
CYAN = (34, 211, 238)
GREEN_DIM = (61, 255, 158, 40)
CYAN_DIM = (34, 211, 238, 34)

SS = 4  # supersampling factor


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        img.putpixel(
            (0, y),
            (
                round(top[0] + (bottom[0] - top[0]) * t),
                round(top[1] + (bottom[1] - top[1]) * t),
                round(top[2] + (bottom[2] - top[2]) * t),
            ),
        )
    return img.resize((size, size))


def draw_grid(img, body_box, color, step, width=1):
    """Faint technical grid clipped to the body."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = body_box
    x = x0
    while x <= x1:
        d.line((x, y0, x, y1), fill=color, width=width)
        x += step
    y = y0
    while y <= y1:
        d.line((x0, y, x1, y), fill=color, width=width)
        y += step
    img.alpha_composite(layer)


def draw_scanlines(img, body_box, color, step, width=1):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = body_box
    y = y0
    while y <= y1:
        d.line((x0, y, x1, y), fill=color, width=width)
        y += step
    img.alpha_composite(layer)


def arc_points(cx, cy, r, start_deg, end_deg, count=240):
    pts = []
    for i in range(count + 1):
        a = math.radians(start_deg + (end_deg - start_deg) * i / count)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def draw_mark(draw, cx, cy, scale, primary, secondary, glow_layer=None):
    """Ring + hexagonal core + circuit trace. `scale` is the body size in px."""
    ring_r = scale * 0.235
    ring_w = max(2, int(scale * 0.062))
    # Open the ring at the top-right so the cyan node reads as a connection.
    pts = arc_points(cx, cy, ring_r, -62, 292, count=320)
    draw.line(pts, fill=primary, width=ring_w, joint="curve")
    for p in (pts[0], pts[-1]):
        draw.ellipse(
            (p[0] - ring_w / 2, p[1] - ring_w / 2, p[0] + ring_w / 2, p[1] + ring_w / 2),
            fill=primary,
        )

    # Hexagonal core in cyan.
    core_r = scale * 0.105
    hex_pts = []
    for i in range(6):
        a = math.radians(-90 + i * 60)
        hex_pts.append((cx + core_r * math.cos(a), cy + core_r * math.sin(a)))
    draw.polygon(hex_pts, outline=secondary, width=max(2, int(scale * 0.028)))

    # Circuit trace from the core through the ring gap to a terminal pad.
    gap_angle = math.radians(-62)
    sx = cx + core_r * math.cos(gap_angle)
    sy = cy + core_r * math.sin(gap_angle)
    ex = cx + scale * 0.335 * math.cos(gap_angle)
    ey = cy + scale * 0.335 * math.sin(gap_angle)
    trace_w = max(2, int(scale * 0.026))
    draw.line((sx, sy, ex, ey), fill=secondary, width=trace_w)
    pad = scale * 0.034
    draw.ellipse((ex - pad, ey - pad, ex + pad, ey + pad), fill=secondary)

    if glow_layer is not None:
        gd = ImageDraw.Draw(glow_layer)
        gd.line(pts, fill=primary + (150,), width=int(ring_w * 2.1), joint="curve")
        gd.polygon(hex_pts, outline=secondary + (130,), width=int(scale * 0.05))


def render_body(size, safe_inset=0, radius_ratio=0.225, dev=False):
    """Render one square icon at `size` px with optional macOS safe-area inset."""
    S = size * SS
    inset = safe_inset * SS
    body = S - inset * 2
    radius = round(body * radius_ratio)

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    body_img = Image.new("RGBA", (body, body), (0, 0, 0, 0))
    grad = vertical_gradient(body, BODY_TOP, BODY_BOTTOM).convert("RGBA")
    body_img.alpha_composite(grad)

    # Ambient center glow.
    glow = Image.new("RGBA", (body, body), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx = body / 2
    cy = body / 2
    primary = CYAN if dev else GREEN
    secondary = GREEN if dev else CYAN
    for i in range(26, 0, -1):
        r = body * 0.52 * i / 26
        alpha = int(22 * (1 - i / 26) ** 2)
        gd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=primary + (alpha,))
    body_img.alpha_composite(glow)

    body_box = (0, 0, body - 1, body - 1)
    if dev:
        draw_grid(body_img, body_box, CYAN_DIM, step=max(8, body // 18), width=max(1, SS // 2))
    else:
        draw_grid(body_img, body_box, GREEN_DIM, step=max(8, body // 14), width=max(1, SS // 2))
    draw_scanlines(body_img, body_box, (0, 0, 0, 26), step=max(3, body // 120), width=SS)

    # Mark.
    mark = Image.new("RGBA", (body, body), (0, 0, 0, 0))
    md = ImageDraw.Draw(mark)
    glow_mark = Image.new("RGBA", (body, body), (0, 0, 0, 0))
    draw_mark(md, cx, cy, body, primary, secondary, glow_mark)
    glow_mark = glow_mark.filter(ImageFilter.GaussianBlur(body * 0.035))
    body_img.alpha_composite(glow_mark)
    body_img.alpha_composite(mark)

    # Inner hairline border.
    bd = ImageDraw.Draw(body_img)
    bd.rounded_rectangle(
        (SS, SS, body - SS, body - SS),
        radius=radius - SS,
        outline=primary + (70,),
        width=max(1, SS),
    )

    # Clip to the rounded body.
    from PIL import ImageChops

    body_img.putalpha(ImageChops.multiply(body_img.getchannel("A"), rounded_mask(body, radius)))
    img.alpha_composite(body_img, (inset, inset))
    return img.resize((size, size), Image.LANCZOS)


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print("wrote", path)


def make_icns(png_path, icns_path, tmp_root):
    iconset = os.path.join(tmp_root, "codeitlab.iconset")
    os.makedirs(iconset, exist_ok=True)
    src = Image.open(png_path)
    for size in (16, 32, 128, 256, 512):
        src.resize((size, size), Image.LANCZOS).save(
            os.path.join(iconset, f"icon_{size}x{size}.png")
        )
        src.resize((size * 2, size * 2), Image.LANCZOS).save(
            os.path.join(iconset, f"icon_{size}x{size}@2x.png")
        )
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns_path], check=True)
    print("wrote", icns_path)


def main():
    prod = os.path.join(ROOT, "assets", "prod")
    dev = os.path.join(ROOT, "assets", "dev")

    prod_ios = render_body(1024, 0, 0.225, dev=False)
    prod_mac = render_body(1024, 100, 0.225, dev=False)
    prod_universal = render_body(1024, 0, 0.18, dev=False)

    save(prod_ios, os.path.join(prod, "black-ios-1024.png"))
    save(prod_mac, os.path.join(prod, "black-macos-1024.png"))
    save(prod_universal, os.path.join(prod, "black-universal-1024.png"))
    save(prod_universal.resize((180, 180), Image.LANCZOS), os.path.join(prod, "codeitlab-black-web-apple-touch-180.png"))
    save(prod_universal.resize((32, 32), Image.LANCZOS), os.path.join(prod, "codeitlab-black-web-favicon-32x32.png"))
    save(prod_universal.resize((16, 16), Image.LANCZOS), os.path.join(prod, "codeitlab-black-web-favicon-16x16.png"))

    prod_universal.save(
        os.path.join(prod, "codeitlab-black-windows.ico"),
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("wrote", os.path.join(prod, "codeitlab-black-windows.ico"))
    prod_universal.save(
        os.path.join(prod, "codeitlab-black-web-favicon.ico"),
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print("wrote", os.path.join(prod, "codeitlab-black-web-favicon.ico"))

    with tempfile.TemporaryDirectory() as tmp:
        make_icns(os.path.join(prod, "black-macos-1024.png"), os.path.join(prod, "codeitlab.icns"), tmp)

    dev_ios = render_body(1024, 0, 0.225, dev=True)
    dev_mac = render_body(1024, 100, 0.225, dev=True)
    dev_universal = render_body(1024, 0, 0.18, dev=True)
    save(dev_ios, os.path.join(dev, "blueprint-ios-1024.png"))
    save(dev_mac, os.path.join(dev, "blueprint-macos-1024.png"))
    save(dev_universal, os.path.join(dev, "blueprint-universal-1024.png"))
    save(dev_universal.resize((180, 180), Image.LANCZOS), os.path.join(dev, "blueprint-web-apple-touch-180.png"))
    save(dev_universal.resize((32, 32), Image.LANCZOS), os.path.join(dev, "blueprint-web-favicon-32x32.png"))
    save(dev_universal.resize((16, 16), Image.LANCZOS), os.path.join(dev, "blueprint-web-favicon-16x16.png"))
    dev_universal.save(
        os.path.join(dev, "blueprint-windows.ico"),
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("wrote", os.path.join(dev, "blueprint-windows.ico"))
    dev_universal.save(
        os.path.join(dev, "blueprint-web-favicon.ico"),
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print("wrote", os.path.join(dev, "blueprint-web-favicon.ico"))


if __name__ == "__main__":
    main()
