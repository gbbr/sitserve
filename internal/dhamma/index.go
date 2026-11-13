// Package dhamma reads the location and course-type data that www.dhamma.org
// embeds in its course search and maps pages.
package dhamma

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// BaseURL is the dhamma.org origin; relative URLs on the site resolve against it.
const BaseURL = "https://www.dhamma.org"

// Index is the locally cached data that course searches are built from.
type Index struct {
	FetchedAt time.Time `json:"fetched_at"`
	// Locations are the centers and non-centers that hold courses.
	Locations []Location `json:"locations"`
	// Places are everything the course search can be restricted to.
	Places []Place `json:"places"`
	// CourseTypes lists the course types allowed in each search mode, keyed
	// by the search's current_state value ("NewStudents", "OldStudents", …).
	CourseTypes map[string][]CourseType `json:"course_types"`
}

// Location is a center or non-center that holds courses.
type Location struct {
	ID          int     `json:"id"`                     // search ID, as in regions[]=location_<ID>
	Slug        string  `json:"slug"`                   // dhamma.org subdomain, e.g. "dipa"
	Name        string  `json:"name"`                   // e.g. "Dhamma Sukhadā"
	Center      bool    `json:"center"`                 // false for non-centers, whose courses run at rented sites
	Address     string  `json:"address,omitempty"`      // e.g. "Igatpuri, Maharashtra, India"
	CountryCode string  `json:"country_code,omitempty"` // ISO 3166-1 alpha-2
	Lat         float64 `json:"lat,omitempty"`          // Lat and Lng are both zero when unknown.
	Lng         float64 `json:"lng,omitempty"`
	Website     string  `json:"website,omitempty"`
	ScheduleURL string  `json:"schedule_url,omitempty"`
}

// Place is something the course search can be restricted to: a region
// (continent, country, Indian state, …), a state or province, a location, or a
// sublocation (a specific venue). Searches pass it as regions[]=<Kind>_<ID>.
type Place struct {
	Kind string `json:"kind"` // "region", "state", "location" or "sublocation"
	ID   int    `json:"id"`
	Name string `json:"name"` // as listed in the site's search box, e.g. "Alabama, United States"
}

