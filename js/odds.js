/* ============================================================
   ODDS — Win probability via Monte Carlo simulation
   Used to show all-in equities during animated runouts.
   ============================================================ */

const Odds = (() => {

  const NUM_TRIALS = 3000;

  /**
   * Given players' hole cards, current board, and game type ('holdem' or 'plo'),
   * compute each player's win equity by Monte Carlo simulation.
   *
   * @param {Array<{id, hole}>} players — only LIVE players (not folded, not sitting out)
   * @param {Array<string>} board — current community cards (0-5)
   * @param {string} type — 'holdem' | 'plo'
   * @returns {Object<id, number>} map of playerId to win probability (0..1)
   */
  function computeEquities(players, board, type) {
    if (!players || players.length === 0) return {};
    if (players.length === 1) return { [players[0].id]: 1 };

    const evalFn = type === 'plo' ? HandEval.evalOmaha : HandEval.evalHoldem;

    // Build a set of all known (dead) cards
    const dead = new Set(board);
    for (const p of players) for (const c of p.hole) dead.add(c);

    // Build remaining deck
    const remaining = [];
    for (const c of Cards.newDeck()) if (!dead.has(c)) remaining.push(c);

    const cardsNeeded = 5 - board.length;
    const wins = {};
    for (const p of players) wins[p.id] = 0;

    for (let trial = 0; trial < NUM_TRIALS; trial++) {
      // Pick `cardsNeeded` random cards from remaining without replacement
      const sample = sampleK(remaining, cardsNeeded);
      const fullBoard = board.concat(sample);

      // Evaluate each player's best hand
      let bestScore = null;
      let winnerIds = [];
      for (const p of players) {
        const ev = evalFn(p.hole, fullBoard);
        if (!bestScore || HandEval.cmp(ev.score, bestScore) > 0) {
          bestScore = ev.score;
          winnerIds = [p.id];
        } else if (HandEval.cmp(ev.score, bestScore) === 0) {
          winnerIds.push(p.id);
        }
      }
      // Award split (1/n each) to ties
      const share = 1 / winnerIds.length;
      for (const id of winnerIds) wins[id] += share;
    }

    const equities = {};
    for (const id in wins) equities[id] = wins[id] / NUM_TRIALS;
    return equities;
  }

  /**
   * Sample k unique items from arr (Fisher-Yates partial shuffle).
   * Mutates a local copy.
   */
  function sampleK(arr, k) {
    const a = arr.slice();
    const out = [];
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(Math.random() * (a.length - i));
      [a[i], a[j]] = [a[j], a[i]];
      out.push(a[i]);
    }
    return out;
  }

  return { computeEquities, NUM_TRIALS };
})();
