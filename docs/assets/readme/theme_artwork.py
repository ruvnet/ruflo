"""Apply ruPro card styling to the artwork embedded in the root README.

Run after regenerating artwork. Terminal recordings retain their captured colors.
"""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

from workspace_panels import render_panel

ROOT = Path(__file__).resolve().parents[3]
README = ROOT / "README.md"
VIOLET = "#bd9bf8"
CYAN = "#85dcea"
COLORS = {
    **dict.fromkeys("#27eaff #29d9ed #42e8ff #24e5f3 #5de4f2 #61dfcc #51e5d0 #ffe338 #65f2b5 #6ee7b7 #72dfff #9af9dd #7ef0cf #72dbde #35bfcb".split(), CYAN),
    **dict.fromkeys("#ff168f #ff45a1 #ff75b9 #ffe32e #ffe64c #ffe649 #ffae82 #f7b08a #bf9cff #bb92ff #ffb371 #ad99ff #ee9862 #ffae71 #f6cf63 #b89342 #f7d884".split(), VIOLET),
    **dict.fromkeys("#ffe4a0 #e6cc87 #f1eaff #e9d7cc".split(), "#dfcef8"),
    **dict.fromkeys("#181821 #231820 #21192f #241b23".split(), "#211b2e"),
    **dict.fromkeys("#202016 #0c2a22 #0c2330 #0b1726 #182640".split(), "#142730"),
    **dict.fromkeys("#101018 #0b111d #101827".split(), "#0d111d"),
    "#f5f3e8": "#f6f5fb", "#405575": "#584d69", "#5b769d": "#776487",
    "#29e9bd": "#bad2ef", "#b2c4d9": "#c0bbcd",
}

def embedded_paths():
    markdown = README.read_text()
    urls = re.findall(r'<img\b[^>]*?\bsrc="([^"]+\.svg)"|!\[[^\]]*\]\(([^)]+\.svg)\)', markdown)
    for html, markdown_url in urls:
        url = re.sub(r'^https://raw\.githubusercontent\.com/ruvnet/ruflo/[^/]+/', '', html or markdown_url)
        path = ROOT / url
        if path.is_file() and not path.name.startswith("rupro-"):
            yield path

def apply_theme(path):
    # Product badges use their own palettes and animated icons.
    if path.parent.name == "badges" or path.stem in {"rupro-explore", "rupro-demo"}:
        return
    if render_panel(path):
        return
    svg = path.read_text()
    if 'id="readme-card-trim"' in svg:
        return
    _, _, width, height = map(float, ET.fromstring(svg).attrib['viewBox'].split())
    recording = path.name in {'ruflo-tui-compact.svg', 'ruflo-console-theme-compact.svg'}
    if not recording:
        svg = re.sub(r'#[a-fA-F0-9]{6}\b', lambda m: COLORS.get(m[0].lower(), m[0]), svg)
        svg = svg.replace('stroke-dasharray:12 40;animation:flow 5s', 'stroke-dasharray:12 40;animation:flow 6s')
        svg = svg.replace('animation:flicker 13s linear infinite', 'animation:pulse 6s ease-in-out infinite').replace('animation:flicker 17s 3s linear infinite','animation:pulse 6s 2s ease-in-out infinite')
    if width <= 48:
        trim = f'<rect x=".6" y=".6" width="{width-1.2:g}" height="{height-1.2:g}" rx="8" fill="none" stroke="{VIOLET}" stroke-opacity=".42"/>'
    elif path.parent.name == 'badges':
        # These cards already have a full frame and a moving baseline.
        svg = svg.replace('7s linear infinite', '6s linear infinite')
        trim = ''
    else:
        pad = 8 if width < 600 else 14
        length = width - 2 * pad
        y = height - 2
        trim = f'''<style>@media(prefers-reduced-motion:no-preference){{.readme-trace{{animation:readmeTrace 6s linear infinite}}@keyframes readmeTrace{{to{{stroke-dashoffset:-100}}}}}}</style>
<rect x="1" y="1" width="{width-2:g}" height="{height-2:g}" rx="8" fill="none" stroke="{VIOLET}" stroke-opacity=".48"/>
<path d="M{pad} {y:g}h{length:g}" stroke="{CYAN}" stroke-opacity=".18"/>
<path class="readme-trace" d="M{pad} {y:g}h{length:g}" pathLength="100" stroke="{CYAN}" stroke-width="1.5" stroke-dasharray="12 88"/>'''
    path.write_text(svg.replace('</svg>', f'<g id="readme-card-trim">{trim}</g>\n</svg>', 1) if svg.count('</svg>')==1 else svg[:svg.rindex('</svg>')]+f'<g id="readme-card-trim">{trim}</g>\n</svg>\n')

if __name__ == '__main__':
    for asset in sorted(set(embedded_paths())):
        apply_theme(asset)
