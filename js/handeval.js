/* ============================================================
   HANDEVAL — 5-card poker hand evaluator
   Returns a comparable score: [category, ...tiebreakers]
   Categories (high better):
     8 straight flush  7 four of kind  6 full house
     5 flush           4 straight      3 three of kind
     2 two pair        1 pair          0 high card
   ============================================================ */

const HandEval = (() => {

  function valuesSorted(cards) {
    // returns rank values descending
    return cards.map(c => Cards.rankValue(c)).sort((a,b) => b - a);
  }

  function isFlush(cards) {
    const s = cards[0][1];
    return cards.every(c => c[1] === s);
  }

  function isStraight(values) {
    // values are descending unique
    if (values.length < 5) return 0;
    const v = [...new Set(values)].sort((a,b) => b - a);
    if (v.length < 5) return 0;
    // wheel special case: A=14 + 5,4,3,2 -> straight to 5
    if (v[0] === 14 && v.includes(5) && v.includes(4) && v.includes(3) && v.includes(2)) return 5;
    for (let i = 0; i <= v.length - 5; i++) {
      if (v[i] - v[i+4] === 4) return v[i];
    }
    return 0;
  }

  /**
   * Score a 5-card hand. Returns array where larger = better.
   * Index 0 = category, subsequent = tiebreakers (rank values).
   */
  function score5(cards) {
    if (cards.length !== 5) throw new Error('score5 needs 5 cards');
    const vs = valuesSorted(cards); // desc
    const counts = {}; // val -> count
    for (const v of vs) counts[v] = (counts[v] || 0) + 1;
    // grouped: array of [value, count] sorted by count desc, then value desc
    const grouped = Object.entries(counts).map(([v,c]) => [+v, c]).sort((a,b) => b[1]-a[1] || b[0]-a[0]);

    const flush = isFlush(cards);
    const straightHigh = isStraight(vs);

    if (flush && straightHigh) return [8, straightHigh];
    if (grouped[0][1] === 4) return [7, grouped[0][0], grouped[1][0]];
    if (grouped[0][1] === 3 && grouped[1][1] === 2) return [6, grouped[0][0], grouped[1][0]];
    if (flush) return [5, ...vs];
    if (straightHigh) return [4, straightHigh];
    if (grouped[0][1] === 3) return [3, grouped[0][0], grouped[1][0], grouped[2][0]];
    if (grouped[0][1] === 2 && grouped[1][1] === 2) return [2, grouped[0][0], grouped[1][0], grouped[2][0]];
    if (grouped[0][1] === 2) return [1, grouped[0][0], grouped[1][0], grouped[2][0], grouped[3][0]];
    return [0, ...vs];
  }

  // Compare two scores: returns positive if a > b
  function cmp(a, b) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const av = a[i] || 0, bv = b[i] || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }

  // Generator: all C(n,k) combinations of array
  function* combinations(arr, k) {
    const n = arr.length;
    if (k > n) return;
    const idx = Array.from({length: k}, (_, i) => i);
    while (true) {
      yield idx.map(i => arr[i]);
      let i = k - 1;
      while (i >= 0 && idx[i] === n - k + i) i--;
      if (i < 0) return;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j-1] + 1;
    }
  }

  /**
   * Hold'em: best 5 from 7 (2 hole + 5 board)
   */
  function evalHoldem(hole, board) {
    const all = [...hole, ...board];
    let best = null, bestCards = null;
    for (const combo of combinations(all, 5)) {
      const s = score5(combo);
      if (!best || cmp(s, best) > 0) { best = s; bestCards = combo; }
    }
    return { score: best, cards: bestCards };
  }

  /**
   * Omaha: MUST use exactly 2 hole + 3 board
   */
  function evalOmaha(hole, board) {
    let best = null, bestCards = null;
    for (const hc of combinations(hole, 2)) {
      for (const bc of combinations(board, 3)) {
        const combo = [...hc, ...bc];
        const s = score5(combo);
        if (!best || cmp(s, best) > 0) { best = s; bestCards = combo; }
      }
    }
    return { score: best, cards: bestCards };
  }

  const CATEGORY_NAMES = [
    'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
    'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'
  ];
  function describe(score) {
    if (!score) return '';
    const cat = score[0];
    if (cat === 8 && score[1] === 14) return 'Royal Flush';
    return CATEGORY_NAMES[cat];
  }

  // Blackjack value: returns { total, isSoft, isBlackjack, isBust }
  function blackjackValue(cards) {
    let total = 0, aces = 0;
    for (const c of cards) {
      const r = c[0];
      if (r === 'A') { total += 11; aces++; }
      else if (['T','J','Q','K'].includes(r)) total += 10;
      else total += parseInt(r, 10);
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return {
      total,
      isSoft: aces > 0 && total <= 21,
      isBlackjack: cards.length === 2 && total === 21,
      isBust: total > 21
    };
  }

  return { score5, cmp, evalHoldem, evalOmaha, describe, blackjackValue, combinations };
})();
