# DESIGN

CHARTER. Three parts: the vision, the locked decisions, the desk style.

# Part 1: Vision

## One line
Run a bank. Start with a small one in any major American city. End with one bigger than JPMorgan Chase. Keep as much of the money as you can along the way.

## Why this exists
Wall Street Raider and Capitalism Lab both let you own a bank, but the bank is a black box that prints spread income. There is no credit decision, no funding problem, no cycle that punishes a bad book. This game makes the balance sheet the game.

## Realism first
Banking is slow and unforgiving. A good bank earns 1% on assets. Growth comes from deposits you can't fake, acquisitions you can only afford after a crisis, and a stock market that only pays for growth stories it believes. The game does not cheat on any of that. The fantasy is real: every bank that passed JPMorgan got there the same way, over generations, by buying the banks that broke. So the run is long, the cycles are real, and top speed moves fast enough that a decade of waiting takes minutes. What the game owes the player is not an easier world but an honest, legible one: you always know why you made or lost money.

## The fantasy
You are the CEO and biggest shareholder of a bank. Every dollar you lend came from someone's deposit or from money you borrowed. Every loan is a bet on a person and a place. Rates move against you. Oil busts. The bank across the street pays more on savings than you can afford. The examiner finds your CRE concentration. And when the cycle breaks the bank down the road, you buy it for nothing and take its deposits.

Every dollar you pay yourself is capital the bank doesn't have when the cycle turns. Greedy CEOs run thin banks.

## The core loop
1. Gather deposits.
2. Deploy them into loans and securities.
3. Earn the spread. Pay the overhead. Reserve for losses.
4. Keep capital above the line the regulator drew.
5. Survive the cycle.
6. Buy the banks that didn't.
7. Decide how much to take off the table.

Score is your personal net worth: your stake in the bank plus everything you've pulled out.

## The daily loop
A normal Tuesday is not empty. Real banks generate a stream of things a CEO sees: a loan officer wants a rate exception, a big depositor is moving money, a rival opened a branch across the street, the CFO flags a bond loss, a borrower missed a payment, the Fed moved, an examiner letter arrived, a rival bank is quietly for sale, your CLO got an offer from a competitor. Most are one-line news items. Some are pauses. The player should never wonder what to do next; the stream tells them what's happening and the desk tells them how bad it is.

## The quarter
Every quarter closes with an earnings review. It attributes every dollar: interest earned by book, deposit cost by type, losses by loan and by the decision that made them ("energy book charge-offs, four loans you approved in 2027"), overhead, provision, tax. This is the emotional beat of the game. Winning and losing must always be explained.

## The four stages
- Community bank ($20M to $1B): every loan is a face. Deposits come from your metro. One local bust can end you: oil in Midland, tech in San Jose, tourism in Las Vegas, autos in Detroit. You are the credit committee.
- Regional bank ($1B to $100B): portfolios, not loans. You set policy and a delegation line; loans above it still cross your desk. You buy banks across your state and the ones next to it. IPO becomes possible.
- National bank ($100B to $1T): whole US. Business lines: mortgage, cards, wealth, capital markets. Stress tests. Too big to fail.
- Global ($1T+): London, Hong Kong, Tokyo, Frankfurt. Currency, sovereign exposure, global regulators. Past JPMorgan.

The game must feel different at each stage without changing the underlying engine. The same credit engine that shows you one rancher's application shows you a $400B mortgage book as a grade distribution and a vintage curve.

## Failure
The bank can die. You don't. The FDIC arrives on a Friday afternoon, your equity goes to zero, a rival buys your deposits over the weekend, and Monday you're a private citizen with whatever you took off the table and a failed bank on your record. Same world, same rivals. Charter or buy another one and go again.

## Threats at every size
Small: the cycle and one bad concentration. Regional: funding cost, a rival that prices you out of your own towns, the examiner. National: stress tests, a business line that blows up, a rival that buys the bank you wanted. Nobody sits above you (no board that fires you), but rivals are not passive. A bigger, better-run competitor can take your deposits, poach your officers, and outbid you until you are shrinking. Decline is a real state the player has to reverse.

## Tone
Dry, financial, terminal. The desk looks like a Bloomberg or a call report. The map is a real map of the United States, and every county on it has its real population, wages, and industry mix. News is emergent from the sim, never scripted flavor text.

## What this is not
- Not a stock trading game. Securities are a treasury function. Personal wealth is cash and bank stock.
- Not a management sim. Three or four key officers with skill and cost, not an org chart.
- Not a story. No missions, no quests. Sandbox only.

