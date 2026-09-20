# SYSTEMS

Two parts: the systems map, then the data.

# Part 1: Systems map

Each system: what it owns, cadence, what it reads and writes, and the invariants its headless test checks. Cadence per D30: daily (light) or monthly (heavy).

## 1. Ledger (balance sheet and income)
Cadence: daily cash and deposit movement; monthly accrual and close; quarterly call report.
Owns: every account for every bank. Assets (cash, reserves, securities AFS/HTM, loan pools and relationship book, REO, premises, goodwill). Liabilities (checking, savings, MMDA, CDs, brokered, FHLB, fed funds, sub debt). Equity (common, retained earnings, AOCI).
Invariants: A = L + E every tick for every bank. Monthly interest equals balance x rate x days/365 summed. No negative cash without an overdraft event.

## 2. Rates and the economy
Cadence: monthly.
Owns: Fed funds path, yield curve, national GDP/unemployment/inflation, national home price index, and one national index per sector: energy, agriculture, manufacturing, tech, finance, healthcare, government, tourism and leisure, construction and real estate, logistics and trade.
Local economies (D40, D41, SYSTEMS.md (Part 2)): every county carries real population, income, wages, employment, and industry shares. A county's condition is the weighted sum of sector indices by its real employment share, plus a local home price path anchored to the national index and local supply data. Metros are county groups per the OMB definitions in the data.
Cycle model: regime-switching (expansion, late cycle, recession, recovery) with seeded shocks. Some recessions are banking crises (credit-driven, many failures, S&L or 2008 shape); most are not. Sector indices have their own paths and correlations (energy follows oil, tech is high beta, government is flat). Generator runs forever.
Invariants: curve within historical bounds. Recessions average every 7 to 12 years across seeds. Roughly one in three recessions is a banking crisis. Energy has at least one 50% drawdown per 15 years on average. A county with 30% energy employment moves at least 3x as much as one with 2% in an energy shock.

## 3. Credit (the core)
Cadence: daily applications and payments; monthly migration, reserve, pool roll.
Owns: borrowers, applications, relationship book, pools, delinquencies, workouts, foreclosures, REO, allowance, charge-offs, recoveries, loan policy, delegation dial.
Two representations (D29):
- Relationship book: individual loans for the player's bank, capped. Each has a borrower, a memo, a decision record (who approved, when, under what policy), and a full lifecycle.
- Pools: per bank, per loan type, per vintage year. Count, balance, grade distribution (buckets 1 to 9), delinquency buckets, cumulative loss. Migration matrix moves balance between grades monthly, driven by the economy. Rivals are pools only.
Borrower and memo (D32, D43): type drawn from the county's real industry mix, income from its real distribution, collateral values from its real home prices and wage levels, then DSCR, LTV, leverage, guarantor, collateral type, payment history, tenure in business. True PD/LGD is a function of these plus a small hidden term. Memo shows the fields; CCO skill adds a summary and flags red flags.
Loan types: C&I, CRE (owner occupied and investor), construction, 1-4 family, consumer/auto, ag, oil and gas reserve-based.
Decision path: above the dial, pause with the memo: approve / counter (rate, LTV, term, guarantee) / decline. Below the dial, auto-decide under written policy with error driven by CCO skill.
Losses: PD moves with regional and national indices and sector. LGD moves with collateral values. Concentration multiplies correlation inside a sector. Reserve: CECL-style, quarterly. Every default emits an attribution event naming the predictive signal and the originating decision (D34).
Invariants: cumulative net charge-offs over 20 year runs in FDIC bands per type. Scripted Permian bust pushes energy losses to a plausible peak. No loan both current and charged off. Dial at zero routes 100% of applications. A player who approves only loans with DSCR > 1.5 and LTV < 65% has measurably lower losses than one who approves everything, across seeds.

