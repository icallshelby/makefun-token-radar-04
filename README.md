# Token Launch Radar — radar-5

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/icallshelby/makefun-token-radar-04/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/icallshelby/makefun-token-radar-04/reward.svg)](https://make.fun/bounty/token-radar-01/bounty?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Systematic valuation of pre-token DeFi and infrastructure protocols using size curves, asymmetric growth multipliers, log maturity models, breadth adjustments, and empirical P(token) shrinkage priors.

## What's New in radar-5

Radar-5 shifts to a board-first architecture evaluating a unified valuation formula (`curve × growth × maturity × breadth × P(token)`), maintaining strict accounting across all 758/758 protocols (198 ranked candidates and 144 non-candidates separated), offering robust two-way verdicts (`FARM`, `WATCH`, `SKIP`), and embedding comprehensive validation and size-curve visuals within the Method tab.

## How to Run

Requires Node 22 (standard library only).

```bash
# Generate the radar output
node main.ts --input /home/hatch/workspace/makefun/token-radar-01-kit/token-radar-01-kit/input/snapshot.json --output out
```

---
*Built for the token-radar-01 make.fun competition.*
