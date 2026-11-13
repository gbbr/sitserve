# Reads the directory page's region nesting and the search page's place list.
import json
from html.parser import HTMLParser

class Directory(HTMLParser):
    """Records each location's enclosing regions and each region's nesting depth."""
    def __init__(self):
        super().__init__()
        self.stack = []          # per open div: the region whose children it holds, else None
        self.last_region = None
        self.location_regions = {}
        self.region_depth = {}

    def handle_starttag(self, tag, attrs):
        if tag != 'div':
            return
        a = dict(attrs)
        el_id, classes = a.get('id') or '', (a.get('class') or '').split()
        held = None
        if el_id.startswith('region-') and a.get('data-id'):
            self.last_region = int(a['data-id'])
            self.region_depth[self.last_region] = sum(s is not None for s in self.stack)
        elif 'region-children' in classes:
            held = self.last_region
        elif el_id.startswith('location-') and a.get('data-id'):
            self.location_regions[int(a['data-id'])] = [s for s in self.stack if s is not None]
        self.stack.append(held)

    def handle_endtag(self, tag):
        if tag == 'div' and self.stack:
            self.stack.pop()

def directory(path):
    d = Directory()
    d.feed(open(path).read())
    return d.location_regions, d.region_depth

def search_places(path):
    page = open(path).read()
    i = page.index('viewModel.search_regions(') + len('viewModel.search_regions(')
    arg = page[i:].replace('{text:', '{"text":').replace('children:', '"children":')
    groups, _ = json.JSONDecoder().raw_decode(arg)
    return [c for g in groups for c in g['children']]
