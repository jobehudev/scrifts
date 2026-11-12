import string


def run(font, ctx, params):
    s = params["scale"]
    made, kept = [], []
    for ch in string.ascii_uppercase:
        cap = ctx.glyph(ch)
        if cap is None or not len(cap.foreground):
            continue
        name = ch.lower() + ".sc"
        if name in font and not params["overwrite"]:
            kept.append(name)
            continue
        g = font[name] if name in font else font.createChar(-1, name)
        g.clear()
        for contour in cap.foreground:
            g.foreground += contour
        g.transform(psMat.scale(s))
        g.width = round(cap.width * s)
        made.append(name)
    ctx.log(f"Made {len(made)} small caps at {round(s * 100)}% size." + (f" Kept {len(kept)} that already existed." if kept else ""))
