# CHARTER

A bank simulator. Start with a small bank in any major American city. End with one bigger than JPMorgan Chase.

## How to start (the only thing you do)

1. Make a folder called `charter` and put these five files in it.
2. Open Claude Code in that folder.
3. Paste this and press enter:

```
Read README.md, CLAUDE.md, and BUILD_PLAN.md in that order. Then start Phase 0, first unchecked item only. Download whatever you need yourself. When the item passes, check it off and add a line to the progress log in BUILD_PLAN.md, then stop. Tell me in three lines what you did and what is next.
```

4. Each time it stops, paste:

```
Continue. Read the progress log in BUILD_PLAN.md, do the next unchecked item, stop when it passes.
```

5. At the end of each phase it will stop and ask you to play. Play. Then tell it "next phase" or what felt wrong.

You never download data, run commands, or edit config. If Claude Code asks you to, tell it to read CLAUDE.md rule 23 and find another way.

## The five files
- README.md: this.
- CLAUDE.md: the rules Claude Code follows. It reads this on its own every session.
- DESIGN.md: Part 1 vision, Part 2 locked decisions (numbered; change one by adding a new line), Part 3 desk style.
- SYSTEMS.md: Part 1 each system, its cadence, and its tests; Part 2 every real dataset and how it is fetched, built, and calibrated.
- BUILD_PLAN.md: the phases in order with checkboxes and play gates, and the progress log at the bottom.

## Name
CHARTER. A bank charter is the first thing you get and the last thing they take away.
