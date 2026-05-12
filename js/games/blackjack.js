/* ============================================================
   BLACKJACK — Multiplayer vs Dealer (human or bot)

   Dealer modes:
     - dealerId = 'bot' (default) → House bot, plays automatically
     - dealerId = <playerId>      → That player controls dealer
       manually. They don't play their own hand. Their bankroll
       absorbs the net swing from all other players.

   Standard rules:
     - 4-deck shoe
     - Blackjack pays 3:2
     - Dealer hits ≤16 and soft 17, stands otherwise
     - Supports hit, stand, double down. No split.
   ============================================================ */

const Blackjack = (() => {

  function create(config) {
    return {
      type: 'blackjack',
      players: config.players.map(p => ({
        id: p.id, name: p.name,
        bankroll: p.stack,
        bet: 0,
        hand: [],
        status: 'waiting',
        doubled: false,
        sittingOut: false,
      })),
      minBet: config.minBet,
      maxBet: config.maxBet,
      deck: [],
      dealer: {
        hand: [],
        holeRevealed: false,
        id: config.dealerId || 'bot',
        name: config.dealerName || 'House',
      },
      phase: 'idle',
      activeIdx: -1,
      handNumber: 0,
      lastResult: null,
    };
  }

  function isBotDealer(state) {
    return !state.dealer.id || state.dealer.id === 'bot';
  }

  function isDealerPlayer(state, playerId) {
    return playerId === state.dealer.id && !isBotDealer(state);
  }

  function startBettingRound(state) {
    state.handNumber++;
    state.deck = [];
    for (let i = 0; i < 4; i++) state.deck.push(...Cards.newDeck());
    state.deck = Util.shuffle(state.deck);

    state.dealer.hand = [];
    state.dealer.holeRevealed = false;
    state.phase = 'betting';
    state.activeIdx = -1;
    state.players.forEach(p => {
      p.bet = 0; p.hand = []; p.doubled = false;
      // Human dealer doesn't bet or play their own hand
      if (isDealerPlayer(state, p.id)) {
        p.status = 'dealing';
        return;
      }
      p.status = (p.bankroll < state.minBet || p.sittingOut) ? 'waiting' : 'betting';
    });
    return state;
  }

  function placeBet(state, playerId, amount) {
    if (state.phase !== 'betting') return { ok: false, error: 'Not in betting phase' };
    if (isDealerPlayer(state, playerId)) return { ok: false, error: 'Dealer does not bet' };
    const p = state.players.find(pp => pp.id === playerId);
    if (!p) return { ok: false, error: 'Player not found' };
    if (p.status !== 'betting') return { ok: false, error: 'Cannot bet now' };
    if (amount < state.minBet) return { ok: false, error: 'Below min bet' };
    if (amount > state.maxBet) return { ok: false, error: 'Above max bet' };
    if (amount > p.bankroll) return { ok: false, error: 'Insufficient bankroll' };
    p.bet = amount;
    p.bankroll -= amount;
    p.status = 'ready';
    maybeDeal(state);
    return { ok: true };
  }

  function skipBetting(state, playerId) {
    if (state.phase !== 'betting') return { ok: false, error: 'Not in betting phase' };
    const p = state.players.find(pp => pp.id === playerId);
    if (!p || p.status !== 'betting') return { ok: false, error: 'Cannot skip now' };
    p.status = 'waiting';
    maybeDeal(state);
    return { ok: true };
  }

  function maybeDeal(state) {
    const betting = state.players.filter(p => p.status === 'betting' || p.status === 'ready');
    if (betting.length === 0 || betting.every(p => p.status === 'ready')) {
      if (state.players.some(p => p.status === 'ready')) dealInitial(state);
      else state.phase = 'idle';
    }
  }

  function dealInitial(state) {
    state.phase = 'dealing';
    const active = state.players.filter(p => p.status === 'ready');
    for (let r = 0; r < 2; r++) {
      for (const p of active) p.hand.push(state.deck.pop());
      state.dealer.hand.push(state.deck.pop());
    }
    active.forEach(p => {
      const v = HandEval.blackjackValue(p.hand);
      if (v.isBlackjack) p.status = 'blackjack';
      else p.status = 'playing';
    });
    state.phase = 'playing';
    state.activeIdx = state.players.findIndex(p => p.status === 'playing');
    if (state.activeIdx < 0) startDealerTurn(state);
  }

  function applyAction(state, playerId, action) {
    if (state.phase === 'betting') {
      if (action.type === 'bet')  return placeBet(state, playerId, action.amount);
      if (action.type === 'skip') return skipBetting(state, playerId);
      return { ok: false, error: 'Place a bet first' };
    }

    // Human dealer manual hit/stand during dealer turn
    if (state.phase === 'dealer' && isDealerPlayer(state, playerId)) {
      return applyDealerAction(state, action);
    }

    if (state.phase !== 'playing') return { ok: false, error: 'Not in action phase' };

    const idx = state.players.findIndex(p => p.id === playerId);
    if (idx !== state.activeIdx) return { ok: false, error: 'Not your turn' };
    const p = state.players[idx];

    if (action.type === 'hit') {
      p.hand.push(state.deck.pop());
      const v = HandEval.blackjackValue(p.hand);
      if (v.isBust) { p.status = 'bust'; advancePlayer(state); }
      else if (v.total === 21) { p.status = 'stood'; advancePlayer(state); }
    }
    else if (action.type === 'stand') {
      p.status = 'stood';
      advancePlayer(state);
    }
    else if (action.type === 'double') {
      if (p.hand.length !== 2) return { ok: false, error: 'Can only double on first 2 cards' };
      if (p.bankroll < p.bet) return { ok: false, error: 'Not enough chips to double' };
      p.bankroll -= p.bet;
      p.bet *= 2;
      p.doubled = true;
      p.hand.push(state.deck.pop());
      const v = HandEval.blackjackValue(p.hand);
      p.status = v.isBust ? 'bust' : 'stood';
      advancePlayer(state);
    }
    else {
      return { ok: false, error: 'Unknown action' };
    }
    return { ok: true };
  }

  function advancePlayer(state) {
    for (let i = state.activeIdx + 1; i < state.players.length; i++) {
      if (state.players[i].status === 'playing') { state.activeIdx = i; return; }
    }
    state.activeIdx = -1;
    startDealerTurn(state);
  }

  function startDealerTurn(state) {
    state.phase = 'dealer';
    state.dealer.holeRevealed = true;

    const stillIn = state.players.filter(p => p.status === 'stood');
    if (stillIn.length === 0) {
      // Everyone busted or no one playing — settle immediately
      settle(state);
      return;
    }

    if (isBotDealer(state)) {
      botPlayDealer(state);
      settle(state);
    }
    // Human dealer waits for manual hit/stand actions via applyDealerAction
  }

  /**
   * Bot dealer "AI" — really just the standard mechanical rules.
   * Hit if total <= 16, hit on soft 17, stand on hard 17+ and 18+.
   */
  function botPlayDealer(state) {
    while (true) {
      const v = HandEval.blackjackValue(state.dealer.hand);
      if (v.total > 21) break;
      if (v.total > 17) break;
      if (v.total === 17 && !v.isSoft) break;
      state.dealer.hand.push(state.deck.pop());
    }
  }

  function applyDealerAction(state, action) {
    const v = HandEval.blackjackValue(state.dealer.hand);
    if (action.type === 'hit') {
      // Allowed unless dealer already stood / busted
      if (v.total > 21) return { ok: false, error: 'Dealer is bust' };
      state.dealer.hand.push(state.deck.pop());
      const v2 = HandEval.blackjackValue(state.dealer.hand);
      // Auto-settle if dealer is now bust or at 21+
      if (v2.total >= 21) settle(state);
      return { ok: true };
    }
    if (action.type === 'stand') {
      // Enforce rules: must hit ≤16 and soft 17
      if (v.total < 17) return { ok: false, error: 'Dealer must hit on 16 or less' };
      if (v.total === 17 && v.isSoft) return { ok: false, error: 'Dealer must hit soft 17' };
      settle(state);
      return { ok: true };
    }
    return { ok: false, error: 'Dealer can only hit or stand' };
  }

  function settle(state) {
    const dealerVal = HandEval.blackjackValue(state.dealer.hand);
    const dealerBJ = state.dealer.hand.length === 2 && dealerVal.total === 21;
    const results = [];
    let dealerNetChange = 0;

    state.players.forEach(p => {
      // Skip players who didn't participate or are the dealer themselves
      if (p.status === 'waiting' || p.status === 'dealing' || isDealerPlayer(state, p.id)) return;

      const pv = HandEval.blackjackValue(p.hand);
      let outcome, payout = 0;
      if (p.status === 'bust') {
        outcome = 'lost'; payout = 0;
      } else if (p.status === 'blackjack') {
        if (dealerBJ) { outcome = 'push'; payout = p.bet; }
        else { outcome = 'blackjack'; payout = Math.floor(p.bet * 2.5); }
      } else {
        if (dealerVal.isBust) { outcome = 'won'; payout = p.bet * 2; }
        else if (pv.total > dealerVal.total) { outcome = 'won'; payout = p.bet * 2; }
        else if (pv.total < dealerVal.total) { outcome = 'lost'; payout = 0; }
        else { outcome = 'push'; payout = p.bet; }
      }
      p.bankroll += payout;
      const netChange = payout - p.bet;
      dealerNetChange -= netChange;
      p.status = outcome;
      results.push({ id: p.id, outcome, bet: p.bet, payout, netChange, doubled: p.doubled });
    });

    // Human dealer absorbs the net swing
    if (!isBotDealer(state)) {
      const dealerPlayer = state.players.find(p => p.id === state.dealer.id);
      if (dealerPlayer) {
        dealerPlayer.bankroll += dealerNetChange;
      }
    }

    state.phase = 'settled';
    state.lastResult = {
      dealerHand: state.dealer.hand.slice(),
      dealerTotal: dealerVal.total,
      dealerNetChange,
      results,
      handNumber: state.handNumber
    };
  }

  function sanitizeFor(state, viewerId) {
    return {
      ...state,
      deck: [],
      dealer: {
        ...state.dealer,
        hand: state.dealer.holeRevealed ? state.dealer.hand : state.dealer.hand.map((c,i) => i === 0 ? c : '?'),
      },
    };
  }

  /**
   * Rebuy: restore a busted player with the given bankroll.
   */
  function rebuyPlayer(state, playerId, amount) {
    const p = state.players.find(pp => pp.id === playerId);
    if (!p) return { ok: false, error: 'Player not found' };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Invalid amount' };
    if (amount > 1_000_000_000) return { ok: false, error: 'Amount too large' };
    p.bankroll = (p.bankroll || 0) + Math.floor(amount);
    p.status = 'betting';
    return { ok: true };
  }

  return {
    create, startBettingRound, placeBet, skipBetting, applyAction,
    sanitizeFor, isBotDealer, isDealerPlayer,
    rebuyPlayer
  };
})();
