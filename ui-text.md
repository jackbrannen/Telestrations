# Telestrations — Proposed UI Text

All copy, labels, and messages for the game. Sections marked with existing-game patterns
are locked to match the shared UX — don't change these unless you want to diverge from
the other games.

---

## Home Page
*(Matches Fishbowl / GameOfWhat pattern exactly)*

**Game title:** Telestrations

**Tagline:** Telephone + Drawing

**Create button:** Create Game  
**Create button (loading):** Creating…

**Room code input placeholder:** Room code  
**Join button:** Join

**Dummy game button (bottom, subtle):** Dummy Game  
**Dummy game button (loading):** Setting up…

---

## Lobby Page
*(Matches GameOfWhat / Fishbowl pattern exactly)*

**Invite button:** Invite  
*(Copies URL to clipboard or uses navigator.share)*

**Section: Join form**
- Section label: Join Game
- First name placeholder: First name
- Last name placeholder: Last name
- Display name placeholder: Display Name
- Join button: Join
- Join button (loading): Joining…

**Section: Players**
- Section label: Players
- Empty state: No players yet

**Start button (host, enough players):** Start Game  
**Start button disabled note:** Minimum 5 players needed  
*(Button disabled until 5 players. In dummy mode, 2 players is enough.)*

---

## Sentence Writing Phase

**Phase label (small caps above):** WRITE A SENTENCE

**Instruction:** The next person will draw this — keep it simple, or not.

**Textarea placeholder:** e.g. "A squid getting sued"

**Submit button:** Lock it in  
**Submitted state:** Sentence locked in. Waiting for everyone else…

**Random Ideas button (first tap):** ✦ Random ideas  
**Random Ideas button (subsequent taps):** ✦ 3 more ideas  
**No more ideas:** No more ideas  
*(Word-chip prompts appear below button, same as GameOfWhat)*

---

## Drawing Phase

**Phase label (small caps above):** DRAW THIS

**Prompt display:** The sentence from the previous player, shown prominently above the canvas.  
*(No author name shown — player only sees the one item before them)*

**Canvas toolbar items:**
- Pen tool (default)
- Eraser tool
- Undo button
- Clear button
- Brush/eraser size: Small / Medium / Large (3 sizes)
- Color palette (20 swatches):
  - Black `#000000`
  - Dark gray `#555555`
  - Light gray `#AAAAAA`
  - White `#FFFFFF`
  - Red `#E53935`
  - Orange `#FB8C00`
  - Yellow `#FDD835`
  - Yellow-green `#C0CA33`
  - Green `#43A047`
  - Teal `#00897B`
  - Sky blue `#039BE5`
  - Blue `#1E88E5`
  - Indigo `#3949AB`
  - Violet `#8E24AA`
  - Pink `#D81B60`
  - Flesh 1 (light) `#FDDBB4`
  - Flesh 2 (medium/Latino) `#D4956A`
  - Flesh 3 (deep/Asian-warm) `#8D5524`
  - Brown `#6D4C41`
  - Tan `#A1887F`

**Submit button:** Done drawing  
**Submitted state:** Drawing submitted. Waiting for everyone else…

---

## Writing Phase (subsequent steps — guess the drawing)

**Phase label (small caps above):** WHAT IS THIS?

**Instruction:** Write what you think this drawing shows.

**Input placeholder:** Write what you see…

**Submit button:** Lock it in  
**Submitted state:** Answer locked in. Waiting for everyone else…

*(No Random Ideas prompts in this phase)*

---

## Between-Step Waiting Screen

**Message:** Waiting for everyone to finish…

**Progress:** [N] of [N] done

---

## Reveal Phase — Presenter View (source player for this chain)

**Phase label:** YOUR TELESTRATION

**Instruction:** Tap Reveal to show each step to the group, one at a time.

**Button to reveal next item:** Reveal

**After all items revealed — "Next" button for next presenter:** Next telestration →  
*(The next presenter taps this to show their chain — no phone passing needed)*

---

## Reveal Phase — Audience View (everyone else's screens)

**Waiting message:** [Presenter name] is sharing their telestration!

**Watching header:** [Presenter name]'s telestration

**Item type labels:**
- Sentence step: "[Name] wrote:"
- Drawing step: "[Name] drew:"

*(Items appear one at a time as presenter taps Reveal)*

---

## End Screen (all chains revealed)

**Heading:** That's a wrap!

**Subtext:** This is your reminder to take screenshots.

**Play again button:** Play again  
**Back to lobby button:** Back to lobby

---

## Error / Edge Case Messages
*(Matches other games)*

**Game not found:** Game not found. Check the code and try again.  
**Game already started:** This game has already started.  
**Name taken:** That username is already taken in this game. Please choose another.  
**Generic error:** Something went wrong. Refresh and try again.
