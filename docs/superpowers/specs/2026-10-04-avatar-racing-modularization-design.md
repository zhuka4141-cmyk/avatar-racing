# Avatar Racing Modularization Design

Date: 2026-10-04

## Goal

Split the current 1,988-line `index.html` single-page game into explicit, testable modules while preserving the current browser behavior, zero-build deployment, GitHub Pages compatibility, and direct `file://` opening.

## Constraints

- Keep the application dependency-free and runnable by opening `index.html` directly.
- Keep GitHub Pages deployment as a static directory; no bundler or server is required for production.
- Preserve race rules, seeded track generation, vehicle physics, rendering, roster import behavior, and result snapshots.
- Keep Node-based physics QA and browser QA runnable from any checkout path.
- Do not expose mutable production state through the debug API.

## Chosen Approach

Use ordered classic scripts with a single `window.AvatarRace` namespace. This keeps `file://` support and avoids a build tool while giving each subsystem an explicit API. Native ES modules were rejected because browsers block local module imports under common `file://` policies. A Vite/npm build was rejected because it adds dependencies and a release step without serving this static game.

## Module Boundaries

`index.html` will contain page markup and ordered script tags only. Existing CSS moves to `styles.css`.

- `js/config.js`: race constants, rendering constants, palette, and rigging configuration.
- `js/math.js`: pure math, seeded random helpers, formatting, and small canvas path helpers.
- `js/participants.js`: participant records, roster/CSV parsing, avatar source selection, and participant collection operations. DOM card rendering stays in the app/UI layer.
- `js/track.js`: grid planning, track generation, track validation, sampling, and distance indexing.
- `js/physics.js`: race state model, car creation, speed and catch-up rules, overtakes, overlap handling, ranking, phase transitions, and result snapshots.
- `js/render.js`: camera transforms, track drawing, car sprites, avatars, labels, HUD drawing, and resize handling.
- `js/results.js`: result snapshot rendering and result panel interactions.
- `js/app.js`: DOM lookup, setup-page rendering, event binding, application state, animation loop, error boundary, and startup.
- `js/debug.js`: read-only inspection and test-only commands exposed through `window.__avatarRace`.

Dependencies point in one direction: `config/math` -> `participants/track` -> `physics` -> `render/results` -> `app/debug`. Physics and track modules do not access the DOM. Render and results consume state without changing simulation state.

## Runtime Data Flow

`app.js` owns an `AppState` containing `participants`, `race`, and `ui` state. Setup actions update the participant collection and request a UI refresh. Starting a race creates a track and car set from one race seed, then enters the countdown phase.

Each animation frame calls `physics.step(state, dt)` followed by `render.render(state, canvas)`. HUD values are derived from the current state. When the race enters the results phase, physics creates a result snapshot; the results UI renders that snapshot while the simulation may continue moving cars after the panel appears.

The random source used by physics will be carried on the race state and injected into all random decisions. This removes the current mix of seeded and global `Math.random()` calls and makes browser and Node runs reproducible for the same seed.

## Error Handling

All runtime failures go through `app.reportError(error, context)`. Production mode records the error, stops normal race progression, and shows a recoverable error message. Test mode rethrows so QA fails with a non-zero exit. Empty catches in the frame loop and race update path will be removed. Per-car failures must be observable and counted; a vehicle cannot silently disappear as the only failure signal.

The debug adapter will return frozen or copied snapshots. Test-only mutation is exposed as named commands, enabled by `?test=1`, so browser QA can slow a car or inspect a phase without receiving a writable `race` object.

## QA Changes

- Add a shared QA path helper that resolves the page with `pathToFileURL(path.join(__dirname, '..', 'index.html'))` and writes artifacts beneath `qa/out` or a supplied output directory.
- Replace hard-coded selectors with a small selector map and remove stale `#backBtn` / `#hint` references.
- Change physics QA to load the extracted track/physics scripts directly in a VM instead of slicing the HTML script by string positions.
- Make browser QA assertions fail the process and retain screenshots/logs only as diagnostics.
- Preserve the existing 14 physics checks and add assertions for zero broken cars, deterministic seeded runs, and successful module loading.
- Keep browser QA optional on machines without Playwright; missing `PW_PATH` is reported as unverified rather than a pass.

The avatar sync wrapper will also be corrected so `-NoPush` cannot trigger a push. Publishing requires an explicit `-Push` argument, and README text will distinguish offline built-in avatars from remote CSV fallbacks.

## Acceptance Criteria

1. `index.html` contains no inline application CSS or JavaScript logic beyond markup and script tags.
2. The game still works from `file://` and GitHub Pages without a build step.
3. `node --check` passes for every JavaScript file.
4. `node qa_physics.js` passes all existing and new assertions.
5. Browser QA uses repository-relative paths and no stale selectors; with `PW_PATH` configured it completes without page errors.
6. Production debug inspection cannot directly mutate participants, cars, or race phase.
7. `fetch-avatars.cmd -NoPush` performs no commit or push, while `-Push` remains explicit.

## Out Of Scope

No new gameplay features, visual redesign, dependency upgrades, mobile interaction redesign, or change to the rigging feature is part of this refactor.
