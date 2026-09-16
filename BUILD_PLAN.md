# BUILD PLAN

Phases are sequential. Each phase ends with a passing headless test suite, including the big-world performance test (CLAUDE.md rule 6), and a play gate (D36). Check items off as they land.

## Before anything: owner does nothing
Claude Code downloads, builds, and calibrates. The owner pastes the files, opens Claude Code, and follows README.md. If a step truly needs a human, Claude Code asks in one sentence with the exact link (CLAUDE.md rule 23).

## Phase 0: Scaffold
- [x] Vite + TypeScript + Vitest. `engine/`, `ui/`, `data/`, `tests/`.
- [ ] `engine/state.ts`, `engine/rng.ts`, `engine/tick.ts` with daily/monthly split (D30).
- [ ] `data/calibration.ts` with the source-and-verified format (D37), populated by `scripts/calibrate.ts`.
- [ ] `scripts/fetch-data.ts` per SYSTEMS.md (Part 2): downloads every raw file to `raw/`, logs to `raw/manifest.json`, idempotent.
- [ ] `scripts/calibrate.ts` per SYSTEMS.md (Part 2): computes verified bands from the FDIC API into `data/calibration.ts`.
- [ ] `scripts/build-data.ts` per SYSTEMS.md (Part 2): turns raw public CSVs into `data/counties.json`, `data/metros.json`, `data/states.json`, `data/banks-by-state.json`. Build fails if a required field is missing.
- [ ] County GeoJSON for the US, simplified for the browser.
- [ ] Start screen: US map with startable metros (D39).
- [ ] `data/fixtures/` built from the real subset; every test imports fixtures, never full data.
- [ ] Empty world runs 365 ticks and round-trips through JSON.
- [ ] Big-world perf harness: 300 empty banks, 40 years, timer.
Done: `raw/manifest.json` lists every source with a status 200 and a hash; tests pass; map renders every US county with real population on hover; every startable metro has all SYSTEMS.md (Part 2) fields; `data/calibration.ts` has at least charge-off, ROA, and NIM bands marked verified; perf harness reports a time.

## Phase 1: Ledger, wealth, feed skeleton
- [ ] Player bank in the chosen metro, cash and deposits sized from local data, Fed funds rate, monthly accrual and close, quarterly call report.
- [ ] Leverage ratio and closure below 2%.
- [ ] Start choice: charter new or take over a generated bank.
- [ ] Personal wealth: cash, shares, salary, dividends, net worth.
- [ ] Failure sequence v1.
- [ ] Event stream skeleton: feed, pending queue, market events only.
- [ ] UI per DESIGN.md Part 3: FEED, BS, IS, ME, MAP, DEBUG, ticker with speed keys.
Done: 30 year random run, A = L + E every tick; dividends reconcile; 300 banks x 40 years under 60 seconds.
Play gate: 30 minutes. Does the ticker feel right? Is the desk readable?

## Phase 2: Credit engine and earnings review
- [ ] Borrower generator per county from real industry shares, income distribution, and home prices (D43).
- [ ] Credit memo per D32: visible fields, small hidden term, CCO summary and red flags.
- [ ] Application flow: pause, approve / counter / decline, decision record on the loan.
- [ ] Delegation dial and written loan policy; auto-decisions under policy with CCO error.
- [ ] Relationship book with cap and roll-to-pool (D29). Pools with grade buckets, vintages, monthly migration matrix.
- [ ] Loan lifecycle: funding, amortization, payment, delinquency, default, workout, foreclosure, REO, sale.
- [ ] Loss model from sector index, national cycle, borrower fields, collateral. Concentration correlation.
- [ ] CECL-style reserve, quarterly.
- [ ] Attribution events on every default (D34).
- [ ] Earnings review screen (QTR) with full attribution, ties to ledger to the dollar.
- [ ] Officers v1: CCO only.
- [ ] Event stream: borrower events (applications, missed payments, payoffs, exception requests).
- [ ] UI: LOANS (book, pools, policy, dial), QTR, drill from pool to sample loans.
Done: scripted energy bust produces plausible losses in a Midland start and near-zero energy losses in a Boston start; charge-offs by type in FDIC bands across 50 seeds; disciplined-underwriter test beats approve-everything test; dial at zero routes every loan; perf test passes with pools.
Feel gate (D36): one metro, one bank, one hour, played twice in two very different cities. Is underwriting fun? Can the player see themselves getting better? Does the earnings review explain every dollar? No Phase 3 until yes.

