# Avatar Racing Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single-file Avatar Racing page into dependency-free browser modules while preserving gameplay and making the physics and browser QA runnable from any checkout.

**Architecture:** Ordered classic scripts attach explicit APIs to `window.AvatarRace`; `index.html` contains markup and script tags, `styles.css` contains presentation, and the race engine is independent of the DOM. The app orchestrator owns state transitions and calls physics before rendering on every frame.

**Tech Stack:** Plain HTML/CSS/JavaScript, Canvas 2D, Node.js built-in `node:test`, optional `playwright-core` selected through `PW_PATH`, PowerShell helper scripts.

## Global Constraints

- Preserve `file://` opening and static GitHub Pages deployment without a build step.
- Preserve race rules, seeded track generation, vehicle physics, rendering, roster import, and result snapshots.
- Do not add runtime dependencies or a package manager configuration.
- Do not expose mutable production state through `window.__avatarRace`.
- Test commands must resolve paths from the repository instead of `C:/Users/Administrator/dragen dance/avatar-racing`.
- Publishing from `tools/fetch-avatars.cmd` must require an explicit `-Push` argument.

---

### Task 1: Extract Static Assets Without Behavior Changes

**Files:**
- Create: `styles.css`
- Create: `js/app.js`
- Modify: `index.html`

**Interfaces:**
- Produces the same DOM ids and event targets currently used by the application.
- Produces a single external script entry point at `js/app.js` so later tasks can split the code without editing markup again.

- [ ] **Step 1: Copy the existing `<style>` body into `styles.css`**

Preserve selectors and declarations byte-for-byte except for the enclosing `<style>` tags. Keep the existing responsive rules, hidden states, Canvas sizing, result board, and safe-area padding.

- [ ] **Step 2: Move the existing inline IIFE into `js/app.js`**

Copy only the contents between the current `<script>` and `</script>` tags into `js/app.js`, preserving the IIFE wrapper and its current initialization order. Do not change gameplay logic in this task.

- [ ] **Step 3: Replace inline blocks in `index.html`**

Replace the `<style>...</style>` block with:

```html
<link rel="stylesheet" href="styles.css" />
```

Replace the inline script block with:

```html
<script src="js/app.js"></script>
```

- [ ] **Step 4: Run syntax and markup smoke checks**

Run:

```powershell
node --check js/app.js
rg -n "<style>|<script>|</script>|styles.css|js/app.js" index.html
```

Expected: `node --check` succeeds; `index.html` has one stylesheet link and one external application script, with no inline JavaScript or CSS blocks.

- [ ] **Step 5: Commit the extraction**

```powershell
git add index.html styles.css js/app.js
git commit -m "refactor: extract avatar racing static assets"
```

---

### Task 2: Establish Namespace, Configuration, and Math APIs

**Files:**
- Create: `js/namespace.js`
- Create: `js/config.js`
- Create: `js/math.js`
- Modify: `index.html`
- Modify: `js/app.js`

**Interfaces:**
- `window.AvatarRace` is the only application global.
- `AvatarRace.config` contains the existing constants (`CAR_W`, `CAR_LEN`, `LANES`, `LANE_STEP`, `LANE_MAX`, `HALF_W`, `RACE_DIST`, `FWD_RUNOFF`, `VIEW_H`, `MIN_VIEW_W`, `PALETTE`, and `RIG`).
- `AvatarRace.math` exposes `clamp`, `lerp`, `damp`, `dampAngle`, `mulberry32`, `hashStr`, `rrect`, `fmtTime`, and `dist`.

- [ ] **Step 1: Add the namespace bootstrap**

Create `js/namespace.js` with:

```javascript
(function (global) {
  global.AvatarRace = global.AvatarRace || {};
})(window);
```

Load it before all other application scripts.

- [ ] **Step 2: Move constants into `AvatarRace.config`**

Move the current constant declarations and `RIG` object into `js/config.js` and export one object. Keep numeric values and comments unchanged. Replace direct reads in `js/app.js` with `AvatarRace.config.<name>`.

- [ ] **Step 3: Move pure helpers into `AvatarRace.math`**

Wrap the existing helper implementations in one object. No helper may read DOM state. Update callers to use `AvatarRace.math.<name>` and remove duplicate local declarations from `js/app.js`.

- [ ] **Step 4: Add a module loading check**

Create `qa/module_load.js` that reads `js/namespace.js`, `js/config.js`, and `js/math.js`, evaluates them in a VM context containing a minimal `window`, and asserts that each expected API is a function or object. Run:

```powershell
node qa/module_load.js
```

Expected: exit code 0 and all listed helper names present.

- [ ] **Step 5: Run syntax checks and commit**

