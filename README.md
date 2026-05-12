# Tilt — Card Games with Friends

A static, peer-to-peer poker & blackjack app you can host on GitHub Pages. Share a link, sit down, play.

## What's in the box

- **Texas Hold'em** — standard NLHE with side pots, blinds, button rotation
- **Pot-Limit Omaha** — 4 hole cards, must-use-exactly-2 rule, pot-limit raise cap
- **Blackjack** — multiplayer vs. dealer, 4-deck shoe, 3:2 blackjack payout, hit/stand/double, dealer hits soft 17

Admin controls (host only): adjust blinds mid-game, kick players, top up/dock chips, end game. Bankroll mode is configurable: **fresh session** (everyone gets the starting stack each time) or **persist** (balances save to the host's browser between sessions in the same room).

## How it works

There is no backend. The host's browser tab runs the authoritative game logic and rebroadcasts sanitized state to every guest over WebRTC, using [PeerJS](https://peerjs.com/)'s free public broker for the initial handshake. Everything else is direct peer-to-peer.

**One important caveat:** the host has to keep their tab open. If they close it, the game ends.

## Deploy to GitHub Pages

1. Create a new repo (any name).
2. Drop the entire contents of this folder at the repo root.
3. In repo settings → Pages → set source to `main` / root.
4. Wait ~30 seconds for the deploy.
5. Visit `https://YOURNAME.github.io/REPONAME/` — that's it.

You can also just open `index.html` from your local filesystem to play around solo, but P2P needs to be served over `https://` for proper friends-online play (GitHub Pages handles that).

## Playing

- **Host:** open the app, pick a game, set stakes, click **Create table**. Share the link from the lobby.
- **Guests:** open the link, enter a name, click **Take a seat**.
- The host hits **Deal first hand** when everyone's seated. After that, hands auto-deal a few seconds after each showdown.
- Hit the ⚙ icon in-game for table controls (host) or stake info (guests).
- Hit the ⟲ icon to see hand history.

## Local testing

Open two browser windows (or one regular + one Incognito) pointing at `index.html`. One creates the table; the other joins via the share link. You can simulate a full table this way.

## Known limitations

- **Host must keep their tab open** — if they refresh or close, the room dies.
- **No split in blackjack** — hit, stand, and double only. Insurance and surrender are also omitted.
- **PeerJS uses a free public broker.** Generally reliable, but if it ever has downtime, new connections won't go through. Existing sessions keep working since they're direct P2P.
- **No chat yet.** Easy to add as a follow-up if you want it.
- **No reconnect.** If you drop, you rejoin via the same link as a fresh player.

## Files

```
index.html                # Single-page shell with all screens
css/styles.css            # Theme (light, minimalist, serif headers)
js/
  util.js                 # DOM/storage/random helpers
  cards.js                # Deck primitives, card rendering
  handeval.js             # 5-card poker evaluator + Hold'em/Omaha best-hand search
  games/
    holdem.js             # Hold'em engine (also drives PLO via type flag)
    plo.js                # Thin PLO wrapper
    blackjack.js          # Blackjack engine
  network.js              # PeerJS wrapper
  ui.js                   # Game-board rendering
  app.js                  # Main glue, host/guest message routing
```

No build step. No npm. No bundler. It just runs.
