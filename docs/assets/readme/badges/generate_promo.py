"""Regenerate the Ruflo README download and Claude-directory badges from pinned metadata.

The download value is never animated or estimated. Refresh the JSON only after
verifying the canonical ruvnet/ruvnet npm_billion_goal source and its watermark.
Run: python3 docs/assets/readme/badges/generate_promo.py
"""
from pathlib import Path
from html import escape
import json

root = Path(__file__).resolve().parents[4]
badge_dir = Path(__file__).resolve().parent
data = json.loads((root / "data/readme-download-badge.json").read_text())
assert data["schema"] == "ruflo-readme-download-badge/v1"
assert data["source_metric"] == "npm_billion_goal.observed_download_events_lower_bound"
n = data["observed_download_events_lower_bound"]
assert isinstance(n, int) and n > 0
value = f"{n / 1000000:.2f}M"
description = (f"{n:,} observed npm download events since {data['observed_since']}, "
               f"429 package cohort, evidence through {data['baseline_through']}. "
               "Observed lower bound with historical gaps, not unique users or lifetime downloads. "
               "No animated counter increments are claimed.")
common_style = """<style>text{font-family:Arial,Helvetica,sans-serif}
.pulse{animation:pulse 3.5s ease-in-out infinite}
.scan{stroke-dasharray:35 240;animation:scan 7s linear infinite}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
@keyframes scan{to{stroke-dashoffset:-550}}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style>"""
downloads = f"""<svg xmlns="http://www.w3.org/2000/svg" width="300" height="76" viewBox="0 0 300 76" role="img" aria-labelledby="t d">
<title id="t">npm downloads: {value} observed since October 2025</title>
<desc id="d">{escape(description)}</desc>
<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#202016"/><stop offset="1" stop-color="#0b111d"/></linearGradient>
<linearGradient id="line"><stop stop-color="#ffe338"/><stop offset="1" stop-color="#29e9bd"/></linearGradient></defs>
{common_style}
<rect x=".5" y=".5" width="299" height="75" rx="9" fill="url(#bg)" stroke="#ffe338" stroke-opacity=".5"/>
<path d="M57 12V64" stroke="#ffe338" stroke-opacity=".22"/>
<g transform="translate(14 20)" fill="none" stroke="#ffe338" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
<path d="M14 0V24M5 16l9 9 9-9"/><path d="M2 30H26" opacity=".8"/>
</g><circle class="pulse" cx="49" cy="15" r="2.2" fill="#29e9bd"/>
<text x="70" y="17" fill="#b8c2d1" font-size="10" letter-spacing="1.1">NPM DOWNLOADS</text>
<text x="70" y="46" fill="#ffe338" font-size="28" font-weight="700">{value}</text>
<text x="70" y="61" fill="#a8b3c5" font-size="9.3">OBSERVED SINCE OCT 2025</text>
<path d="M9 70H291" stroke="#ffe338" stroke-opacity=".17"/>
<path class="scan" d="M9 70H291" stroke="url(#line)" stroke-width="1.5"/>
</svg>
"""
plugin = f"""<svg xmlns="http://www.w3.org/2000/svg" width="300" height="76" viewBox="0 0 300 76" role="img" aria-labelledby="t d">
<title id="t">Claude plugin directory</title>
<desc id="d">Open the supplied Claude plugin listing. This badge does not claim installation or endorsement.</desc>
<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#241b23"/><stop offset="1" stop-color="#0b111d"/></linearGradient>
<linearGradient id="line"><stop stop-color="#f7b08a"/><stop offset="1" stop-color="#b79cfa"/></linearGradient></defs>
{common_style}
<rect x=".5" y=".5" width="299" height="75" rx="9" fill="url(#bg)" stroke="#f7b08a" stroke-opacity=".53"/>
<path d="M57 12V64" stroke="#f7b08a" stroke-opacity=".24"/>
<g transform="translate(28 37)" fill="none" stroke="#f7b08a" stroke-width="2.3" stroke-linejoin="round" stroke-linecap="round">
<path d="M-12 -5L0 -12L12 -5V9L0 16L-12 9Z"/><path d="M-12 -5L0 3L12 -5M0 3V16"/>
</g><circle class="pulse" cx="49" cy="15" r="2.2" fill="#f7b08a"/>
<text x="70" y="20" fill="#e9d7cc" font-size="12" letter-spacing=".7">CLAUDE PLUGIN</text>
<text x="70" y="46" fill="#f7b08a" font-size="20" font-weight="700">VIEW IN CLAUDE</text>
<text x="70" y="61" fill="#acb5c4" font-size="10">PLUGIN DIRECTORY</text>
<path d="M9 70H291" stroke="#f7b08a" stroke-opacity=".17"/>
<path class="scan" d="M9 70H291" stroke="url(#line)" stroke-width="1.5"/>
</svg>
"""
for name, svg in [("downloads.svg", downloads), ("claude-directory.svg", plugin)]:
    (badge_dir / name).write_text(svg, encoding="utf-8")
    print(f"generated {name}")