```powershell
node --check js/namespace.js
node --check js/config.js
node --check js/math.js
git add index.html js/namespace.js js/config.js js/math.js js/app.js qa/module_load.js
git commit -m "refactor: add avatar racing module namespace"
```

---

### Task 3: Separate Roster Data, Participant State, and Setup UI

**Files:**
- Create: `data/roster.js`
- Create: `js/participants.js`
- Create: `js/setup-ui.js`
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `tools/fetch-avatars.ps1`

**Interfaces:**
- `AvatarRace.roster` is the array currently named `BUILTIN_ROSTER`.
- `AvatarRace.participants.createStore()` returns `{ items, nextId, gridOrder, riggedId, searchQuery }`.
- Participant operations are `add(store, name)`, `remove(store, participant)`, `clear(store)`, `shuffle(store, random)`, `displayName(store, participant)`, `parseCsv(text)`, `importCsv(store, text)`, `setDefaultAvatar(participant)`, and `applyUpload(participant, file)`.
- `AvatarRace.setup.mount({ state, elements, onStart, onToast })` owns cards, search, roster import, CSV import, and setup event listeners. It never mutates race physics state.

- [ ] **Step 1: Move the built-in roster into a static script**

Move the complete `BUILTIN_ROSTER` array to `data/roster.js` as:

```javascript
window.AvatarRace = window.AvatarRace || {};
window.AvatarRace.roster = [
  // existing pairs, unchanged
];
```

Load this file before `js/participants.js`. Preserve all names and usernames exactly, including Unicode values.

- [ ] **Step 2: Extract participant and avatar operations**

Move participant collection mutations, name defaults, CSV parsing, avatar fallback loading, image decoding, and upload handling into `js/participants.js`. Replace direct references to the old `participants`, `nextId`, `gridOrder`, and `riggedId` variables with the store object. Keep local avatar lookup before remote URL and default-avatar fallback behavior.

- [ ] **Step 3: Extract setup DOM work**

Move `buildCard`, `renderList`, search filtering, count updates, roster/CSV button handlers, and setup event binding into `js/setup-ui.js`. Pass DOM elements in a map instead of calling `document.getElementById` throughout participant logic.

- [ ] **Step 4: Update the roster synchronization script**

Change `tools/fetch-avatars.ps1` to locate and replace the `AvatarRace.roster = [` block in `data/roster.js`, preserving its existing UTF-8 output and escaping rules. The updater must no longer search `index.html` for `var BUILTIN_ROSTER`.

- [ ] **Step 5: Add participant parser tests**

Create `qa/participants.test.js` with `node:test` cases for BOM removal, quoted commas, quoted newlines, escaped quotes, Fullname fallback to Username, and blank rows. Run:

```powershell
node --test qa/participants.test.js
```

Expected: all parser cases pass without a browser.

- [ ] **Step 6: Run setup syntax checks and commit**

```powershell
node --check data/roster.js
node --check js/participants.js
node --check js/setup-ui.js
git add data/roster.js js/participants.js js/setup-ui.js js/app.js index.html tools/fetch-avatars.ps1 qa/participants.test.js
git commit -m "refactor: separate roster and participant setup"
```

---

### Task 4: Extract Track and Physics Engine With a Direct Node Harness

**Files:**
- Create: `js/track.js`
- Create: `js/physics.js`
- Create: `qa/physics-runtime.js`
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `qa_physics.js`
- Modify: `qa_rig.js`

**Interfaces:**
- `AvatarRace.track.gridPlan(count)`, `buildTrack(seed, backRunoff)`, `sampleAt(track, s)`, and `indexAtS(track, s)` are pure domain functions.
- `AvatarRace.physics.createRaceState()`, `createCars(track, participants, random, gridOrder, riggedId)`, `rankCars(cars)`, `step(race, dt)`, and `snapshotResults(race)` contain all simulation behavior.
- `qa/physics-runtime.js` loads `namespace.js`, `config.js`, `math.js`, `track.js`, and `physics.js` in a VM context and returns the namespace for tests.

- [ ] **Step 1: Extract track generation and sampling**

Move `gridPlan`, `buildTrack`, `finishTrack`, `sampleAt`, and `indexAtS` to `js/track.js`. Replace helper calls with `AvatarRace.math` and constants with `AvatarRace.config`. Do not change seed handling, validation retries, point layout, or track dimensions.

- [ ] **Step 2: Extract race state and car physics**

Move `race`, `rankCars`, `createCars`, `updateCar`, `rigFactor`, `computeRival`, `planOvertakes`, `sortByS`, `interact`, `overlapNeed`, `separateOverlap`, `updateRace`, and `endRace` to `js/physics.js`. Make the random generator an explicit property of race state and replace each `Math.random()` call in physics with that generator.

