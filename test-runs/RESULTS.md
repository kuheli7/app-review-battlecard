# Test runs

Platform runs on Apify (account `kuheli7`, Actor `app-review-battlecard`), 22 Nov 2026.
Each folder in `results/` has the input, the dataset item (`battlecard.json`), both HTML reports, the Markdown report and a `summary.json`.
Re-save any run with `python test-runs/fetch_run.py <name> <runId>`.

Unit tests: `npm test`, 33 passing (stats, theme shares, gaps and confidence, switching signals, issue counting, label agreement, name cleanup, report escaping).

## Runs

| # | Test | Build | Result | Time | Label check |
|---|---|---|---|---|---|
| 00 | Default input `{}`: Swiggy vs Zomato | 0.1.18 | SUCCEEDED | 10.8 s | 80% of 30 |
| 01 | Rides: Uber vs Ola, Rapido | 0.1.15 | SUCCEEDED | 12.5 s | 86.7% of 30 |
| 02 | Payments: PhonePe vs Google Pay, Paytm | 0.1.18 | SUCCEEDED | 10.9 s | 86.4% of 22 |
| 03 | Shopping, 4 apps, one given as a Play URL | 0.1.15 | SUCCEEDED | 10.4 s | 83.3% of 30 |
| 04 | US store: Spotify vs YouTube Music | 0.1.16 | SUCCEEDED | 12.2 s | 83.3% of 30 |
| 05 | App Store: Duolingo vs Babbel | 0.1.16 | SUCCEEDED | 13.4 s | 56.3% of 16 |
| 06 | A rival name that doesn't exist | 0.1.18 | SUCCEEDED, rival skipped and named in the report | 9.0 s | 90% of 30 |
| 07 | Only one app | 0.1.18 | FAILED with a clear message (expected) | 1.8 s | - |
| 08 | Run started from the Console form: 4 ride apps | 0.1.16 | SUCCEEDED | 11.1 s | 73.3% of 30 |

Run IDs and Console links are in each `summary.json`.

## Problems found and fixed

1. **Memory limit.** Runs started together failed with "exceed the memory limit of 16384MB" (each run asked for 4 GB). The default is now 1 GB (`actor.json` and the Actor's run options). All later runs fit.
2. **Vague reviews skewed the comparison.** Google Pay had 74% vague 1–2★ reviews ("worst app"), so its specific themes looked tiny and produced fake opportunities. Theme shares now use only specific complaints; vague ones are counted and shown separately. Compare `02-...-build0.1.15` with `02-...`.
3. **Long app names.** "PhonePe UPI Payments, Loan App" and "Amazon India Shop, Pay, miniTV" filled the report. Names are now cut to the brand (PhonePe, Myntra, Flipkart...).
4. **A mistyped rival was only in the log.** Skipped apps are now listed in the status message, the dataset item (`skippedApps`) and the report.
5. **Confidence on tiny samples.** A gap is now always "low" confidence when either app has fewer than 15 specific complaints (e.g. Google Pay's 9).

## Known limits

- App Store data is thin today (Apple's feed returns about 150 of 250 reviews), so Google Play is the default.
- The label check is weaker on small samples (56% on 16 Duolingo reviews). The report shows the sample size and confidence next to each gap.
- The AI writes the verdict and messages, so their wording changes between runs; the numbers are computed in code.
