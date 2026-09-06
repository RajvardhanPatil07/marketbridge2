# Four-minute MarketBridge walkthrough

Run `make demo` from the repository root and open [http://localhost:8000](http://localhost:8000). Rehearse with `make verify` passing first. The walkthrough uses fixture timestamps, not elapsed presentation time. All prices, sources, and outcomes are synthetic; there are no real orders or live feeds.

Start on **Market overview**, choose NVDA, and use **Explore a scenario** to select the named scenario. Each selection resets playback to 00:00. The **Replay timeline** slider supports one-second steps; use **Step forward** for exact transitions. **Play replay**, **Pause replay**, **Reset replay**, and **Speed** control local playback. Use 4× speed for a quick overview, then pause and scrub to the times below.

| Presentation time | Action | Explain |
| --- | --- | --- |
| 0:00–0:25 | Point to **Synthetic demo**, the chart legend, and **Model range · uncalibrated**. | “MarketBridge demonstrates how a reference can expose its evidence and stop publishing when evidence is insufficient. This run uses synthetic inputs and a rule-based model.” |
| 0:25–0:45 | Choose **Normal market**. Play briefly, pause at 00:12, and expand a row in **Source evidence**. | “Small qualified observations update the reference. Each source preserves its original family and event time. The QQQ factor line is a separate comparison.” |
| 0:45–1:15 | Choose **Isolated bad print**. Scrub to 00:24, then select **Step forward** to reach 00:25. | “An unsupported 24% print enters quarantine. The reference becomes unavailable, current valuation is unresolved, and new paper exposure is blocked. At 00:25 the corrected observation permits recovery. This is a hypothetical position comparison, not verified avoided loss.” |
| 1:15–1:45 | Choose **Corroborated repricing**. Inspect 00:24 and then 00:27. | “The 18% move is genuine in this fixture. The engine abstains until another original source family corroborates it. It then admits the repricing even though QQQ is flat. A guard must recognize real moves as well as bad prints.” |
| 1:45–2:15 | Choose **Feed dropout**. Inspect 00:26, 00:31, and 00:44. | “Underlying observations stopped after 00:20. Age produces caution at 00:26 and abstention at 00:31. Fresh evidence resumes at 00:44. Continuing QQQ updates do not make the missing stock observation fresh.” |
| 2:15–2:40 | Choose **Verified reopening**. Inspect 00:23 and step to 00:24. | “The new opening observation re-anchors the reference because the fixture explicitly marks it as a verified official auction. An ordinary source cannot obtain that authority merely by repeating a price.” |
| 2:40–3:05 | Choose **Single-source jump**. Inspect 00:24 and 01:00; expand the original and reseller source rows. | “Both belong to the same original family. Repetition does not establish independent corroboration, so the reference remains unavailable. In this fixture the move is real: abstention has an availability cost and does not erase the position's loss.” |
| 3:05–3:30 | Select TSLA in **Chart symbol** or **Tracked stocks**, then select **Export trace**. Expand **Position & simulation assumptions** under **Paper account**. | “The second symbol runs the same rules. The export contains the full synthetic trace and assumptions. The paper comparison uses the unguarded primary feed; it does not use the QQQ factor baseline as its mark.” |
| 3:30–4:00 | Open **Evaluation**, select **Download results**, then open **Methodology**. | “These are reproducible functional checks against fixture truth. The model uses a unit-beta factor rule, has no fitted ridge coefficients, and has no calibrated prediction bands. Research motivates the method; these results do not establish real-stock accuracy.” |

## Before presenting

- Confirm all six scenario titles are available and the page starts paused at 00:00.
- Check that trace and results exports download JSON marked `SYNTHETIC_TEST`.
- Show `—` and the separate last-valid label during abstention; do not describe the old estimate as a current stock value.
- Read actual evaluation counts from the report. Do not substitute a promised accuracy improvement or historical sample count.

## Local fallback

Use the built app on port 8000 if a hosted URL is unavailable. No market-data connection is needed. If the UI cannot be used, export the same engine outputs from the repository root:

```sh
make evaluate
SCENARIO=bad-print SYMBOL=NVDA make replay
SCENARIO=genuine-move SYMBOL=NVDA make replay
```

These commands write `artifacts/evaluation.json`, `artifacts/bad-print-NVDA.json`, and `artifacts/genuine-move-NVDA.json`. Present them as synthetic functional evidence with the same limitations as the UI.
