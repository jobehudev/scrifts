"""Which names and style bits make apps pair Regular/Bold/Italic correctly.

Pure naming rules (stdlib only, imported by the server and the worker). Only
Regular, Bold, Italic and Bold Italic share a family under name ID 1; every
other style (Medium, Light...) is its own family under ID 1, with the real
family in ID 16 and the style in ID 17 (typographic names).
"""

BOLD, ITALIC, REGULAR = 0x20, 0x01, 0x40  # OS/2 fsSelection bits; head.macStyle uses bit 0 bold, bit 1 italic
BOLD_WEIGHT = 700


def style_linking(family: str, style: str, weight: float, italic: bool = False) -> dict:
    """Arguments for set_font_info: the style bits and the four family/style names.

    `weight` 400 is Regular and 700 is Bold; any other weight is a standalone
    family named "<family> <style>" whose ID 2 is Regular (or Italic)."""
    bold = round(weight) == BOLD_WEIGHT
    ribbi = bold or round(weight) == 400
    if ribbi:
        sub = ("Bold Italic" if italic else "Bold") if bold else ("Italic" if italic else "Regular")
        names = {"Family": family, "SubFamily": sub, "Preferred Family": "", "Preferred Styles": ""}
    else:
        sub = "Italic" if italic else "Regular"
        names = {"Family": f"{family} {style}", "SubFamily": sub, "Preferred Family": family, "Preferred Styles": style}
    stylemap = (BOLD if bold else 0) | (ITALIC if italic else 0) or REGULAR
    mac = (1 if bold else 0) | (2 if italic else 0)
    return {"fields": {"os2_stylemap": stylemap, "macstyle": mac}, "names": names}
