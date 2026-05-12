/* ============================================================
   STATS — Local statistics tracking
   ============================================================ */

const Stats = (() => {

  const STORAGE_KEY = 'stats-v1';
  const MAX_RECENT = 50;

  function defaultStats() {
    return {
      holdem:    emptyGameStats(),
      plo:       emptyGameStats(),
      blackjack: emptyBlackjackStats(),
      recent:    [],
    };
  }
  function emptyGameStats() {
    return {
      handsPlayed: 0, handsWon: 0, handsFolded: 0,
      totalWon: 0, totalLost: 0,
      biggestPot: 0, biggestWin: 0,
      sessionsPlayed: 0,
      showdownsWon: 0, showdownsLost: 0,
    };
  }
  function emptyBlackjackStats() {
    return {
      handsPlayed: 0, handsWon: 0, handsLost: 0, handsPushed: 0,
      blackjacks: 0, busts: 0, doubles: 0,
      totalWagered: 0, totalWon: 0, totalLost: 0,
      biggestWin: 0, biggestLoss: 0,
      sessionsPlayed: 0,
    };
  }

  function load() {
    const raw = Util.Store.get(STORAGE_KEY);
    if (!raw) return defaultStats();
    const def = defaultStats();
    return {
      holdem:    { ...def.holdem,    ...(raw.holdem || {}) },
      plo:       { ...def.plo,       ...(raw.plo || {}) },
      blackjack: { ...def.blackjack, ...(raw.blackjack || {}) },
      recent:    (raw.recent || []).slice(0, MAX_RECENT),
    };
  }
  function save(stats) { Util.Store.set(STORAGE_KEY, stats); }
  function reset() { Util.Store.remove(STORAGE_KEY); }

  function recordPokerHand(gameType, info) {
    const stats = load();
    const g = stats[gameType];
    if (!g) return;
    g.handsPlayed++;
    if (info.folded) g.handsFolded++;
    if (info.won) {
      g.handsWon++;
      g.totalWon += Math.max(0, info.netChange);
      if (info.netChange > g.biggestWin) g.biggestWin = info.netChange;
    } else if (info.netChange < 0) {
      g.totalLost += -info.netChange;
    }
    if (info.potSize > g.biggestPot) g.biggestPot = info.potSize;
    if (info.showdown) {
      if (info.won) g.showdownsWon++;
      else g.showdownsLost++;
    }
    stats.recent.unshift({
      ts: Date.now(), game: gameType,
      outcome: info.won ? 'win' : (info.folded ? 'fold' : 'loss'),
      netChange: info.netChange || 0,
      desc: info.desc || '',
    });
    stats.recent = stats.recent.slice(0, MAX_RECENT);
    save(stats);
  }

  function recordBlackjackHand(info) {
    const stats = load();
    const g = stats.blackjack;
    g.handsPlayed++;
    g.totalWagered += info.bet || 0;
    if (info.doubled) g.doubles++;
    if (info.outcome === 'blackjack' || info.outcome === 'won') {
      g.handsWon++;
      g.totalWon += Math.max(0, info.netChange);
      if (info.outcome === 'blackjack') g.blackjacks++;
      if (info.netChange > g.biggestWin) g.biggestWin = info.netChange;
    } else if (info.outcome === 'push') {
      g.handsPushed++;
    } else {
      g.handsLost++;
      if (info.outcome === 'bust') g.busts++;
      g.totalLost += Math.abs(info.netChange);
      if (-info.netChange > g.biggestLoss) g.biggestLoss = -info.netChange;
    }
    stats.recent.unshift({
      ts: Date.now(), game: 'blackjack',
      outcome: (info.outcome === 'blackjack' || info.outcome === 'won') ? 'win'
             : (info.outcome === 'push') ? 'push' : 'loss',
      netChange: info.netChange || 0,
      desc: info.outcome === 'blackjack' ? 'Blackjack!' : (info.outcome === 'bust' ? 'Bust' : info.outcome.charAt(0).toUpperCase() + info.outcome.slice(1)),
    });
    stats.recent = stats.recent.slice(0, MAX_RECENT);
    save(stats);
  }

  function recordSession(gameType) {
    const stats = load();
    if (stats[gameType]) {
      stats[gameType].sessionsPlayed++;
      save(stats);
    }
  }

  function getDisplay(filter = 'all') {
    const stats = load();

    if (filter === 'blackjack') {
      const g = stats.blackjack;
      const winRate = g.handsPlayed > 0 ? Math.round((g.handsWon / g.handsPlayed) * 100) : 0;
      const profit = g.totalWon - g.totalLost;
      return {
        tiles: [
          { label: 'Hands played',   value: g.handsPlayed.toLocaleString(),                  sub: `${g.sessionsPlayed} sessions` },
          { label: 'Win rate',       value: winRate + '%',                                    sub: `${g.handsWon}W · ${g.handsLost}L · ${g.handsPushed}P`,  accent: winRate >= 45 ? 'green' : 'red' },
          { label: 'Net profit',     value: (profit >= 0 ? '+' : '') + Util.fmtFull(profit), sub: 'all time',                                              accent: profit >= 0 ? 'green' : 'red' },
          { label: 'Biggest win',    value: '+' + Util.fmtFull(g.biggestWin),                 sub: 'single hand',                                           accent: 'gold' },
          { label: 'Blackjacks',     value: g.blackjacks.toLocaleString(),                    sub: '3:2 payouts' },
          { label: 'Busts',          value: g.busts.toLocaleString(),                         sub: 'over 21' },
          { label: 'Doubles',        value: g.doubles.toLocaleString(),                       sub: 'big bets' },
          { label: 'Total wagered',  value: Util.fmtFull(g.totalWagered),                     sub: 'lifetime' },
        ],
        recent: stats.recent.filter(r => r.game === 'blackjack'),
      };
    }

    if (filter === 'holdem' || filter === 'plo') {
      const g = stats[filter];
      const winRate = g.handsPlayed > 0 ? Math.round((g.handsWon / g.handsPlayed) * 100) : 0;
      const profit = g.totalWon - g.totalLost;
      const showdowns = g.showdownsWon + g.showdownsLost;
      const sdwr = showdowns > 0 ? Math.round((g.showdownsWon / showdowns) * 100) : 0;
      return {
        tiles: [
          { label: 'Hands played',    value: g.handsPlayed.toLocaleString(),                 sub: `${g.sessionsPlayed} sessions` },
          { label: 'Win rate',        value: winRate + '%',                                   sub: `${g.handsWon} wins`,                          accent: winRate >= 20 ? 'green' : null },
          { label: 'Net profit',      value: (profit >= 0 ? '+' : '') + Util.fmtFull(profit), sub: 'all time',                                    accent: profit >= 0 ? 'green' : 'red' },
          { label: 'Biggest win',     value: '+' + Util.fmtFull(g.biggestWin),                sub: 'single pot',                                  accent: 'gold' },
          { label: 'Biggest pot',     value: Util.fmtFull(g.biggestPot),                      sub: 'on the table' },
          { label: 'Hands folded',    value: g.handsFolded.toLocaleString(),                  sub: g.handsPlayed ? Math.round(g.handsFolded/g.handsPlayed*100) + '% fold rate' : '—' },
          { label: 'Showdown wins',   value: sdwr + '%',                                      sub: `${g.showdownsWon}/${showdowns}` },
          { label: 'Hands won',       value: g.handsWon.toLocaleString(),                     sub: 'all in' },
        ],
        recent: stats.recent.filter(r => r.game === filter),
      };
    }

    // 'all'
    const totalHands = stats.holdem.handsPlayed + stats.plo.handsPlayed + stats.blackjack.handsPlayed;
    const totalWon   = stats.holdem.totalWon + stats.plo.totalWon + stats.blackjack.totalWon;
    const totalLost  = stats.holdem.totalLost + stats.plo.totalLost + stats.blackjack.totalLost;
    const profit     = totalWon - totalLost;
    const wins       = stats.holdem.handsWon + stats.plo.handsWon + stats.blackjack.handsWon;
    const sessions   = stats.holdem.sessionsPlayed + stats.plo.sessionsPlayed + stats.blackjack.sessionsPlayed;
    const biggestWin = Math.max(stats.holdem.biggestWin, stats.plo.biggestWin, stats.blackjack.biggestWin);

    return {
      tiles: [
        { label: 'Total hands',     value: totalHands.toLocaleString(),                       sub: `${sessions} sessions` },
        { label: 'Total wins',      value: wins.toLocaleString(),                              sub: totalHands ? Math.round(wins/totalHands*100) + '% rate' : '0%', accent: 'green' },
        { label: 'Net profit',      value: (profit >= 0 ? '+' : '') + Util.fmtFull(profit),   sub: 'across all games',                                            accent: profit >= 0 ? 'green' : 'red' },
        { label: 'Biggest win',     value: '+' + Util.fmtFull(biggestWin),                    sub: 'best hand ever',                                              accent: 'gold' },
        { label: "Hold'em",         value: stats.holdem.handsPlayed.toLocaleString(),         sub: stats.holdem.handsPlayed ? Math.round(stats.holdem.handsWon/stats.holdem.handsPlayed*100) + '% win' : 'no hands' },
        { label: 'PLO',             value: stats.plo.handsPlayed.toLocaleString(),            sub: stats.plo.handsPlayed ? Math.round(stats.plo.handsWon/stats.plo.handsPlayed*100) + '% win' : 'no hands' },
        { label: 'Blackjack',       value: stats.blackjack.handsPlayed.toLocaleString(),       sub: stats.blackjack.handsPlayed ? Math.round(stats.blackjack.handsWon/stats.blackjack.handsPlayed*100) + '% win' : 'no hands' },
        { label: 'Blackjacks hit',  value: stats.blackjack.blackjacks.toLocaleString(),       sub: '3:2 payouts' },
      ],
      recent: stats.recent,
    };
  }

  function formatTime(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d < 30) return d + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  return {
    load, save, reset,
    recordPokerHand, recordBlackjackHand, recordSession,
    getDisplay, formatTime,
  };
})();
