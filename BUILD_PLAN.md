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
2026-09-17 | Owner asked how to play; data hosts still refused by the network policy | desk built with relative paths so it runs from any folder or hosted page; the no-data screen starts a bundled playtest bank in one click; the built desk published as a private page for the owner | open: the real game (map, applications, memos, real counties) waits on the data downloads; once the network allows census.gov, bls.gov, bea.gov, fhfa.gov, fdic.gov and fred.stlouisfed.org, run fetch-data, build-data, calibrate and republish
2026-09-17 | Owner wants to download and play, not a hosted link | npm run pack folds the built desk, its stylesheet and a day-zero playtest world into one file, dist/charter.html, that runs from a double click with no server; tested from disk in a browser: start, run, save, reopen and continue all work with zero errors | open: same as above, the real world waits on the data downloads; after they land, npm run pack again and send the new file
2026-09-17 | Owner asked for a complete UI overhaul: mouse-first, appealing, easy to navigate | DESIGN.md Part 3 rewritten as the mouse-first contract; new stylesheet (blue-black ground, raised panels, amber accent, sans words and mono numbers); shell with a persistent top bar (bank, date, Play and Pause, five speed buttons, assets, leverage pill, cash, net worth, Save, Help), a clickable tab bar with keyboard hints and a pending count, decisions docked under the tabs with large buttons while the other tabs keep working, offers as cards beside the feed, an economy panel and the advisor beside the feed, a help dialog, every screen opening with one line on what it is for, segmented controls for loan sub-tabs and bond buying, a rival search box, map shading by buttons, primary and danger buttons where it matters; a class collision that laid a drill-down table out sideways fixed; keyboard shortcuts kept; verified by a browser pass clicking every tab, the clock, help, drill-downs, and a decision; 93 tests pass | open: same data blocker as before
2026-09-17 | Owner asked for the digestible layer (proposal items 1 to 5) and fine steps everywhere | Overview home screen with five gauges (capital, cash, loans, profit, growth: number, status pill, one sentence of meaning, link to the tab), profit in plain words, sparklines, what to do next, recent feed with a full-feed toggle; a glossary of about seventy bank words shown on hover under every label; tabs regrouped to Overview, Lending, Money, Earnings, People, Market, Map, You with sub-tabs, Debug behind Help; balance sheet in three questions with every line and the regulators' view on request; loan book with a health bar per type and pools behind a sub-tab; bonds and swaps behind a sub-tab, unlocks collapsed to one line; every decision shows what it means, computed only from visible facts (a loan's yearly interest, default odds by grade and expected loss, policy fit, what a counter does; what matching the market costs and what holding loses; what a CAMELS rating brings); a toast after every action; steppers with a fine and a coarse step (1bp and 25bp on rates, 0.01 and 0.10 on coverage, 1% and 5% on loan to value and the sector cap, 1K and 10K on salary, 1% and 10% on payout) and typed amounts for draws, raises, buys and sells; DESIGN.md Part 3 records the layers | open: same data blocker as before
2026-09-17 | Owner playing the desk (six asks) and the map with a real world | desk: the Overview side column no longer pushes the page wider than the window and table words wrap everywhere; every dollar figure carries its scale ($12.3K, $50.55MM, $1.20B); Earnings gained Quarter over quarter and Year over year (change and change % on every line, twelve months against twelve, a quarter by quarter history; the engine keeps the player's closed-quarter statements); Bonds is a rate sheet (3 months to 10 years by three products, yield in every cell, the one point price hit) with a pick panel that shows yield, dollars a year, pickup over cash, the price hit, the fee and the purchase on the button; a new Economy tab (D46): where to lend, the cycle, sectors and your market; a loan rate sheet on Lending (D47) in 1bp and 25bp steps that moves who walks in (hand band loanRateElasticity); stale tab names fixed. data: the agency hosts stay blocked, so SYSTEMS.md Part 2 now lists public mirrors of the same datasets and fetch-data downloads them: the UC Riverside open bucket (ACS 2017 to 2021 tract tables summed to counties: population, income buckets and medians, per capita income, labor force, employed residents by industry mapped to the D41 sectors, units, home value and rent buckets; OMB 2020 CBSA list as parquet), the JsonOfCounties compilation (CBP 2019 payroll over employees for the wage, TIGER centroids, names), us-atlas geometry, datahub.io mirrors of six FRED series; the four short rates and the whole banking sector have no mirror, so they come from hand bands (D48): deposit pools follow real personal income, bank counts follow population, sizes a lognormal spread, the national giants sit in the largest counties, all generated in the engine at world creation and replaced the moment the FDIC list lands; build-data takes the agency file when present and the mirror otherwise and says which in the manifest; 3,140 counties, 927 metros, 191 startable, fixtures for five real metros. realism fixes the real world exposed: rivals are funded within deposits and capital (a county-dwarfing bank draws on a wider franchise pool and capacity never forces deposits out); a rival's rate push is capped near 150bp over market (one was paying 1,700%); a branch gathers customers at a pace (a twentieth of a mature book at opening, all of it by year four) and wins at most a quarter over its own target in a county contest; overhead is charged on earning assets, not idle cash; underwriting error is marginal (a weak CCO turns away good loans far more often than it waves an exception through, and never funds a borrower who cannot cover the payment) and auto-approvals fund only from cash above a working cushion; the CRE concentration guidance is part of every written policy; a new charter gets the three year de novo grace on earnings at the exam; national seeds are never re-created when the player enters their state; takeover candidates come from every state a metro touches. pack now folds the seven data files into charter.html (5.7 MB) so the owner double-clicks into the start screen; browser walkthrough: pick Houston, charter, first application on day 9, Economy tab live, hover a county for real numbers, open a branch; 112 tests pass including the fifteen that had never run | open: the FDIC list (real rival sizes, counts and county deposits), FHFA county prices, BEA GDP and four FRED rates still wait on the network; the borrower generator produces many grade 1 and grade 7 applicants in real counties and deserves a pass; the owner reported loan rates reverting to default, not reproduced in the packed build; deposits do not yet follow business borrowers (operating accounts)
2026-09-20 | Owner: small loans still reach the desk with the size line at $1MM; wants a health meter on every loan | the dial's grade line (default grade 5) was routing every weak loan to the desk whatever its size: it now has a never setting, new banks start there, and the written policy gained a worst grade the loan officer may approve alone (default 6) so weak small loans are declined under policy, not escalated; every loan decision now carries a health meter: capacity, leverage, collateral, character, capital, conditions and concentration scored 0 to 100 from the memo with a plain note each, an overall word, the CCO's grade beside it, strengths and concerns, and a separate line on whether the rate pays for the risk (cost of money, expected loss for the grade, running cost); a batch shows the meter and policy fit for every loan; the legal lending limit (15% of capital to one name) is part of the concentration read; 5 new tests | open: same as the line above
2026-09-20 | Owner: what is and is not enjoyable for a casual player; fix the play, not a tutorial | measured first: a player who approved every loan at the desk and touched nothing else killed a new charter and a takeover inside a year (desk approvals were funded blind), the feed ran one to two lines a day of other banks' bond sales and deposit chatter, and a takeover candidate could be sized with more loans and bonds than funding and crash at the start; engine: the legal lending limit (15% of capital to one borrower) is enforced at the desk and in policy; a desk approval is funded from cash above the cushion and up to half the Home Loan Bank line, drawn on the spot, the other half kept for withdrawals, and a loan beyond both is declined with the reason; a day's batch offers approve the sound ones (health 65 and up, within policy); the bank keeps the player's own record (approved, declined, paid off, went bad, dollars lost); the ladder ranks the bank among every bank in America by assets, the others grown with the economy, with milestones at the top 1,000 down to the top; takeover candidates are sized as deposits plus equity with three percent cash; other banks' forced bond sales, line draws and ordinary deposit days stay out of the feed; desk: rank pill and alert count in the top bar, Your calls table on the Overview, the recent feed filtered to what touches this bank, the ladder on You, branch counties highlighted on the map with what a branch in any county would gather and cost, advisor cards for a half-used Home Loan Bank line and for deposits falling a quarter and still falling, start copy that says the charter's first year is slow; headless replay after the changes: six naive three-year runs (three charters, three takeovers) all survive, feed down to about half a line a day; npm test green (120 tests, one skipped); rival deposit test rewritten to start the bank at the market, since its ten percent threshold had depended on where rates drifted | open: the desk still stops the clock ten to thirteen times a month at the default dial in the largest metros (rule 21 fixes batching; the dial is the player's lever); deposits do not follow business borrowers; FDIC list, FHFA, BEA and four FRED rates still blocked; borrower generator still leans to grade 1 and grade 7 applicants
