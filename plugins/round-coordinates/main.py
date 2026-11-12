def run(font, ctx, params):
    glyphs = ctx.glyphs(params["scope"])
    if not glyphs:
        ctx.log("Nothing to do: select a glyph first, or choose 'Every glyph'.")
        return
    if params["scope"] == "selected":
        ctx.undoable(*glyphs)
    step = params["step"]
    n = 0
    for g in glyphs:
        before = [(p.x, p.y) for c in g.foreground for p in c]
        if step > 1:
            # FontForge rounds to whole units, so squeeze the glyph by the step, round, and stretch it back
            g.transform(psMat.scale(1 / step))
            g.round()
            g.transform(psMat.scale(step))
        else:
            g.round()
        if [(p.x, p.y) for c in g.foreground for p in c] != before:
            n += 1
    ctx.log(f"Rounded {n} of {len(glyphs)} glyph(s) to a {step}-unit grid.")