## 4. Deposits and funding
Cadence: daily flows; monthly rate resets and beta updates.
Owns: deposits by type per branch, rate sheet, betas, stickiness, runs, brokered, FHLB capacity, fed funds, later swaps.
Branches on real counties and metros. Fixed cost scales with local wages and rents from the data. County deposit pools are derived from real population, income, and FDIC deposit totals. Share capture vs rivals based on rate, branch count, years in market, reputation. Distance penalty for far-from-home branches.
Run trigger: capital ratio, unrealized loss vs equity, and rival failure news combine into confidence. Uninsured runs first.
Invariants: county deposits across all banks equal the county pool. Deposit cost tracks Fed funds with plausible beta by type. Fed +400bp shock produces outflow and unrealized loss in plausible bands.

## 5. Officers
Cadence: monthly.
Owns: CFO, CCO, CLO, later COO and business line heads. Skill, salary, tenure, loyalty.
Effects: CCO sets memo summary quality, red flag detection, auto-decision error. CLO sets origination volume and pricing. CFO sets funding cost, securities execution, and report quality; the CFO also runs the deposit sheet and the investment policy the CEO sets (D50). Officers ask for raises and resign when disloyal; nobody poaches them (D22).
Invariants: 90 CCO vs 30 CCO shows measurably lower auto-decision loss across seeds.

## 6. Rivals
Cadence: monthly.
Owns: every non-player bank, pools only, scoped per D42: individual banks in the home state and neighbors, one aggregate per other state until entered. AI policy per bank: risk appetite, growth target, rate aggressiveness, acquisitiveness. Generated to match real FDIC counts and size distribution per state, plus a handful of national banks present in every major metro.
Behavior (D35): price for deposits, open branches against the player, bid on the same acquisitions, fail.
Invariants: failures cluster in recessions and spike in banking crises. Some small banks are always for sale. 300 individual banks plus 50 state aggregates over 40 years runs under 60 seconds. Expanding a state aggregate into individual banks conserves total assets and deposits.

## 7. Event stream (D33)
Cadence: daily.
Owns: the news feed and the pending decision queue. Sources: borrower (application, missed payment, payoff, request for exception), depositor (large inflow/outflow, rate complaint), rival (branch opened, rate change, failure, for sale), officer (raise request, outside offer, resignation), regulator (letter, exam scheduled, finding), market (Fed move, curve shift, oil, regional index).
Every event references the state change that produced it. Density targets: a normal day has one to three feed items; a normal week has one pause.
Invariants: no event without a state change behind it. Pause frequency within the target band across seeds.

## 8. Earnings review (D34)
Cadence: quarterly.
Owns: the attribution report. Income by book, cost by deposit type, losses by loan and by originating decision and date, overhead, provision, tax. Ties to the ledger to the dollar.
Invariants: report totals equal ledger net income every quarter.

## 9. Personal wealth
Cadence: monthly.
Owns: player cash, shares, salary, dividends, stock sales, flat tax.
Score: cash plus shares at book (private) or market (public).
Failure: shares to zero, cash stays, record follows.
Invariants: dividends reduce bank equity by exactly what they add to player cash pro rata.

## 10. Capital markets and IPO
Cadence: monthly.
Owns: private raises, IPO at size floor, stock price model, buybacks, dividends, secondaries, stock as acquisition currency.
Price: earnings, growth, credit quality, capital, market regime. Dilution tracked.
Invariants: shares x price = market cap; ownership sums to 100%.

## 11. M&A and scaling
Cadence: monthly.
Owns: holding company, FDIC assisted auctions (loss share, weekend timing), whole bank deals (cash, stock, mix), purchase accounting, integration cost, deposit attrition, regulatory approval time, rival competing bids.
Geography: home state, neighbors, whole US, countries. Entering a new state expands its aggregate (D42).
Business lines by threshold, in order: mortgage banking (originate, sell, service, MSR), cards (receivables, loss curves, interchange), wealth (AUM, fees), investment banking and trading (fees, VaR-lite).
Invariants: purchase accounting balances. Acquired deposits attrite in a plausible band. A crisis year produces measurably cheaper deals than an expansion year.

