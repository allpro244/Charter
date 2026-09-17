# BUILD PLAN

Phases are sequential. Each phase ends with a passing headless test suite, including the big-world performance test (CLAUDE.md rule 6), and a play gate (D36). Check items off as they land.

## Before anything: owner does nothing
Claude Code downloads, builds, and calibrates. The owner pastes the files, opens Claude Code, and follows README.md. If a step truly needs a human, Claude Code asks in one sentence with the exact link (CLAUDE.md rule 23).

## Phase 0: Scaffold
- [x] Vite + TypeScript + Vitest. `engine/`, `ui/`, `data/`, `tests/`.
- [x] `engine/state.ts`, `engine/rng.ts`, `engine/tick.ts` with daily/monthly split (D30).
- [ ] `data/calibration.ts` with the source-and-verified format (D37), populated by `scripts/calibrate.ts`.
- [ ] `scripts/fetch-data.ts` per SYSTEMS.md (Part 2): downloads every raw file to `raw/`, logs to `raw/manifest.json`, idempotent.
- [ ] `scripts/calibrate.ts` per SYSTEMS.md (Part 2): computes verified bands from the FDIC API into `data/calibration.ts`.
- [ ] `scripts/build-data.ts` per SYSTEMS.md (Part 2): turns raw public CSVs into `data/counties.json`, `data/metros.json`, `data/states.json`, `data/banks-by-state.json`. Build fails if a required field is missing.
- [ ] County GeoJSON for the US, simplified for the browser.
- [ ] Start screen: US map with startable metros (D39).
- [ ] `data/fixtures/` built from the real subset; every test imports fixtures, never full data.
- [x] Empty world runs 365 ticks and round-trips through JSON.
- [x] Big-world perf harness: 300 empty banks, 40 years, timer.
Done: `raw/manifest.json` lists every source with a status 200 and a hash; tests pass; map renders every US county with real population on hover; every startable metro has all SYSTEMS.md (Part 2) fields; `data/calibration.ts` has at least charge-off, ROA, and NIM bands marked verified; perf harness reports a time.

## Phase 1: Ledger, wealth, feed skeleton
- [x] Player bank in the chosen metro, cash and deposits sized from local data, Fed funds rate, monthly accrual and close, quarterly call report.
- [x] Leverage ratio and closure below 2%.
- [x] Start choice: charter new or take over a generated bank.
- [x] Personal wealth: cash, shares, salary, dividends, net worth.
- [x] Failure sequence v1.
- [x] Event stream skeleton: feed, pending queue, market events only.
- [x] UI per DESIGN.md Part 3: FEED, BS, IS, ME, MAP, DEBUG, ticker with speed keys.
Done: 30 year random run, A = L + E every tick; dividends reconcile; 300 banks x 40 years under 60 seconds.
Play gate: 30 minutes. Does the ticker feel right? Is the desk readable?

## Phase 2: Credit engine and earnings review
- [x] Borrower generator per county from real industry shares, income distribution, and home prices (D43).
- [x] Credit memo per D32: visible fields, small hidden term, CCO summary and red flags.
- [x] Application flow: pause, approve / counter / decline, decision record on the loan.
- [x] Delegation dial and written loan policy; auto-decisions under policy with CCO error.
- [x] Relationship book with cap and roll-to-pool (D29). Pools with grade buckets, vintages, monthly migration matrix.
- [x] Loan lifecycle: funding, amortization, payment, delinquency, default, workout, foreclosure, REO, sale.
- [x] Loss model from sector index, national cycle, borrower fields, collateral. Concentration correlation.
- [x] CECL-style reserve, quarterly.
- [x] Attribution events on every default (D34).
- [x] Earnings review screen (QTR) with full attribution, ties to ledger to the dollar.
- [x] Officers v1: CCO only.
- [x] Event stream: borrower events (applications, missed payments, payoffs, exception requests).
- [x] UI: LOANS (book, pools, policy, dial), QTR, drill from pool to sample loans.
Done: scripted energy bust produces plausible losses in a Midland start and near-zero energy losses in a Boston start; charge-offs by type in FDIC bands across 50 seeds; disciplined-underwriter test beats approve-everything test; dial at zero routes every loan; perf test passes with pools.
Feel gate (D36): one metro, one bank, one hour, played twice in two very different cities. Is underwriting fun? Can the player see themselves getting better? Does the earnings review explain every dollar? No Phase 3 until yes.

## Phase 3: Deposits and funding
- [x] Deposit types, rate sheet, betas, stickiness.
- [x] Branches on real counties: open, close, fixed cost from local wages, share capture from local deposit pool, distance penalty.
- [x] Brokered, FHLB, fed funds purchased.
- [x] Securities: treasuries/agencies/MBS, AFS vs HTM, unrealized loss vs equity.
- [x] Runs from confidence score.
- [x] Officers: CFO and CLO.
- [x] Event stream: depositor and officer events.
- [x] UI: FUND, OFF, branch placement on MAP.
Done: Fed +400bp shock produces outflow and unrealized loss in plausible bands; thin bank with heavy uninsured deposits runs; perf passes.
Play gate: 30 minutes. Does funding pressure feel real?

