# CLAUDE.md

Standing rules for Claude Code on this repo. Read before any task.

## Project
CHARTER. A standalone bank simulator. Player is CEO and controlling shareholder of a small bank (chartered new or taken over) in any major US city, starting ~2024. Goal: grow it past JPMorgan Chase over an open-ended run. Browser game, terminal-style desk plus a real map of the US (later the world) built on real county-level economic data. Realism first, enjoyment second. See DESIGN.md, SYSTEMS.md, BUILD_PLAN.md.

## Non-negotiable rules
1. `engine/` never imports from `ui/`. The engine is a pure simulation: `tick(state, decisions) -> { state, pending, events }`. No DOM, no rendering, no browser APIs.
2. Every tick, assets must equal liabilities plus equity for every bank in the world. A test enforces this. If it fails, stop and fix before anything else.
3. Simplification must be aggregation, not fiction. Fewer borrowers, fewer loan types, fewer regulators is fine. Made-up mechanics that don't exist in real banking are not. When realism and fun conflict, realism wins and the fun is found somewhere real.
4. Two representations of credit, always: the relationship book (individual loans, player's bank only, capped in count) and pools (count, balance, grade distribution, vintage curve). Rivals use pools only. See D29. Never simulate individual loans for rivals or for the player's pooled book.
5. Daily tick is light: cash movement, deposit flows, decision checks, event generation. Accrual, credit migration, economy, regulation, and rival AI run on the monthly close. See D30.
6. Performance is a test. Every phase test includes a big-world run: 300 banks, 40 simulated years, must complete in under 60 seconds in Node. A phase is not done until it passes.
7. Every system ships with a headless test that runs the engine for at least 20 simulated years with random seeds and checks the invariants listed in SYSTEMS.md (Part 1) for that system.
8. All randomness goes through the seeded RNG in `engine/rng.ts`. Same seed, same world, every time.
9. World state is one plain JSON-serializable object. No classes with methods in state. Save is `JSON.stringify(state)`.
10. All calibration constants live in `data/calibration.ts` and nowhere else. Each has a source, a range, and a `verified` flag. `verified: true` is set only by `scripts/calibrate.ts`, which computes the band from downloaded FDIC data (see SYSTEMS.md (Part 2)). A band you type by hand is `verified: false` with the reason. Do not invent a number and present it as sourced.
11. No abstraction until the third use. No plugin systems, event buses, or generic frameworks. Plain functions over plain data.
12. Do not add a system, screen, or mechanic that is not in BUILD_PLAN.md for the current phase without adding it to DESIGN.md (Part 2) first. At the end of every task, list anything you built that is not in the current phase.
13. Real US geography and real data. Every county's population, wages, employment, and industry mix come from the public datasets in SYSTEMS.md (Part 2), loaded from `data/` files. Never hand-author or guess a county's economy; if the data file is missing, the build fails. No real bank names; rivals are generated.
14. The same engine must run at every scale. A $30M bank and a $3T bank use the same ledger, credit, deposit, and regulation code. Scale changes aggregation and unlocks, never the rules of accounting.
15. UI follows DESIGN.md (Part 3). No dashboard tiles, no cards, no gradients. Tables, monospace numbers, a terminal.
16. No em dashes or en dashes in any player-facing text.
17. Never generate synthetic county or metro data, not even "temporarily" or "for tests." All real data is downloaded by `scripts/fetch-data.ts` from the public, no-key URLs in SYSTEMS.md (Part 2) into `raw/`, then built by `scripts/build-data.ts`. You run both. If a download fails, retry, then try the alternate URL in SYSTEMS.md (Part 2), then stop and report the exact URL and error. The owner does not download anything by hand. Tests use `data/fixtures/`, a real subset built by the same script.
18. Suppressed cells in the raw data (QCEW nondisclosure, ACS margins) are filled from the next level up (state share for a county, national for a state) and flagged `imputed: true` on the record. Imputed is allowed; invented is not.
19. Test budgets are fixed: the full suite runs under 5 minutes; the big-world test under 60 seconds; multi-seed statistical tests use 20 seeds by default and 50 only in `npm run test:full`. Do not shrink a test's world or years to make it pass; fix the code or flag the constant.
20. A test that checks a value against a calibration band uses the band from `data/calibration.ts`. If that band is `verified: false`, the test is tagged `unverified` and reports pass/fail separately. Never tune a band to make a test pass.
21. Definitions that must not be reinterpreted: the daily tick moves cash and deposit balances and queues decisions; interest accrues on the monthly close using average daily balance for the month; the ledger identity holds every tick because accrual posts as a single balanced entry. Applications arrive daily and are batched into one pending item per day when more than five are above the dial.
22. UI stack: React is allowed. No component libraries, no Tailwind, no CSS frameworks, no charting libraries. One stylesheet that implements DESIGN.md (Part 3). The map is hand-rolled SVG from GeoJSON, with `topojson-client` and a simplification tool allowed in the build script only.
23. The owner is not technical and does not want to run commands, edit config, or fetch files. You do all of it. If something needs a human (an account, a paid key, a browser login), find the no-key path first; only if none exists, ask, and ask in one sentence with the exact link.
24. Keep the progress log at the bottom of BUILD_PLAN.md: one line per session with date, checklist item worked, what passed, what is open. Read it at the start of every session. Work one checklist item per session unless the owner says otherwise.

## Workflow
- Start every task by reading BUILD_PLAN.md and finding the current phase.
- Write the test first, then the engine code, then (if the phase calls for it) the UI.
- Run `npm test` before reporting a task done.
- When a phase is complete, update the checklist in BUILD_PLAN.md and stop. The owner plays the build before the next phase starts.

## Stack
TypeScript, Vite, Vitest. Map rendered from a GeoJSON of US counties (later countries) with SVG. Data pipeline in `scripts/build-data.ts` turns raw public CSVs into `data/*.json` per SYSTEMS.md (Part 2). No backend. LocalStorage saves, export to file.