## 12. Regulation
Cadence: monthly ratios; exams on a cycle.
Owns: capital ratios, CAMELS, enforcement ladder, PCA, closure, insurance assessments, size thresholds, later foreign regulators. Phase 1 version: leverage ratio only, closure below 2%.
Invariants: below PCA gets escalating actions and closure if not recapitalized in the window.

## 13. Map and desk (UI contract)
Map: US counties from GeoJSON, metros outlined, branches, rivals per county, sector exposure overlays from real data. Start screen is the map with startable metros highlighted. Expands to countries later.
Desk: per DESIGN.md (Part 3). Screens: feed, balance sheet, income, loan book, funding, officers, rivals, wealth, earnings review, debug (unverified constants).
Engine returns `{ state, pending, events }`. Decision types: loan application, exception request, rate prompt, exam result, enforcement, acquisition offer, competing bid, officer event, capital raise, IPO window, failure sequence.

## Data flow
Economy -> Credit (migration, PD/LGD) and Deposits (rates, runs) -> Ledger -> Regulation and Capital markets -> Personal wealth -> Rivals and M&A -> Event stream and Earnings review (read everything) -> Economy (failures feed back).

# Part 2: Data

Every county in the game carries real public data. This file fixes the sources, the fields, the download, and the build. Two scripts, both run by Claude Code: `scripts/fetch-data.ts` downloads every raw file into `raw/` from the no-key URLs below, and `scripts/build-data.ts` turns them into `data/*.json`. The owner does nothing by hand. Never hand-author or estimate a value that a listed source provides.

## Download rules
- Every source below has a public URL that needs no API key or account. Use those. Do not use endpoints that require registration; if a URL has moved, search the same agency's site for the current bulk file and record the new URL in `data/manifest.json`.
- Downloads are idempotent: skip a file that already exists with the expected size. `--force` re-downloads.
- Log every URL, HTTP status, byte count, and SHA-256 to `raw/manifest.json`.
- Large files (QCEW is a few hundred MB) are streamed to disk, not held in memory.

## Vintage
Freeze one year per source as the world's 2024 starting point. Record the vintage in `data/manifest.json`.

## Sources and fields

Bulk download URLs (verify each at run time; agencies move files):
- Census PEP county totals: https://www2.census.gov/programs-surveys/popest/datasets/ under the latest `2020-20XX/counties/totals/co-est20XX-alldata.csv`
- Census ACS 5 year: the Census API without a key allows enough calls for a one-time pull of a few tables for all counties. Endpoint pattern: https://api.census.gov/data/20XX/acs/acs5?get=NAME,B19013_001E,B25077_001E,B25064_001E,B01003_001E&for=county:*
  If throttled, fall back to the ACS summary file CSVs under https://www2.census.gov/programs-surveys/acs/summary_file/
- BLS QCEW county annual averages, all industries by ownership: https://data.bls.gov/cew/data/files/20XX/csv/20XX_annual_singlefile.zip
- BLS LAUS county annual averages: https://www.bls.gov/lau/laucntycur14.txt (current) and https://www.bls.gov/lau/ annual tables `laucntyXX.xlsx`
- BEA GDP by county (CAGDP2, all industries): https://apps.bea.gov/regional/zip/CAGDP2.zip
- FHFA HPI county and metro annual: https://www.fhfa.gov/hpi/download/annual under "Counties (Developmental Index)" and "Metropolitan Areas" CSVs
- OMB CBSA delineation file: https://www.census.gov/geographies/reference-files/time-series/demo/metro-micro/delineation-files.html (latest `list1_20XX.xls`)
- FDIC institutions and financials: public API, no key: https://banks.data.fdic.gov/api/institutions?filters=ACTIVE:1&fields=CERT,NAME,STALP,ASSET,DEP,OFFICES&limit=10000&format=json and https://banks.data.fdic.gov/api/financials for call report fields used in calibration
- FDIC Summary of Deposits by county: https://www7.fdic.gov/sod/ bulk download, or the API `/api/sod` if available
- FRED series as CSV without a key: https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS (and DGS3MO, DGS2, DGS10, DGS30, CPIAUCSL, UNRATE, DCOILWTICO, CSUSHPISA, SP500)
- Census cartographic county boundaries 1:5m: https://www2.census.gov/geo/tiger/GENZ20XX/shp/cb_20XX_us_county_5m.zip, converted to simplified GeoJSON in the build


