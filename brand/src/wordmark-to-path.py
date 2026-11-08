import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
f = TTFont(sys.argv[1]); text = sys.argv[2]; wdth=float(sys.argv[3]); wght=float(sys.argv[4]); track=float(sys.argv[5])
inst = instantiateVariableFont(f, {"wdth": wdth, "wght": wght})
gs = inst.getGlyphSet(); cmap = inst.getBestCmap(); upm = inst['head'].unitsPerEm
asc = inst['OS/2'].sCapHeight; xh = inst['OS/2'].sxHeight
x = 0; paths=[]
for ch in text:
    g = cmap[ord(ch)]; pen = SVGPathPen(gs)
    tp = TransformPen(pen, (1,0,0,-1,x,0)); gs[g].draw(tp)
    paths.append(pen.getCommands()); x += gs[g].width + track
x -= track
print(upm, x, asc, xh, inst['hhea'].ascent, inst['hhea'].descent)
open(sys.argv[6],'w').write(' '.join(paths))
