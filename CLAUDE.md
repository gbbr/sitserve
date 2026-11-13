# sit

A website for finding Vipassana courses listed on dhamma.org that you can still sign up for.
Work in `web/`: `mockup.html` is plain HTML, CSS and JavaScript, using `mockup-data.js` as a
fixed sample. There is no framework or build step. The future live-data backend will be JavaScript.

- Current design decisions and handoff: @web/design.md
- Website implementation plan: @docs/plan.md
- dhamma.org endpoints, parameters and limits: @docs/dhamma-api.md

Check interactions and responsive layouts in a browser after UI changes. Talk to dhamma.org with
plain HTTP requests only: never replay browser cookies or imitate a browser. Rebuild any needed
metadata using JavaScript scripts; the Go CLI and its index implementation have been removed.