| Dataset | Source | Level | Fields used |
|---|---|---|---|
| Population | Census Bureau, Population Estimates Program (PEP) | County | Total population, 5 year growth rate |
| Income | Census Bureau, American Community Survey 5 year (ACS, table S1901 and B19001) | County | Median household income, income distribution buckets, per capita income |
| Wages and employment by industry | Bureau of Labor Statistics, QCEW (annual averages) | County | Total employment, average weekly wage, employment and wages by NAICS supersector (used for sector exposure, D41) |
| Unemployment | BLS, LAUS | County | Unemployment rate, labor force |
| GDP | Bureau of Economic Analysis, GDP by county | County | Real GDP, industry composition |
| Home prices | FHFA House Price Index (county and metro, annual) | County/metro | Index level, 5 year change |
| Housing | ACS tables B25077 (median home value), B25064 (median rent), B25002 (units, vacancy) | County | Median value, median rent, vacancy |
| Metro definitions | OMB CBSA delineation file | County to metro | Which counties form each metro, metro population rank |
| Bank counts and totals | FDIC BankFind / Summary of Deposits, Institution Directory | State and county | Number of institutions, total assets, total deposits by county and state (for D42 aggregates and rival generation) |
| National series | FRED | National | Fed funds, Treasury curve, CPI, unemployment, oil (WTI), Case-Shiller, S&P 500 (for calibration only, D37) |
| Geography | Census TIGER county shapefiles, simplified to GeoJSON | County | Boundaries, centroids |

## Alternate public mirrors
Some networks refuse every agency host above (census.gov, bls.gov, bea.gov, fhfa.gov, fdic.gov, fred.stlouisfed.org). The same datasets are republished by third parties on hosts that stay open; `scripts/lib/sources.ts` lists each mirror with its provenance and the primary it stands in for, `scripts/fetch-data.ts` fetches both, and `scripts/build-data.ts` takes the agency file when it is on disk and the mirror otherwise, recording which in `data/manifest.json`. Mirrors are the same public data, not substitutes for it; a field with no mirror is null or, for the banking sector and four short rates, generated in the engine from hand bands (D48).

