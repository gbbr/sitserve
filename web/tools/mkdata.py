# Legacy snapshot builder: reads saved search responses, directory pages and location metadata JSON.
# New metadata-fetching work should use JavaScript; see docs/plan.md.
import glob, json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from places import directory, search_places
data_dir, index_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
BASE = "https://www.dhamma.org"
# raw_course_type codes of the course types the mockup covers.
IN_SCOPE = {"10-Day", "10-DayOSC", "10-DaySpecial", "14-DayGratitude", "20-DayOSC", "30-DayOSC", "45-DayOSC",
            "60-DayOSC", "TSC", "10-DayExecutive", "Satipatthana", "3-DayOSC"}
absu = lambda u: (BASE + u) if u and u.startswith("/") else (u or "")
idx = json.load(open(index_path))
pages = [os.path.join(data_dir, f + ".json") for f in ["americas-p1", "americas-later", "long", "sati-short", "asia", "europe"]]
pages += sorted(glob.glob(os.path.join(data_dir, "types", "*.json")))
courses, seen = [], set()
for page in pages:
    for c in json.load(open(page))["courses"]:
        if c["id"] in seen or c["raw_course_type"] not in IN_SCOPE:
            continue
        seen.add(c["id"])
        l = c["location"]
        courses.append({
            "id": c["id"], "start": c["course_start_date"], "end": c["course_end_date"],
            "enroll": c["enrollment_open_date"], "type": c["raw_course_type"],
            "label": c["course_type"], "langs": c["course_instruction_languages"],
            "status": [{k: s[k] for k in ("type", "label", "status", "color")} for s in c["status"]],
            "comments": c["comments"] or "",
            "apply": c["app_page_url"] or absu(c["trans_apply_link_url"]),
            "loc": {
                "id": l["id"], "subId": l["sub_location_id"], "name": l["dhamma_name"].strip(), "meaning": l["dhamma_name_meaning"] or "",
                "state": l.get("state") or "", "country": l.get("country") or "",
                "center": l["center_noncenter"] == "center", "cc": l["country_iso_code"],
                "place": l["city_province_country"], "venue": l["sub_location"] or "",
                "photo": absu(l["sub_loc_image"] or l["header_image_path"]),
                "web": l["website_url"] or "", "schedule": absu(l["schedule_url"]),
            },
        })
location_regions, region_depth = directory(os.path.join(data_dir, "directory.html"))
centers = {l["id"]: l["center"] for l in idx["locations"]}
counts = {}
for regions in location_regions.values():
    for r in regions:
        counts[r] = counts.get(r, 0) + 1
def tag(kind, id, texts):
    if kind == "region":
        code = texts[2] if len(texts) > 2 and texts[2] else ""
        depth = region_depth.get(id, 2)
        if depth == 0: return "world"
        if depth == 1: return "continent"
        if re.fullmatch(r"[A-Z]{2}", code): return "country"
        if "." in code: return "state"
        return "region"
    if kind == "location":
        return "center" if centers.get(id, True) else "non-center"
    return {"state": "state", "sublocation": "venue"}[kind]
places = []
for e in search_places(os.path.join(data_dir, "search.html")):
    kind, id = e["id"]
    texts = list(dict.fromkeys(t for t in e["texts"] if t))
    places.append([kind, id, e["text"], texts, tag(kind, id, e["texts"]), counts.get(id, 0) if kind == "region" else 0])
dump = lambda v: json.dumps(v, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
with open(out, "w") as fh:
    fh.write("// Sample data for mockup.html, from dhamma.org on 2026-11-13.\n\n")
    fh.write("// Courses of the types the page covers, trimmed to the fields it uses.\n")
    fh.write("const SAMPLE_COURSES = " + dump(courses) + ";\n\n")
    fh.write("// The course search box's places: [kind, id, text, search texts, tag, number of locations].\n")
    fh.write("const PLACES = " + dump(places) + ";\n\n")
    fh.write("// Each location's enclosing regions, outermost first, from the locations directory.\n")
    fh.write("const LOCATION_REGIONS = " + dump({str(k): v for k, v in location_regions.items()}) + ";\n")
print(len(courses), "courses,", len(places), "places ->", out, os.path.getsize(out), "bytes")