## Era
Modern day, starting ~2024. Real economic structure (Fed, yield curve, FDIC, Basel-style capital, Dodd-Frank thresholds) but a synthetic future that runs forever. Real US cities and counties with their real economies from public data (see SYSTEMS.md (Part 2)). No real bank names.

# Part 2: Decisions

Locked design decisions. Add a new numbered entry to change one; do not edit old ones. Realism first, enjoyment second (D31).

| # | Decision | Notes |
|---|---|---|
| D1 | Standalone game, own repo | |
| D2 | Browser, TypeScript, no backend | Saves in localStorage as JSON, export to file. |
| D3 | Time is a ticker, one tick per day, auto-pauses on decisions | Player sets speed. Top speed runs roughly one game year per two real minutes. |
| D4 | Player chooses at start: charter a new bank (raise $10M to $30M, player puts in own money and takes a stake) or take over an existing small bank (buy a controlling stake) | Takeover comes with a book, deposits, officers, and someone else's problems. |
| D5 | Modern era, ~2024 start, synthetic future that generates forever | Real institutions and rules, fictional banks. |
| D6 | Depth priority: credit, then deposits, then M&A, then regulation | |
| D7 | Score is player personal net worth: bank stake at book or market value plus cash pulled out | Milestones logged. No win screen. |
| D8 | Failure is bank failure only. FDIC closes the bank, player equity goes to zero, player keeps outside cash and can charter or buy a new bank in the same world | Failed bank stays on the player's record. |
| D9 | Engine is pure; UI is a viewer | |
| D10 | Simplification must be aggregation, not fiction | |
| D11 | Borrowers are generated per town with hidden true risk; player sees the credit memo, not the truth | Superseded in part by D32: the memo is a legible puzzle, not truth plus noise. |
| D12 | Rival banks run on the same engine as the player | Pools only, per D29. |
| D13 | Regional economy layer sits on a national layer | Regions are real counties and metros from data (D40, D41), later countries. |
| D14 | Size thresholds change the rules | $10B Durbin, $50B, $100B stress tests, $250B SIFI, global systemically important at ~$1T. |
| D15 | Every bank's financials in the world are open to the player | Call report style. |
| D16 | Securities book is a treasury function only | Swaps for rate hedging unlock at regional scale. |
| D17 | Advisor cards on by default, dismissible | |
| D18 | No em dashes or en dashes in player-facing text | |
| D19 | Player is CEO and controlling shareholder. Light personal wealth layer: cash plus bank stock | No personal trading, no side companies. |
| D20 | Loan decisions scale by a delegation dial: loans above a dollar size or below a grade come to the player, the rest auto-decide under the written loan policy | Dial at zero means every loan crosses the desk. CCO skill affects auto-decision quality. |
| D21 | Bank can IPO once it clears ~$1B assets. Stock price driven by earnings, growth, credit quality, capital, and market regime | Stock is acquisition currency and a personal wealth lever. |
| D22 | People layer is key officers only: CFO, CCO, CLO, later COO and business line heads | Skill, cost, tenure, loyalty. Can be hired, fired, poached. |
| D23 | Whole state visible from day one on a real map | Superseded by D39: the whole US is visible; the player's home state is where they start. Distance and unfamiliarity still cost money and information. |
| D24 | Nobody above the CEO: no board that fires you, no activists, no hostile bids on the player's bank | Rivals still compete hard (D35). |
| D25 | Expansion: home metro, home state and neighbors, whole US, then global | Superseded in part by D39. |
| D26 | Business line order: mortgage, cards, wealth, investment banking and trading | Each a P&L with real drivers. |
| D27 | Open-ended runs, hundreds of hours, time runs indefinitely | |
| D28 | Failure sequence is Friday closure, weekend P&A, Monday out | |
| D29 | Two credit representations. Relationship book: individual loans, player's bank only, capped (~500 loans, the largest and newest). Pools: count, balance, grade distribution, vintage curve, for everything else and for all rivals. Loans roll from the relationship book into pools when they fall below the cap | The player can always drill from a pool to a sample of representative loans, generated on demand from the pool's distribution, never stored. |
| D30 | Daily tick is light; monthly close is heavy. Accrual, credit migration, economy, regulation, rival AI, and stock price all run monthly. Daily handles cash, deposit flows, pending decisions, and the event stream | Keeps 300 banks over 40 years under a minute. |
| D31 | Realism first, enjoyment second. Accounting is honest, returns are real (~1% ROA for a good bank), cycles come at real frequency. No hidden growth multipliers. Enjoyment comes from legibility (D34), the event stream (D33), a credit puzzle worth solving (D32), and time compression (D3). The run to JPM is expected to take 100+ game years | Real accelerators only: M&A, stock currency, banking crises that put rivals up for sale cheap, and leverage. |
| D32 | The credit memo is a legible puzzle. True PD/LGD is a function of visible fields (DSCR, LTV, leverage, sector, guarantor, payment history, collateral type, tenure) plus a small hidden component. A careful reader can get close. CCO skill reduces the work (better summaries, flagged red flags), never replaces it. Every default reports which visible signal predicted it | The player must be able to get better at underwriting. |
| D33 | Event stream. The daily tick emits real-source events (borrower, depositor, rival, officer, regulator, market) to a news feed. Most are informational. A subset pauses. Density is tuned so a normal day has something to read and a normal week has something to decide | No scripted flavor. Every event traces to an engine state change. |
| D34 | Quarterly earnings review with full attribution: income by book, cost by deposit type, losses by loan and by originating decision and date, overhead, provision, tax. Player-approved loans are tagged so losses attribute to the player's own calls | This screen ships in Phase 2, not at the end. |
| D35 | Rivals are active antagonists. They price to take deposits, poach officers, outbid on acquisitions, and open branches against the player. A bigger, better-run rival can put the player's bank into decline | Replaces the board as the late-game threat. |
| D36 | Play gate after every phase. The owner plays the build for at least 30 minutes before the next phase starts. Phase 2 has a formal Feel gate: one town, one bank, is underwriting fun? Nothing after Phase 2 is built until the answer is yes | |
| D37 | Calibration lives in one file with sources and a verified flag. Unverified constants are shown in the debug panel as unverified | The owner checks numbers against FDIC QBP, call report schedules, Fed H.8, FRED. |
| D38 | UI spec is DESIGN.md (Part 3). Terminal, tables, monospace numbers, keyboard-first. Map is the only graphical surface | |
| D39 | Player can start in any major US city: every metro area with population over roughly 250,000 (about 200 metros). The home metro is chosen at start; the whole US map is visible from day one. West Texas is one option, not the default | Charter capital and starting bank size scale with the metro. A New York start is a different game from a Lubbock start and the engine does not special-case either. |
| D40 | Every county carries real public data: population, median household income, average wage, employment, and industry mix by sector, plus home prices and unemployment where available. Sources and fields are fixed in SYSTEMS.md (Part 2). Data is loaded from files built by a script, never typed in | This replaces hand-authored regions. Realism first. |
| D41 | Regional economies are derived, not authored. Each county's exposure to a national sector index (energy, ag, manufacturing, tech, finance, healthcare, government, tourism, construction, logistics) is its real employment share in that sector. A regional shock is a sector shock times local exposure | The Permian is oily because the data says so, not because a file says "Permian: oil." |
| D42 | Rival scoping by geography. Banks in the player's home state and neighboring states are simulated individually (pools). Banks in every other state are one aggregate per state until the player enters it, at which point they expand into individual banks from the aggregate | Keeps the US-wide world under the performance budget. Aggregation, not fiction: state aggregates carry real total assets, deposits, and bank counts from FDIC data. |
| D43 | Borrower generation uses local data. Borrower types, incomes, collateral values, and sector mix are drawn from the county's real income distribution, home prices, and industry shares | A dentist in Manhattan and a dentist in Odessa are different loans. |
| D45 | The global stage is a country layer: each country carries its own activity index, policy rate, curve, currency, deposit pool, banking sector, regulator and sovereign spread, all as hand bands until a calibration script sources them. Foreign subsidiaries keep their books in local currency and translate into the consolidated dollar ledger at each close, with the translation difference in AOCI. They live on the LINES screen until the world map ships | Aggregation of real structure, not a second engine: the same pool, deposit and capital code runs inside every subsidiary. |
| D46 | An Economy screen (key c): where to lend ranks every loan type by borrowers a year (from the county mix and the arrival model), the market rate, the loss environment (the visible part of the stress every pool feels), the expected loss on the book at that stress, and the margin after losses; the cycle names the stage, what it means, what usually follows and what a bank does about it, with rates, the curve, jobs, prices, housing and oil; sectors show each index's move and the home county's share of it. Everything is computed from visible state and the engine's own rules; the hidden borrower term stays hidden | The player asked how to read the market. A CCO's briefing, not a cheat sheet. |
| D47 | A loan rate sheet on Lending: the player prices each loan type against the market in basis points, as with deposits. Under market brings more borrowers of that type at the calibrated elasticity (a hand band, `loanRateElasticity`) and every memo carries the offset; over market sends them to rivals. Arrivals per type are exact: the day's Poisson rate rises to the best multiplier and each application is kept with its own type's odds against it | Real banks compete on price by product. Demand elasticity is unsourced until a study is found; the band says so. |
| D48 | When the FDIC and FRED hosts are unreachable and no public mirror exists, the banking sector and the four short rates come from hand bands in `data/calibration.ts` (verified: false) rather than from nothing: county deposit pools follow real personal income, the number of banks follows population, sizes follow a lognormal spread, the national giants sit in the largest counties, and the December 2024 short rates are typed. The data files stay honest (zero totals, no seeds, hand values named in the manifest); the engine generates the rest at world creation, deterministically by seed, and the real FDIC list and FRED files replace all of it the moment fetch-data lands them | Rivals are generated either way (rule 13); what the FDIC list adds is their real sizes and state totals. Until it lands, every bank-count and size test is tagged unverified. |
| D44 | Business lines (D26) live on their own screen, LINES, key n. Each line shows its P&L, its balance sheet footprint, and its on/off switch with the setup cost. Capital actions (raise, IPO, buyback, secondary, share sales, holding company) live on ME. Deals live on RIVALS: every bank row has an offer key, and auctions arrive as pending decisions | Adds one screen to the v1 list in Part 3. |

