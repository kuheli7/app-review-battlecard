# Test runs

Platform runs on Apify (account `kuheli7`, Actor `app-review-battlecard`), 22 Nov 2026; runs 00, 09 and 10 re-run on 24 Nov (00 and 09 with build 0.1.22, verdict written in code; 10 with build 0.1.23).
Each folder in `results/` has the input, the dataset item (`battlecard.json`), both HTML reports, the Markdown report and a `summary.json`.
Re-save any run with `python test-runs/fetch_run.py <name> <runId>`.

From the next build, `apps` is required and has no default, so an empty input `{}` fails before any work. Input 00 is now `{"apps":["Swiggy","Zomato"]}`; the 00 runs below used `{}` on older builds.

Unit tests: `npm test`, 57 passing (stats, theme shares, gaps and confidence, switching signals, issue counting, label agreement, name cleanup, name matching, report escaping, verdict and AI-line checks, quote picking).

## Runs

| # | Test | Build | Result | Time | Label check |
|---|---|---|---|---|---|
| 00 | Default input `{}`: Swiggy vs Zomato (older runs in `00-...-build0.1.18` and `-build0.1.21`) | 0.1.22 | SUCCEEDED, verdict built in code, 0 AI lines replaced | 11.4 s | 83.3% of 30 |
| 01 | Rides: Uber vs Ola, Rapido | 0.1.15 | SUCCEEDED | 12.5 s | 86.7% of 30 |
| 02 | Payments: PhonePe vs Google Pay, Paytm | 0.1.18 | SUCCEEDED | 10.9 s | 86.4% of 22 |
| 03 | Shopping, 4 apps, one given as a Play URL | 0.1.15 | SUCCEEDED | 10.4 s | 83.3% of 30 |
| 04 | US store: Spotify vs YouTube Music | 0.1.16 | SUCCEEDED | 12.2 s | 83.3% of 30 |
| 05 | App Store: Duolingo vs Babbel | 0.1.16 | SUCCEEDED | 13.4 s | 56.3% of 16 |
| 06 | A rival name that doesn't exist | 0.1.18 | SUCCEEDED, rival skipped and named in the report | 9.0 s | 90% of 30 |
| 07 | Only one app | 0.1.18 | FAILED with a clear message (expected) | 1.8 s | - |
| 08 | Run started from the Console form: 4 ride apps | 0.1.16 | SUCCEEDED | 11.1 s | 73.3% of 30 |
| 09 | Nickname: GPay vs PhonePe, Paytm (0.1.21 run with the mixed-up AI verdict in `09-...-build0.1.21`) | 0.1.22 | SUCCEEDED, "GPay" matched Google Pay; verdict says "No clear gap yet" because every gap rests on few complaints | 11.3 s | 88.2% of 17 |
| 10 | Typo + duplicate: Swiggy, Swigy, Zomato (0.1.22 run with problem 8 in `10-...-build0.1.22`) | 0.1.23 | SUCCEEDED, "Swigy" skipped as the same app as Swiggy; verdict leads with the delivery gap | 10.8 s | 83.3% of 30 |

Run IDs and Console links are in each `summary.json`.

## Problems found and fixed

1. **Memory limit.** Runs started together failed with "exceed the memory limit of 16384MB" (each run asked for 4 GB). The default is now 1 GB (`actor.json` and the Actor's run options). All later runs fit.
2. **Vague reviews skewed the comparison.** Google Pay had 74% vague 1–2★ reviews ("worst app"), so its specific themes looked tiny and produced fake opportunities. Theme shares now use only specific complaints; vague ones are counted and shown separately. Compare `02-...-build0.1.15` with `02-...`.
3. **Long app names.** "PhonePe UPI Payments, Loan App" and "Amazon India Shop, Pay, miniTV" filled the report. Names are now cut to the brand (PhonePe, Myntra, Flipkart...).
4. **A mistyped rival was only in the log.** Skipped apps are now listed in the status message, the dataset item (`skippedApps`) and the report.
5. **Confidence on tiny samples.** A gap is now always "low" confidence when either app has fewer than 15 specific complaints (e.g. Google Pay's 9).
6. **Wrong app for a nickname.** "GPay" picked a 355-rating app titled "gpay" and "jio" picked JioSaavn. A typed name now goes to the most-rated matching app (Google Pay, MyJio), the status message says what was matched, and a repeated app ("Swigy" next to "Swiggy") is listed as skipped instead of dropped silently.
7. **The AI verdict mixed up numbers.** Run 09 said "PhonePe trails on 36.4% of complaints versus our 63.2%" (the shares were swapped). The verdict is now written in code (build 0.1.22). AI lines with a number, an unbacked claim ("fastest", "guaranteed") or too many words are replaced by templates, threat headlines are always templates, and quotes with concrete details beat generic ones ("please improve your system").
8. **The verdict led with a tiny gap.** Run 10 on 0.1.22 opened with "5.1% of Swiggy's complaints are about crashes and bugs, vs 0% of Zomato's" because the test was very sure of it, while the delivery gap (35.9% vs 21.8%) was much bigger. Gaps are now ordered by size, with low-confidence gaps last (0.1.23). AI entries are matched to themes whatever their case, and a card the AI left out is counted in `aiLinesReplaced`.

## Known limits

- App Store data is thin today (Apple's feed returns about 150 of 250 reviews), so Google Play is the default.
- The label check is weaker on small samples (56% on 16 Duolingo reviews). The report shows the sample size and confidence next to each gap.
- The AI still writes the opportunity headlines, marketing messages and threat actions, so their wording changes between runs. They contain no numbers.