## Phase 4: Economy and rivals
- [x] Regime-switching national cycle with banking-crisis recessions, yield curve, national sector indices, county condition from real exposure (D41), indefinite generator.
- [x] Rival banks in home state and neighbors as individuals, other states as aggregates (D42), matched to real FDIC counts, AI policy per D35.
- [x] Rivals price, poach, open branches against the player, fail.
- [x] Event stream: rival and market events, full density tuning.
- [x] UI: RIVALS (every call report), rivals on MAP, region shading.
Done: failures cluster in recessions and spike in crises; player loses deposits to a rival that prices higher; a strong rival can put a passive player into decline; an energy shock hurts Houston and not Boston; perf passes with home state, neighbors, and 50 aggregates.
Play gate: 30 minutes. Is a normal Tuesday interesting? Is a rival scary?

## Phase 5: Capital markets and M&A
- [x] Private raises with passive investors; dilution.
- [x] IPO at size floor; stock price; dividends, buybacks, secondaries; player stock sales.
- [x] Holding company.
- [x] FDIC assisted auctions with loss share and the Friday-to-Monday sequence; rival competing bids.
- [x] Whole bank deals: offer, due diligence, price, cash/stock mix, purchase accounting, integration cost, attrition, approval time.
- [x] Failure sequence v2: rival buys player's deposits; record follows.
- [x] Out-of-state expansion: entering a state expands its aggregate into individual banks (D42), out-of-state deals.
- [x] Business lines in order: mortgage, cards, wealth, investment banking and trading. Each with a real P&L at its threshold.
- [x] Event stream: regulator and deal events.
Done: $50M to $500B over a long run by acquisition and business lines without breaking any invariant; crisis-year deals measurably cheaper; state expansion conserves totals; perf passes with 10 states expanded.
Play gate: one hour. Does buying a failed bank feel like the best day of the game?

## Phase 6: Regulation
- [x] Full capital stack with buffers.
- [x] CAMELS exams with findings tied to book conditions.
- [x] Enforcement ladder to closure.
- [x] Size threshold rules.
- [x] Insurance assessments. Swaps.
Done: bad CRE concentration gets a finding; ignoring it escalates; failed stress test blocks dividends.
Play gate: 30 minutes. Is the examiner a fair opponent?

## Phase 7: Global
- [x] Country layer with own indices, currency, regulator.
- [x] Cross-border deals, FX on the balance sheet, sovereign risk.
- [x] G-SIB designation and surcharge.
Done: $1T+ bank in three countries with a reconciled multi-currency balance sheet.

## Phase 8: Polish and balance
- [x] Save/load/export, milestone log, advisor cards, keyboard map.
- [ ] Every calibration constant verified or removed (D37). Blocked: every data host returns 403 from this environment's network policy, so `scripts/calibrate.ts` has not run. All bands are hand-entered, marked unverified, and listed on DEBUG.
- [ ] Full runs: chartered, takeover, deliberate failure and restart, run past JPM. Engine-level runs exist as tests (30 year growth by acquisition, failure and purchase, $1T in three countries, the largest-bank milestone); the played runs wait on the data files.

## Backlog (not v1)
- Officer fraud.
- Fintech partnerships and deposit-as-a-service.
- Community reinvestment and political pressure.
- Full trading desk with VaR and prop losses.
- Shared-seed leaderboards.

## Progress log
Claude Code appends one line per session here: date | phase and item | what passed | what is open.

2026-09-16 | Phase 0, Vite + TypeScript + Vitest scaffold | typecheck, 3 scaffold tests (folders exist, engine never imports ui, no em or en dashes), vite build all pass | next: engine/state.ts, engine/rng.ts, engine/tick.ts with daily/monthly split (D30)
2026-09-17 | Owner said keep going; Phases 0 to 7 built end to end, Phase 8 save/export/advisor/keys | 93 tests pass (14 fixture-gated tests skip), 300 banks x 40 years in about 12 s, build clean; every play gate skipped on the owner's instruction | open: data downloads blocked (403 on census.gov, bls.gov, bea.gov, fhfa.gov, fdic.gov, fred.stlouisfed.org); once the network policy allows them run npm run fetch-data, npm run build-data -- --fixtures, npm run calibrate, then the 14 skipped tests and the first real play
2026-09-17 | Playtest for bugs before the owner plays (scripted bot over 6 seeds x 25 years plus a Playwright pass over every screen) | fixed: two-column tables overlapping on BS, FUND, OFF, ME, LINES and the rival drill-down; pool loan counts decaying to zero; residual pools under $1,000 lingering; YTD originations never resetting; Fed moving in odd increments; representative pool loans shown in raw dollars; duplicate vintage pools after an acquisition; lot totals drifting from the ledger after a deal; a failed rival still tagged for sale; competing bids on every offer; share count collapse in buybacks; blocking pendings freezing the ticker; realism: recessions and recoveries now end on a rising hazard (6 to 20 months, crises 12 to 30, crisis recoveries at least 2 years) instead of a memoryless draw; a banking crisis keeps unemployment high and home prices falling for 3 years after; stress moves pass grades far more than criticized ones and downgrades follow its square root, so a crisis no longer defaults a whole construction book in months; the macro cap no longer hides a bank's own underwriting, which now has a lognormal spread; rivals reinvest idle cash in a bond book (they had run securities to zero and sat on 30% cash); rivals lend to a balance mix, not an origination mix; rival capital target and securities share are calibration bands; cards enter at grade 4; 93 tests pass, 14 fixture-gated skip, big world 24 s, bot 0 anomalies, 0 browser errors | open: individual rival failures run 1 to 14 per 300 banks over 40 years, the low end of the record, because the test world has no geography; the application and memo flow is untested until the data downloads work (same 403 as before)
