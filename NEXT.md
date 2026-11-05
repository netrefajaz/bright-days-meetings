# Next session notes

Status as of Nov 4, 2026. Paused until Jaz's plan refreshes; build everything in one session.

- Oliver Hatch said no: Bright Days must stop using the Sunlight data before launch.
- Build with the 77 public feeds in feeds/feeds.json, plus any feed keys offices send back.
- Feed key requests went out to the private offices (feeds/private-contacts.json). Colorado Springs said no.
- Retest the New Jersey sites (none worked; aanj.org was not an AA site). Southeastern Michigan
  (aa-semi.org, Area 33) has no contact yet.
- Report a problem: brightdaysapp@gmail.com (config.json). Opt outs: optout.json.

## Link out wording (chosen by Jaz)

Where the local office's feed is private or missing:

> The [Office name] keeps the meeting list for this area. Their website has every meeting, with
> times and directions.
> [Find a meeting near you]

Where no local office is known:

> Find AA meetings in this area through Alcoholics Anonymous.
> [Open aa.org meeting finder] (https://www.aa.org/find-aa)

Both need Spanish versions and the accessibility pass.

# Bright Days feature plans (decided Nov 4, add to ROADMAP when building)

## Reach out message (free)
- One shared message by default ("I'm having a hard time right now. Could you call or text me when you
  can?"), plus an optional "Write a different message for this person" on each card in My support circle.
- Button only on the craving screen, near the top.
- If nobody is switched on: stay on the craving screen and show a short line ("Add someone in My support
  circle to reach out to them from here") with a small link. Never pull them away mid craving.

## Your week
- Week runs Monday through Sunday. The card shows on Monday for the previous week and stays through
  Wednesday or until closed, whichever comes first. Only this week's card, no history.
- Optional reminder: off by default, Monday 9 AM, follows discreet mode.
- Wins for next week: personalized from what they did, never negative, nothing about what they missed.

## Letters to your future self (Plus)
- Milestones: any of the app's badges.
- Sealed until the milestone: can't open early or edit. Delete allowed with a confirmation
  ("Delete this letter? You won't be able to get it back").
- If the counter resets after a slip, the letter's milestone moves with the new count.
- Notification when a letter is ready; discreet mode says "Something's ready for you in Bright Days."
- Lives in the Journal tab.