| Primary | Mirror | What it carries | Vintage |
|---|---|---|---|
| Census ACS 5 year (county API) | UC Riverside Center for Geospatial Sciences open bucket `spatial-ucr`, `census/demographic_profile/<year>/acs_<year>_X..._tract.parquet` (Census summary file geodatabase tables as parquet) | X01 B01003 population; X19 B19001 income buckets and B19313 aggregate income; X23 B23025 labor force; X24 C24030 employed residents by industry; X25 B25002 units, B25075 value buckets, B25063 rent buckets. Summed from tracts to counties; medians interpolated within the bucket holding the middle household | 2017 to 2021 release (the last with Connecticut's counties); 2012 to 2016 release for the five year population growth |
| Census PEP | the ACS X01 tables above | population and five year growth | as above |
| BLS QCEW | ACS C24030 (sectors, employment) and Census County Business Patterns 2019 via the JsonOfCounties compilation (`evangambit/JsonOfCounties`, `counties.json`) | employed residents by D41 sector; employment; average weekly wage = CBP annual payroll over employees, divided by 52 | 2021; CBP 2019 |
| BLS LAUS | ACS B23025 | labor force, unemployment rate | 2021 |
| OMB delineations | `spatial-ucr`, `census/administrative/msa_definitions.parquet` | county to CBSA, metropolitan or micropolitan | 2020 |
| Census county boundaries | `us-atlas` (npm), built from the Census cartographic files | boundaries and centroids; the compilation's TIGER 2017 centroid when a county postdates the boundary file | 2017 |
| FRED DGS10, CPIAUCSL, DCOILWTICO, SP500, CSUSHPISA, UNRATE | datahub.io core datasets on GitHub (`datasets/bond-yields-us-10y`, `cpi-us`, `oil-prices`, `s-and-p-500`, `house-prices-us`, `employment-us`) | the same series, monthly (UNRATE annual) | through the as-of date |
| FRED FEDFUNDS, DGS3MO, DGS2, DGS30 | none found | hand bands in `data/calibration.ts` (`startFedFunds` and friends, verified: false) | December 2024 |
| BEA GDP by county | none found | `gdp` is null | |
| FHFA HPI | none found | `hpi` is null; the county median home value carries the level | |
| FDIC institutions and Summary of Deposits | none found | states carry zero bank totals and no seeds; the engine generates the sector from hand bands (D48) and the real list replaces it when it lands | |

With the mirrors, `sectors` are shares of employed residents by industry (where people live) rather than of jobs by workplace; the ACS publishes 54 (professional, scientific and technical) whole, so `tech` is 51 plus all of 54; `government` is public administration.

## Sector mapping (D41)
QCEW NAICS supersectors map to the game's ten sector indices:
- Energy: mining, quarrying, oil and gas extraction (NAICS 21) plus oil and gas support (213), petroleum products (324), pipelines (486)
- Agriculture: 11
- Manufacturing: 31 to 33 (excluding 324)
- Tech: 51, 5415, 5417
- Finance: 52
- Healthcare: 62
- Government: public administration and federal, state, local government ownership codes
- Tourism and leisure: 71, 72
- Construction and real estate: 23, 53
- Logistics and trade: 42, 44 to 45, 48 to 49
Anything unmapped goes to a residual "other services" bucket that tracks national GDP.

## Startable metros (D39)
Every CBSA with population above 250,000 in the frozen vintage. Store rank, population, and principal city. The start screen sorts by population.

## Output files
- `data/counties.json`: one record per county with every field above and sector shares summing to 1.
- `data/metros.json`: CBSA id, name, principal city, counties, population, startable flag.
- `data/states.json`: totals for D42 aggregates: bank count, total assets, total deposits, population.
- `data/national.json`: frozen starting values for the national series.
- `data/manifest.json`: source, vintage, download date, row counts for every input.

## Suppression and gaps
QCEW suppresses county cells with few employers, and ACS has wide margins in small counties. The build fills a suppressed sector share from the state's share for that sector, renormalizes, and sets `imputed: true` with a list of which fields were filled. The build fails only when a whole record is missing, not when a cell is suppressed. Imputed counts are reported in the manifest.

## Fixtures
`scripts/build-data.ts --fixtures` writes `data/fixtures/` with about 20 real counties across 5 metros (one energy metro, one tech, one manufacturing, one government, one tourism) for tests. Same script, same rules, smaller set.

## Calibration from FDIC data
`scripts/calibrate.ts` pulls quarterly call report aggregates from the FDIC financials API for all active institutions over the longest available window (2000 onward is enough), buckets by asset size, and computes bands for: net charge-off rate by loan type (RC-N and RI-B fields), ROA and NIM by size bucket, cost of deposits vs Fed funds (deposit beta), noninterest expense to assets, and annual failure counts. It writes them to `data/calibration.ts` with `verified: true`, the query, the window, and the date. Anything the script cannot compute stays hand-entered with `verified: false`.

## Build rules
- The build fails if any county is missing population, income, employment, or sector shares.
- The build fails if any startable metro lacks a home price datum: the FHFA metro index when FHFA is on disk, else a county median home value.
- Values are stored as given; unit conversions are done once in the build and documented in the manifest.
- The game never edits these files at runtime. They are the world's day one and the sim moves from there.