## Phase 3: Deposits and funding
- [ ] Deposit types, rate sheet, betas, stickiness.
- [ ] Branches on real counties: open, close, fixed cost from local wages, share capture from local deposit pool, distance penalty.
- [ ] Brokered, FHLB, fed funds purchased.
- [ ] Securities: treasuries/agencies/MBS, AFS vs HTM, unrealized loss vs equity.
- [ ] Runs from confidence score.
- [ ] Officers: CFO and CLO.
- [ ] Event stream: depositor and officer events.
- [ ] UI: FUND, OFF, branch placement on MAP.
Done: Fed +400bp shock produces outflow and unrealized loss in plausible bands; thin bank with heavy uninsured deposits runs; perf passes.
Play gate: 30 minutes. Does funding pressure feel real?

## Phase 4: Economy and rivals
- [ ] Regime-switching national cycle with banking-crisis recessions, yield curve, national sector indices, county condition from real exposure (D41), indefinite generator.
- [ ] Rival banks in home state and neighbors as individuals, other states as aggregates (D42), matched to real FDIC counts, AI policy per D35.
- [ ] Rivals price, poach, open branches against the player, fail.
- [ ] Event stream: rival and market events, full density tuning.
- [ ] UI: RIVALS (every call report), rivals on MAP, region shading.
Done: failures cluster in recessions and spike in crises; player loses deposits to a rival that prices higher; a strong rival can put a passive player into decline; an energy shock hurts Houston and not Boston; perf passes with home state, neighbors, and 50 aggregates.
Play gate: 30 minutes. Is a normal Tuesday interesting? Is a rival scary?

## Phase 5: Capital markets and M&A
- [ ] Private raises with passive investors; dilution.
- [ ] IPO at size floor; stock price; dividends, buybacks, secondaries; player stock sales.
- [ ] Holding company.
- [ ] FDIC assisted auctions with loss share and the Friday-to-Monday sequence; rival competing bids.
- [ ] Whole bank deals: offer, due diligence, price, cash/stock mix, purchase accounting, integration cost, attrition, approval time.
- [ ] Failure sequence v2: rival buys player's deposits; record follows.
- [ ] Out-of-state expansion: entering a state expands its aggregate into individual banks (D42), out-of-state deals.
- [ ] Business lines in order: mortgage, cards, wealth, investment banking and trading. Each with a real P&L at its threshold.
- [ ] Event stream: regulator and deal events.
Done: $50M to $500B over a long run by acquisition and business lines without breaking any invariant; crisis-year deals measurably cheaper; state expansion conserves totals; perf passes with 10 states expanded.
Play gate: one hour. Does buying a failed bank feel like the best day of the game?

## Phase 6: Regulation
- [ ] Full capital stack with buffers.
- [ ] CAMELS exams with findings tied to book conditions.
- [ ] Enforcement ladder to closure.
- [ ] Size threshold rules.
- [ ] Insurance assessments. Swaps.
Done: bad CRE concentration gets a finding; ignoring it escalates; failed stress test blocks dividends.
Play gate: 30 minutes. Is the examiner a fair opponent?

## Phase 7: Global
- [ ] Country layer with own indices, currency, regulator.
- [ ] Cross-border deals, FX on the balance sheet, sovereign risk.
- [ ] G-SIB designation and surcharge.
Done: $1T+ bank in three countries with a reconciled multi-currency balance sheet.

## Phase 8: Polish and balance
- [ ] Save/load/export, milestone log, advisor cards, keyboard map.
- [ ] Every calibration constant verified or removed (D37).
- [ ] Full runs: chartered, takeover, deliberate failure and restart, run past JPM.

## Backlog (not v1)
- Officer fraud.
- Fintech partnerships and deposit-as-a-service.
- Community reinvestment and political pressure.
- Full trading desk with VaR and prop losses.
- Shared-seed leaderboards.

## Progress log
Claude Code appends one line per session here: date | phase and item | what passed | what is open.

2026-09-16 | Phase 0, Vite + TypeScript + Vitest scaffold | typecheck, 3 scaffold tests (folders exist, engine never imports ui, no em or en dashes), vite build all pass | next: engine/state.ts, engine/rng.ts, engine/tick.ts with daily/monthly split (D30)
