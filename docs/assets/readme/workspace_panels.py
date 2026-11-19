"""Render README panels using the typography and surfaces of the ruPro hero."""
from html import escape

CHAPTERS = {
    "console": ("Mission", "control.", "Your team. Every decision in view.", "Run inspector", ["Observe activity", "Inspect evidence", "Review controls"]),
    "quick-start": ("From zero", "to Ruflo.", "Choose a path. Initialize. Start building.", "Getting started", ["Install Ruflo", "Initialize a project", "Start building"]),
    "capabilities": ("One harness.", "Many minds.", "Teams, memory and tools working together.", "Agent workspace", ["Coordinate agents", "Recall context", "Verify results"]),
    "federation": ("Local agents.", "Shared intent.", "Work across machines with identity and policy.", "Federation", ["Identify the sender", "Apply policy", "Exchange a message"]),
    "documentation": ("Understand.", "Then build.", "Explore the guides. Inspect the evidence.", "Documentation", ["Explore the guides", "Reproduce a result", "Verify the evidence"]),
    "support": ("Build what", "comes next.", "Join the people moving the ecosystem forward.", "Community", ["Connect", "Contribute", "Create"]),
}
ICONS = {
    "terminal": "M3 5h18v15H3z M6 9l3 3-3 3m6 0h5",
    "grid": "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    "chat": "M3 4h14v11H8l-5 4z M20 8h2v14l-5-4h-5",
    "review": "M7 5H4v16h16V5h-3 M8 3h8v5H8z M8 13l3 3 5-5",
    "folder": "M2 6h7l3 3h10v12H2z M7 12v5m4-5v3m4-3v6",
    "play": "M6 3l15 9-15 9z",
    "download": "M12 3v13m-5-5 5 5 5-5 M3 19v2h18v-2",
    "history": "M4 7v5h5 M5 10a8 8 0 1 1 0 6 M12 7v6l4 2",
    "memory": "M3 6l9-4 9 4-9 4z M3 11l9 4 9-4 M3 16l9 4 9-4",
    "routing": "M3 12h5l5-6h7m-4-3 4 3-4 3 M8 12l5 6h7m-4-3 4 3-4 3",
}
CAPABILITIES = {
    "card-swarm": ("Agent teams","Coordinate specialized agents.","Share tasks and context.","chat"),
    "card-memory": ("Persistent memory","Retrieve useful context.","Carry knowledge across sessions.","memory"),
    "card-learning": ("Learning loops","Capture successful patterns.","Use feedback on future tasks.","history"),
    "card-security": ("Security controls","Inspect inputs and tool access.","Keep decisions auditable.","review"),
    "card-plugins": ("Plugin ecosystem","Add plugins, skills and tools.","Build the setup your team needs.","grid"),
    "card-routing": ("Models and routing","Connect model providers.","Route work through your harness.","routing"),
}
def text(x,y,label,size,fill="#f6f4fc",weight=400,tracking=0,extra=""):
    return f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" letter-spacing="{tracking}" fill="{fill}" {extra}>{escape(label)}</text>'

def box(x,y,w,h,fill,stroke="none",radius=8):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}"/>'

def icon(x,y,name):
    return box(x,y,36,36,"#191626","#514067",9)+f'<path transform="translate({x+6} {y+6})" d="{ICONS[name]}" fill="none" stroke="#d1beff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'

def chrome(w,h,title,desc,body):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc">
<title id="title">{escape(title)}</title><desc id="desc">{escape(desc)}</desc>
<defs><linearGradient id="heading"><stop stop-color="#e0d4ff"/><stop offset=".55" stop-color="#ac8fff"/><stop offset="1" stop-color="#edbaff"/></linearGradient></defs>
<style>@media(prefers-reduced-motion:no-preference){{.draw{{animation:draw 5.2s ease-in-out infinite;transform-box:fill-box;transform-origin:left center}}.focus{{animation:focus 5.2s ease-in-out infinite}}@keyframes draw{{0%{{transform:scaleX(.15)}}55%,100%{{transform:scaleX(1)}}}}@keyframes focus{{0%,100%{{opacity:.6}}45%,75%{{opacity:1}}}}}}</style>
<g font-family="Inter,Arial,sans-serif">
{body}
</g></svg>
'''

def render_panel(path):
    """Return False for content whose original illustration needs a themed frame."""
    n=path.stem
    if path.parent.name == "icons" or n.startswith("console-icon-"):
        svg=path.read_text()
        for old,new in [("#142730","#191626"),("#85dcea","#d1beff"),("#bd9bf8","#d1beff"),('stroke-opacity=".42"','stroke-opacity=".72"')]:
            svg=svg.replace(old,new)
        path.write_text(svg)
        return True
    if path.parent.name == "readme" and n in CHAPTERS:
        first,second,subtitle,tab,rows=CHAPTERS[n]
        body=box(0,0,960,234,"#0c0f14")
        body+=text(26,34,"RUFLO · "+tab.upper(),13,"#bca6ff",700,1.6)
        body+=text(24,98,first,49,weight=700,tracking=-1.8)+text(24,150,second,49,"url(#heading)",700,-1.8)
        body+=text(26,196,subtitle,17,"#b3bdcc")
        body+=box(520,10,430,214,"#0d0c14","#3b304f",14)
        for x,c in [(537,"#ac817c"),(548,"#c3a66d"),(559,"#83ae97")]:
            body+=f'<circle cx="{x}" cy="30" r="3" fill="{c}"/>'
        body+=text(625,34,"Ruflo   /   "+tab,13,"#c6bddd")+box(521,46,428,1,"#22202a",radius=0)
        for i,row in enumerate(rows):
            y=59+i*51
            body+=box(536,y,398,42,"#191626" if i==0 else "#121119","#282631",8)
            body+=f'<circle cx="554" cy="{y+21}" r="3" fill="#b191ff"/>'
            body+=text(568,y+27,row,17)
            body+=f'<g class="draw" style="animation-delay:{-i*.55}s">'+box(854,y+19,56-i*10,4,"#a88bdf",radius=2)+'</g>'
        out=chrome(960,234,first+" "+second,subtitle,body)
    elif n in CAPABILITIES:
        title,first,second,symbol=CAPABILITIES[n]
        body=box(1,1,446,153,"#0d0c14","#3b304f",13)+icon(17,17,symbol)
        body+=text(68,32,"RUFLO · CAPABILITY",12,"#bca6ff",700,1.4)
        body+=text(67,68,title,29,"url(#heading)",700,-.8)
        body+=text(68,100,first,17,"#b3bdcc")+text(68,124,second,17,"#b3bdcc")
        body+='<g class="draw">'+box(68,139,45,2,"#b191ff",radius=1)+'</g>'
        out=chrome(448,155,title,first+" "+second,body)
    else:
        return False
    path.write_text(out)
    return True