## Open questions (decide when the phase arrives)
- Relationship book cap: 500 loans, or scaled to bank size?
- How many rival banks per state at start. Target: match the real FDIC count per state, aggregated into fewer, larger generated banks where the real count is too high for the budget.
- Data refresh policy: freeze one vintage of each dataset (2023 or 2024) as the world's starting point, or allow updates.
- Whether metros under 250,000 are startable as a hard mode.
- Whether generated private investors in a pre-IPO raise get any rights. Lean: passive.
- Currency and sovereign risk model for global stage.
- Whether officers can commit fraud. Lean: errors yes, fraud backlog.
- Whether time compression at top speed should also compress the event stream (fewer, bigger events) so the feed stays readable.

# Part 3: Desk style

The desk is a modern operator's console: a dark screen built for the mouse, with the substance of a call report behind every panel. Reference points: a trading desk's risk monitor, a well made brokerage app, and the schedules of an FDIC call report (RC, RI, RC-N, RC-C) for what the numbers are.

## Rules
- Mouse first, keyboard second. Every screen is a tab in a bar at the top; every action is a button; every decision is a dialog with buttons. Keyboard shortcuts remain for the same things and are shown as hints, never required.
- A persistent top bar carries the bank's name, the date, the clock (pause, play, five speeds) and the numbers a CEO watches every day: assets, capital, cash, net worth, with a status pill for the capital category.
- One dark palette: a blue-black ground, raised panels, one amber accent for what is active or wants attention, green for good, red for trouble. Nothing else colored. No gradients, no decorative art.
- Sans-serif for words, monospace for numbers. Numbers right-aligned with tabular digits, negatives in parentheses. Every dollar figure carries its own scale so nobody counts zeros: $850, $12.3K, $50.55MM, $1.20B. Counts keep thousands separators.
- Panels, not tiles: every panel is a titled table with a header row, and a panel can hold a form. No dashboards of big numbers except the strip in the top bar.
- Every number is drillable. Click a total and see the lines. Click a row and see the loan, the branch, the officer.
- A decision that pauses the clock opens a dialog in the middle of the screen with large labelled buttons. A decision that does not pause the clock (an offer) sits beside the feed as a card, and the Feed tab shows a count.
- The feed is a list of one-line items with a date and a source, newest first, with a marker for good and bad news; the advisor and the economy sit beside it.
- The map is the one graphical surface: county outlines, metro dots by real population, branches, rivals, shading by sector or condition chosen with buttons. Hover shows the county's real stats; a button opens a branch.
- Comfortable density: readable at arm's length, with room between rows, and long pages scroll. A screen still shows as much as a call report page.
- Every screen opens with one line saying what it is for.
- No em dashes or en dashes.

## Layers
The desk answers the player's questions before it shows the schedules. Overview answers "how am I doing" with five gauges (capital, cash, loans, profit, growth), each with a plain word, a number, a status pill, one sentence of meaning and a link to the tab that changes it; a profit summary in plain words; sparklines; what to do next; the recent feed. Every screen opens with a summary and offers its detail on request (every line, the regulators' view, the pools). Every bank word carries a plain explanation on hover, from a glossary in `ui/glossary.ts`. Every decision shows "what this means" first, computed only from what the player can see. Every adjustable number moves by a fine step and a coarse step, and every amount can be typed. Every action answers with a short confirmation.

## Screens (v1)
Overview, Lending (your book, rate sheet, policy and dial, pools), Economy (where to lend, the cycle, sectors and your market), Money (deposits and cash, bonds, balance sheet and capital), Earnings (this period, where it came from, quarter over quarter, year over year), People, Market (rivals and deals, business lines, abroad), Map, You. Debug sits behind Help.
