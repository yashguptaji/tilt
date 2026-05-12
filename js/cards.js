/* ============================================================
   CARDS — Deck, encoding, rendering
   Encoding: cards are strings "RS" where R=rank (2-9,T,J,Q,K,A) and S=suit (s,h,d,c)
   ============================================================ */

const Cards = (() => {

  const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  const SUITS = ['s','h','d','c'];
  const SUIT_GLYPHS = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_COLOR  = { s: 'spade', h: 'heart', d: 'diamond', c: 'club' };

  const RANK_VALUE = Object.fromEntries(RANKS.map((r,i) => [r, i + 2])); // 2..14

  function newDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push(r + s);
    return d;
  }

  function shuffledDeck() { return Util.shuffle(newDeck()); }

  function rank(card) { return card[0]; }
  function suit(card) { return card[1]; }
  function rankValue(card) { return RANK_VALUE[card[0]]; }

  // DOM rendering
  function sizeClass(opts) {
    if (opts.big)   return ' big';
    if (opts.small) return ' small';
    if (opts.tiny)  return ' tiny';
    return '';
  }

  function render(card, opts = {}) {
    if (!card || card === '?') {
      return Util.el('div', { class: 'card face-down' + sizeClass(opts) });
    }
    const r = rank(card), s = suit(card);
    const cls = 'card ' + SUIT_COLOR[s] + sizeClass(opts) + (opts.highlight ? ' highlight' : '');
    return Util.el('div', { class: cls }, [
      Util.el('span', { class: 'rank', text: r === 'T' ? '10' : r }),
      Util.el('span', { class: 'suit', text: SUIT_GLYPHS[s] }),
    ]);
  }

  function renderHand(cards, opts = {}) {
    const wrap = Util.el('div', { class: 'card-hand', style: { display: 'flex', gap: '4px' } });
    (cards || []).forEach(c => wrap.appendChild(render(c, opts)));
    return wrap;
  }

  return { RANKS, SUITS, SUIT_GLYPHS, RANK_VALUE, newDeck, shuffledDeck, rank, suit, rankValue, render, renderHand };
})();
