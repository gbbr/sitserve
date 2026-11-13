# sit

Go CLI for searching the Vipassana courses listed on dhamma.org. Courses come live from the site's
course search endpoint; `sit update` caches a small index of locations, place IDs and course types.

- Plan: @docs/plan.md
- dhamma.org endpoints, parameters and limits: @docs/dhamma-api.md

Run `go test ./...` after changes. Talk to dhamma.org with plain HTTP requests only: never replay
browser cookies or imitate a browser.