- [ ] **Step 3: Add the VM runtime loader**

Create `qa/physics-runtime.js` that reads the five core scripts with `fs.readFileSync`, runs them in order with `vm.runInContext`, and supplies only the minimal globals required by the pure engine. It must not parse `index.html` or rely on string sentinels.

- [ ] **Step 4: Rewrite physics QA against the module API**

Replace the current `<script>` extraction in `qa_physics.js` with `require('./qa/physics-runtime')`. Update each test to call `AvatarRace.track` and `AvatarRace.physics`, retaining the existing 14 assertions and adding:

```javascript
assert.equal(cars.filter((car) => car.broken).length, 0);
assert.deepEqual(runSeed(42), runSeed(42));
```

The deterministic comparison must compare finish order and rounded finish times, not object identity.

- [ ] **Step 5: Rewrite rig QA against the module API**

Update `qa_rig.js` to use the same runtime loader and explicit physics methods. Keep its current rigging assertions and remove all `indexOf('var setupView')` / `indexOf('function gridPlan')` slicing.

- [ ] **Step 6: Run engine verification and commit**

```powershell
node --check js/track.js
node --check js/physics.js
node qa_physics.js
node qa_rig.js
```

Expected: all existing physics and rig checks pass with no broken cars and repeatable seeded metrics.

```powershell
git add index.html js/app.js js/track.js js/physics.js qa/physics-runtime.js qa_physics.js qa_rig.js
git commit -m "refactor: extract deterministic race engine"
```

---

### Task 5: Extract Renderer, Results, and Application Orchestration

**Files:**
- Create: `js/render.js`
- Create: `js/results.js`
- Create: `js/debug.js`
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `js/track.js`
- Modify: `js/physics.js`

**Interfaces:**
- `AvatarRace.render.create(canvas, elements)` returns `{ resize, render, updateHud }`.
- `AvatarRace.results.show(snapshot, elements)` renders only the supplied result snapshot.
- `AvatarRace.debug.install({ state, testMode })` exposes read-only snapshots and named test commands.
- `AvatarRace.app.start()` initializes the page and starts the animation loop.

- [ ] **Step 1: Extract Canvas drawing and camera code**

Move camera updates, world transforms, ground/track drawing, car sprites, avatar discs, labels, and Canvas rendering into `js/render.js`. Pass race state and rendering context as arguments. Keep the existing low-quality threshold, DPR cap, label text, sprite geometry, and camera behavior unchanged.

- [ ] **Step 2: Extract result panel rendering**

Move `showResults` and result-board DOM construction into `js/results.js`. The function must consume `race.results` or an explicit snapshot and must not read live car positions to determine displayed ranks.

- [ ] **Step 3: Make `app.js` the only orchestrator**

Move DOM lookup, `AppState` creation, start/back/replay actions, countdown display, resize listeners, keyboard handling, and `requestAnimationFrame` into `AvatarRace.app`. The frame order must remain:

```javascript
physics.step(state.race, dt);
renderer.render(state, dt);
renderer.updateHud(state);
```

- [ ] **Step 4: Add the debug adapter**

Expose `window.__avatarRace` with copied snapshots such as `getState()`, `getCars()`, and `buildTrack(seed, runoff)`. When `location.search` contains `test=1`, expose named commands `setCarSpeed(index, speed)` and `setPhase(phase)`; do not return the mutable `state.race` or `state.participants` object.

- [ ] **Step 5: Add the centralized error boundary**

Implement `app.reportError(error, context)`. In normal mode it records the error, stops stepping, and shows a recoverable toast. In test mode it rethrows. Remove empty catches around `updateRace`, `render`, `interact`, and `separateOverlap`; preserve explicit error context in the console.

- [ ] **Step 6: Verify static loading and commit**

Load scripts in `index.html` in this order:

```html
<script src="js/namespace.js"></script>
<script src="js/config.js"></script>
<script src="js/math.js"></script>
<script src="data/roster.js"></script>
<script src="js/participants.js"></script>
<script src="js/track.js"></script>
<script src="js/physics.js"></script>
<script src="js/render.js"></script>
<script src="js/results.js"></script>
<script src="js/debug.js"></script>
<script src="js/setup-ui.js"></script>
<script src="js/app.js"></script>
```

Run:

```powershell
node --check js/render.js
node --check js/results.js
node --check js/debug.js
node --check js/setup-ui.js
node --check js/app.js
node qa_physics.js
```

Expected: syntax and physics checks pass, and there is no inline `<style>` or application `<script>` body in `index.html`.

