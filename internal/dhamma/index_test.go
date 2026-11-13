package dhamma

import (
	"reflect"
	"testing"
)

// The fixtures below are trimmed copies of the inline scripts on
// /en/courses/search and /en/maps.

const testSearchPage = `<script>
    viewModel = new CourseSearchViewModel(opts);
    viewModel.search_regions([
      {text: "regions", children: [{"id":["region",402],"texts":["Americas","Americas","019"],"text":"Americas"}]},
      {text: "locations", children: [{"id":["location",1442],"texts":["Dhamma Giri","Maharashtra","Igatpuri","Giri","giri","MH"],"text":"Dhamma Giri, Igatpuri, Maharashtra, India"},{"id":["location",1700],"texts":["Worldwide Farsi courses",null,"Farsi",null,"fa",null],"text":"Worldwide Farsi courses, India"}]}
    ]);
    viewModel.course_types(
      {"OldStudents":[{"id":1.5,"text":"Long","group":1.5,"css":"course_type_heading"},{"id":4,"text":"20-Day","group":2},{"id":11,"text":"30-Day","group":2}],"NewStudents":[{"id":3,"text":"10-Day","css":"course_type_entry"}]}
    );
</script>`

const testMapsPage = `<script>
  position_data = {"giri":{"latitude":"19.6347","longitude":"73.5297","zoom":7},"fa":{"latitude":"0.0","longitude":"0.0","zoom":5}};
  location_data = {"giri":{"iscenter":true,"title":"Dhamma Giri","description":"<div class='flag pull-left flag-in'></div><div class='location-meta'><b>Vipassana International Academy<br/>Dhamma Giri</b><br/>Igatpuri, Maharashtra, India<br/><a href='/en/schedules/schgiri' target='_blank'>Courses</a><a href='#'>&nbsp;|&nbsp;</a><a href='http://www.giri.dhamma.org' target='_blank'>Website</a></div>"},"fa":{"iscenter":false,"title":"Worldwide Farsi courses non-center","description":"<div class='flag pull-left flag-in'></div><div class='location-meta'><b>Worldwide Farsi courses<br/></b><br/>Farsi, India<br/><a href='/en/schedules/noncenter/fa' target='_blank'>Courses</a><a href='#'>&nbsp;|&nbsp;</a><a href='' target='_blank'>Website</a></div>"}};
</script>`

func TestParseIndex(t *testing.T) {
	got, err := parseIndex([]byte(testSearchPage), []byte(testMapsPage))
	if err != nil {
		t.Fatal(err)
	}
	want := &Index{
		Locations: []Location{
			{
				ID: 1442, Slug: "giri", Name: "Dhamma Giri", Center: true,
				Address: "Igatpuri, Maharashtra, India", CountryCode: "IN",
				Lat: 19.6347, Lng: 73.5297,
				Website:     "http://www.giri.dhamma.org",
				ScheduleURL: "https://www.dhamma.org/en/schedules/schgiri",
			},
			{
				ID: 1700, Slug: "fa", Name: "Worldwide Farsi courses",
				Address: "Farsi, India", CountryCode: "IN",
				ScheduleURL: "https://www.dhamma.org/en/schedules/noncenter/fa",
			},
		},
		Places: []Place{
			{Kind: "region", ID: 402, Name: "Americas"},
			{Kind: "location", ID: 1442, Name: "Dhamma Giri, Igatpuri, Maharashtra, India"},
			{Kind: "location", ID: 1700, Name: "Worldwide Farsi courses, India"},
		},
		CourseTypes: map[string][]CourseType{
			"OldStudents": {{ID: 4, Name: "20-Day", Group: "Long"}, {ID: 11, Name: "30-Day", Group: "Long"}},
			"NewStudents": {{ID: 3, Name: "10-Day"}},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("parseIndex:\n got %+v\nwant %+v", got, want)
	}
}

func TestParseIndexMissingData(t *testing.T) {
	if _, err := parseIndex([]byte("<html></html>"), []byte(testMapsPage)); err == nil {
		t.Error("want an error for a search page without location data")
	}
}
