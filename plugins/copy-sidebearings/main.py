def run(font, ctx, params):
    model = ctx.glyph(params["model"].strip())
    if model is None:
        raise ValueError(f"The model letter {params['model']!r} isn't in this font.")
    lsb, rsb = round(model.left_side_bearing), round(model.right_side_bearing)  # FontForge takes whole units
    done, missing = [], []
    for token in params["targets"].split():
        g = ctx.glyph(token)
        if g is None or g.glyphname == model.glyphname:
            missing.append(token)
            continue
        ctx.undoable(g)
        if params["left"]:
            g.left_side_bearing = lsb
        if params["right"]:
            g.right_side_bearing = rsb
        done.append(g.glyphname)
    ctx.log(f"{model.glyphname} has {lsb} left and {rsb} right. Applied to: {' '.join(done) or 'nothing'}.")
    if missing:
        ctx.log(f"Skipped (not in the font, or the model itself): {' '.join(missing)}")