```powershell
git add index.html js/render.js js/results.js js/debug.js js/setup-ui.js js/app.js js/physics.js
git commit -m "refactor: split rendering and app orchestration"
```

---

### Task 6: Make Browser QA Portable and Publishing Explicit

**Files:**
- Create: `qa/browser-helpers.js`
- Modify: `qa_test.js`
- Modify: `qa_rules.js`
- Modify: `qa_end.js`
- Modify: `qa_overtake.js`
- Modify: `qa_overlap.js`
- Modify: `qa_ms.js`
- Modify: `qa_labels.js`
- Modify: `qa_hairpin.js`
- Modify: `qa_catchup.js`
- Modify: `qa_diag.js`
- Modify: `tools/fetch-avatars.cmd`
- Modify: `tools/fetch-avatars.ps1`
- Modify: `README.md`

**Interfaces:**
- `qa/browser-helpers.js` exports `pageUrl`, `outputDir`, `makeBrowser`, `assertNoPageErrors`, and `writeScreenshot`.
- Every browser QA script uses the helper and exits non-zero on assertion failure.
- `tools/fetch-avatars.cmd` passes `-Push` only when the user supplied `-Push`.

- [ ] **Step 1: Add shared browser QA helpers**

Create helpers using `path`, `url.pathToFileURL`, and `fs.mkdirSync`:

```javascript
const pageUrl = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const outputDir = process.env.QA_OUT || path.join(__dirname, 'out');
```

Make screenshot names resolve under `outputDir` and provide an `assertNoPageErrors(errors)` function that throws when the page emitted an error.

- [ ] **Step 2: Migrate all browser scripts to repository-relative paths**

Replace hard-coded `URL` and `OUT` constants in every listed script with the helper exports. Pass `?test=1` to `pageUrl` in scripts that use debug commands. Keep viewport sizes and test durations unchanged.

- [ ] **Step 3: Repair stale selectors and assertions**

Change `qa_test.js` to click `#toSetupBtn`, remove reads of nonexistent `#hint`, and assert the actual setup/result elements. Convert fatal catches to `process.exitCode = 1` after printing the error. Add explicit assertions for the 35/120 car paths.

- [ ] **Step 4: Fix the publish switch**

Change `tools/fetch-avatars.cmd` to forward `-Push` only when `%*` contains `-Push`, and forward `-NoPush` without also setting `-Push`. Keep PowerShell’s commit/push block guarded by `$Push`.

- [ ] **Step 5: Update README commands and behavior notes**

Document `QA_OUT`, the optional `PW_PATH`, the repository-relative script behavior, the corrected `#toSetupBtn` flow, and the fact that built-in local avatars work offline while CSV remote fallback may access the network. Document that `-NoPush` never commits or pushes.

- [ ] **Step 6: Run available browser checks and commit**

Run:

```powershell
if ($env:PW_PATH) {
  node qa_test.js
  node qa_rules.js
  node qa_end.js
  node qa_overtake.js
}
```

When `PW_PATH` is absent, run the Node syntax and physics checks and report browser QA as unverified. Then run:

```powershell
node --check qa/browser-helpers.js
node --check qa_test.js
node --check qa_rules.js
git add qa tools README.md
git commit -m "test: make avatar racing QA portable"
```

---

### Task 7: Full Verification and Review Checkpoint

**Files:**
- Modify only files required by failing checks from Tasks 1-6.

- [ ] **Step 1: Run all static checks**

```powershell
Get-ChildItem js,data,qa -Filter *.js -Recurse | ForEach-Object { node --check $_.FullName }
```

Expected: every JavaScript file exits 0.

- [ ] **Step 2: Run deterministic engine and parser tests**

```powershell
node --test qa/participants.test.js
node qa/module_load.js
node qa_physics.js
node qa_rig.js
```

Expected: all tests pass, no broken cars are reported, and the same seed produces the same rounded finish order/times.

- [ ] **Step 3: Run browser QA when Playwright is configured**

```powershell
if (-not $env:PW_PATH) { Write-Output 'Browser QA unverified: PW_PATH is not configured' }
else { node qa_test.js; node qa_rules.js; node qa_end.js; node qa_overtake.js }
```

Expected with Playwright: no page errors, the result board is scrollable, replay returns to countdown, and 35/120 participant paths complete.

- [ ] **Step 4: Inspect the final diff for scope and behavior changes**

```powershell
git diff --check HEAD~1..HEAD
git status --short
git log -7 --oneline
```

Confirm only the modularization, QA portability, error visibility, deterministic RNG, and explicit publish switch changed. Do not add gameplay features.

- [ ] **Step 5: Commit only verification fixes**

```powershell
git add .
git commit -m "test: verify avatar racing modularization"
```