// CourseType is a course type the search accepts in course_type_constraint[].
type CourseType struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`            // e.g. "20-Day"
	Group string `json:"group,omitempty"` // the site's heading for it, e.g. "Long"; only OldStudents types have one
}

// FetchIndex downloads the course search and maps pages and builds an Index
// from the data embedded in them.
func FetchIndex(ctx context.Context, client *http.Client) (*Index, error) {
	searchPage, err := fetch(ctx, client, BaseURL+"/en/courses/search")
	if err != nil {
		return nil, err
	}
	mapsPage, err := fetch(ctx, client, BaseURL+"/en/maps")
	if err != nil {
		return nil, err
	}
	idx, err := parseIndex(searchPage, mapsPage)
	if err != nil {
		return nil, err
	}
	idx.FetchedAt = time.Now().UTC()
	return idx, nil
}

// Save writes the index to path as JSON, atomically replacing any existing file.
func (idx *Index) Save(path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".index-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name()) // fails harmlessly once the file has been renamed
	enc := json.NewEncoder(f)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(idx); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

func fetch(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	return io.ReadAll(resp.Body)
}

// parseIndex builds an Index from the HTML of the course search page and the
// maps page. The two are joined by location subdomain.
func parseIndex(searchPage, mapsPage []byte) (*Index, error) {
	entries, err := parseSearchEntries(searchPage)
	if err != nil {
		return nil, fmt.Errorf("course search page: %w", err)
	}
	courseTypes, err := parseCourseTypes(searchPage)
	if err != nil {
		return nil, fmt.Errorf("course search page: %w", err)
	}
	var positions map[string]struct {
		Lat float64 `json:"latitude,string"`
		Lng float64 `json:"longitude,string"`
	}
	if err := decodeAfter(mapsPage, "position_data =", &positions); err != nil {
		return nil, fmt.Errorf("maps page: %w", err)
	}
	var details map[string]struct {
		IsCenter    bool   `json:"iscenter"`
		Title       string `json:"title"`
		Description string `json:"description"` // HTML of the map pin's info window
	}
	if err := decodeAfter(mapsPage, "location_data =", &details); err != nil {
		return nil, fmt.Errorf("maps page: %w", err)
	}

	idx := &Index{CourseTypes: courseTypes}
	for _, e := range entries {
		idx.Places = append(idx.Places, Place{Kind: e.ID.Kind, ID: e.ID.Num, Name: e.Text})
		if e.ID.Kind != "location" {
			continue
		}
		// For locations, texts[0] is the name and texts[4] the subdomain,
		// which is what the maps page keys its data by.
		l := Location{ID: e.ID.Num, Name: e.text(0), Slug: e.text(4)}
		if d, ok := details[l.Slug]; ok {
			l.Name = strings.TrimSuffix(d.Title, " non-center")
			l.Center = d.IsCenter
			parseDescription(&l, d.Description)
		}
		if p, ok := positions[l.Slug]; ok {
			l.Lat, l.Lng = p.Lat, p.Lng
		}
		idx.Locations = append(idx.Locations, l)
	}
	if len(idx.Locations) == 0 || len(idx.CourseTypes) == 0 {
		return nil, errors.New("no locations or course types found; the page layout may have changed")
	}
	return idx, nil
}

// searchEntry is one option of the course search page's location box, e.g.
//
//	{"id":["location",1442],"texts":["Dhamma Giri","Maharashtra","Igatpuri","Giri","giri","MH"],"text":"Dhamma Giri, Igatpuri, Maharashtra, India"}
type searchEntry struct {
	ID    entryID   `json:"id"`
	Texts []*string `json:"texts"`
	Text  string    `json:"text"`
}

// text returns e.Texts[i], or "" if it is missing or null.
func (e searchEntry) text(i int) string {
	if i < len(e.Texts) && e.Texts[i] != nil {
		return *e.Texts[i]
	}
	return ""
}

// entryID is a search entry's ["<kind>", <id>] pair.
type entryID struct {
	Kind string
	Num  int
}

func (id *entryID) UnmarshalJSON(b []byte) error {
	var pair []json.RawMessage
	if err := json.Unmarshal(b, &pair); err != nil {
		return err
	}
	if len(pair) != 2 {
		return fmt.Errorf("entry id %s: want [kind, id]", b)
	}
	if err := json.Unmarshal(pair[0], &id.Kind); err != nil {
		return err
	}
	return json.Unmarshal(pair[1], &id.Num)
}

// parseSearchEntries returns the options of the search page's location box,
// which the page passes to viewModel.search_regions in groups of the form
// {text: "regions", children: [<entries>]}.
func parseSearchEntries(page []byte) ([]searchEntry, error) {
	const call = "viewModel.search_regions("
	i := bytes.Index(page, []byte(call))
	if i < 0 {
		return nil, fmt.Errorf("%q not found", call)
	}
	// The groups are JavaScript object literals with unquoted keys; quoting
	// those makes the whole argument valid JSON (the entries already are).
	arg := page[i+len(call):]
	arg = bytes.ReplaceAll(arg, []byte("{text:"), []byte(`{"text":`))
	arg = bytes.ReplaceAll(arg, []byte("children:"), []byte(`"children":`))
	var groups []struct {
		Children []searchEntry `json:"children"`
	}
	if err := json.NewDecoder(bytes.NewReader(arg)).Decode(&groups); err != nil {
		return nil, fmt.Errorf("decoding search_regions: %w", err)
	}
	var entries []searchEntry
	for _, g := range groups {
		entries = append(entries, g.Children...)
	}
	return entries, nil
}

// parseCourseTypes returns the course types of each search mode, which the
// search page passes to viewModel.course_types. Entries with the css class
// "course_type_heading" are not course types but headings (with fractional
// IDs) for the entries that follow them.
func parseCourseTypes(page []byte) (map[string][]CourseType, error) {
	var raw map[string][]struct {
		ID   float64 `json:"id"`
		Text string  `json:"text"`
		CSS  string  `json:"css"`
	}
	if err := decodeAfter(page, "viewModel.course_types(", &raw); err != nil {
		return nil, err
	}
	types := make(map[string][]CourseType, len(raw))
	for mode, entries := range raw {
		var group string
		for _, e := range entries {
			if e.CSS == "course_type_heading" {
				group = e.Text
				continue
			}
			if e.ID != math.Trunc(e.ID) {
				return nil, fmt.Errorf("course type %q has non-integer id %v", e.Text, e.ID)
			}
			types[mode] = append(types[mode], CourseType{ID: int(e.ID), Name: e.Text, Group: group})
		}
	}
	return types, nil
}

var (
	flagRE     = regexp.MustCompile(`\bflag-([a-z]{2})\b`)
	addressRE  = regexp.MustCompile(`</b><br/>(.*?)<br/>`)
	scheduleRE = regexp.MustCompile(`href='([^']*/schedules/[^']*)'`)
	websiteRE  = regexp.MustCompile(`href='([^']+)' target='_blank'>Website</a>`)
)

// parseDescription fills in l from the HTML the maps page shows for a
// location, which looks like:
//
//	<div class='flag pull-left flag-in'></div><div class='location-meta'>
//	<b>Vipassana International Academy<br/>Dhamma Giri</b><br/>Igatpuri, Maharashtra, India<br/>
//	<a href='/en/schedules/schgiri' target='_blank'>Courses</a>…
//	<a href='http://www.giri.dhamma.org' target='_blank'>Website</a>…
func parseDescription(l *Location, desc string) {
	if m := flagRE.FindStringSubmatch(desc); m != nil {
		l.CountryCode = strings.ToUpper(m[1])
	}
	if m := addressRE.FindStringSubmatch(desc); m != nil {
		l.Address = html.UnescapeString(m[1])
	}
	if m := scheduleRE.FindStringSubmatch(desc); m != nil {
		l.ScheduleURL = absURL(html.UnescapeString(m[1]))
	}
	if m := websiteRE.FindStringSubmatch(desc); m != nil {
		l.Website = html.UnescapeString(m[1])
	}
}

// absURL resolves a site-relative path such as "/en/schedules/schgiri".
func absURL(u string) string {
	if strings.HasPrefix(u, "/") {
		return BaseURL + u
	}
	return u
}

// decodeAfter decodes into v the JSON value that follows the first occurrence
// of marker in page, such as the object in `location_data = {...};`.
func decodeAfter(page []byte, marker string, v any) error {
	i := bytes.Index(page, []byte(marker))
	if i < 0 {
		return fmt.Errorf("%q not found", marker)
	}
	if err := json.NewDecoder(bytes.NewReader(page[i+len(marker):])).Decode(v); err != nil {
		return fmt.Errorf("decoding %q: %w", marker, err)
	}
	return nil
}
