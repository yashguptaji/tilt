/* ============================================================
   HOLDEM — Texas Hold'em game engine
   Authoritative state lives on the host. Other peers receive
   sanitized snapshots (their own hole cards visible, others hidden).
   ============================================================ */

const Holdem = (() => {

  /**
   * Create a fresh game state from config.
   * config: { players: [{id, name, stack}], sb, bb, ante, gameType: 'holdem'|'plo' }
   */
  function create(config) {
    return {
      type: config.gameType || 'holdem',
      players: config.players.map(p => ({
        id: p.id, name: p.name,
        stack: p.stack,
        hole: [],
        bet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
        sittingOut: false,
        acted: false,
      })),
      sb: config.sb,
      bb: config.bb,
      ante: config.ante || 0,
      deck: [],
      board: [],
      pots: [],
      currentBet: 0,
      minRaise: config.bb,
      lastAggressorIdx: -1,
      street: 'idle',
      dealerIdx: -1,
      activeIdx: -1,
      handNumber: 0,
      lastResult: null,
      // Run-it-multiple state
      runitPhase: 'none',   // 'none' | 'voting' | 'running'
      runitVotes: {},       // playerId -> 1|2|3|4
      runitCount: 1,        // resolved count once voting completes
      runitBoards: [],      // array of arrays of board cards (length = runitCount)
      runitActiveIdx: 0,    // which board is currently being dealt (0..N-1)
    };
  }

  /**
   * Start a new hand. Rotates dealer, posts blinds, deals hole cards.
   * Returns updated state.
   */
  function startHand(state) {
    state.handNumber++;
    state.deck = Cards.shuffledDeck();
    state.board = [];
    state.pots = [];
    state.currentBet = 0;
    state.minRaise = state.bb;
    state.pendingRunout = false;
    state.runitPhase = 'none';
    state.runitVotes = {};
    state.runitCount = 1;
    state.runitBoards = [];
    state.runitActiveIdx = 0;

    // Reset players. Sit out anyone with no chips.
    state.players.forEach(p => {
      p.hole = [];
      p.bet = 0;
      p.totalBet = 0;
      p.folded = false;
      p.allIn = false;
      p.acted = false;
      if (p.stack <= 0) p.sittingOut = true;
    });

    const active = state.players.map((p,i) => p.sittingOut ? -1 : i).filter(i => i >= 0);
    if (active.length < 2) {
      state.street = 'idle';
      return state;
    }

    // Rotate dealer button to next non-sitting-out player
    state.dealerIdx = nextActive(state, state.dealerIdx);

    // Determine SB, BB
    let sbIdx, bbIdx;
    if (active.length === 2) {
      // heads-up: dealer is SB
      sbIdx = state.dealerIdx;
      bbIdx = nextActive(state, sbIdx);
    } else {
      sbIdx = nextActive(state, state.dealerIdx);
      bbIdx = nextActive(state, sbIdx);
    }

    // Antes
    if (state.ante > 0) {
      state.players.forEach(p => {
        if (!p.sittingOut) {
          const ante = Math.min(state.ante, p.stack);
          p.stack -= ante;
          p.totalBet += ante;
          if (p.stack === 0) p.allIn = true;
        }
      });
    }

    // Post blinds
    postBlind(state.players[sbIdx], state.sb, state);
    postBlind(state.players[bbIdx], state.bb, state);
    state.currentBet = state.bb;
    state.minRaise = state.bb;
    state.lastAggressorIdx = bbIdx;

    // Deal hole cards
    const cardsPerPlayer = state.type === 'plo' ? 4 : 2;
    for (let r = 0; r < cardsPerPlayer; r++) {
      for (const idx of orderFrom(state, sbIdx)) {
        state.players[idx].hole.push(state.deck.pop());
      }
    }

    state.street = 'preflop';
    // First to act preflop: left of BB (UTG). Heads-up: SB (dealer) acts first.
    state.activeIdx = nextActive(state, bbIdx);
    return state;
  }

  function postBlind(p, amt, state) {
    const post = Math.min(amt, p.stack);
    p.stack -= post;
    p.bet = post;
    p.totalBet += post;
    if (p.stack === 0) p.allIn = true;
  }

  function nextActive(state, fromIdx) {
    const n = state.players.length;
    for (let i = 1; i <= n; i++) {
      const j = (fromIdx + i) % n;
      if (!state.players[j].sittingOut) return j;
    }
    return -1;
  }

  function orderFrom(state, idx) {
    const order = [];
    const n = state.players.length;
    let cur = idx;
    for (let i = 0; i < n; i++) {
      if (!state.players[cur].sittingOut) order.push(cur);
      cur = (cur + 1) % n;
    }
    return order;
  }

  // Players who can still act this street (not folded, not all-in, not sitting out)
  function actionablePlayers(state) {
    return state.players.filter(p => !p.folded && !p.allIn && !p.sittingOut);
  }

  // Players still in hand (not folded, not sitting out)
  function liveCount(state) {
    return state.players.filter(p => !p.folded && !p.sittingOut).length;
  }

  /**
   * Apply a player action. action: { type: 'fold'|'check'|'call'|'bet'|'raise', amount? }
   * For Hold'em, raise amount is the TOTAL bet (the size to bring your bet to).
   * Returns { ok, error?, state }
   */
  function applyAction(state, playerId, action) {
    if (state.street === 'idle' || state.street === 'showdown') {
      return { ok: false, error: 'No active hand' };
    }
    const idx = state.players.findIndex(p => p.id === playerId);
    if (idx !== state.activeIdx) return { ok: false, error: 'Not your turn' };
    const p = state.players[idx];
    const toCall = state.currentBet - p.bet;

    if (action.type === 'fold') {
      p.folded = true;
      p.acted = true;
    }
    else if (action.type === 'check') {
      if (toCall > 0) return { ok: false, error: 'Cannot check; must call ' + toCall };
      p.acted = true;
    }
    else if (action.type === 'call') {
      const callAmt = Math.min(toCall, p.stack);
      p.stack -= callAmt;
      p.bet += callAmt;
      p.totalBet += callAmt;
      if (p.stack === 0) p.allIn = true;
      p.acted = true;
    }
    else if (action.type === 'bet' || action.type === 'raise') {
      // total = total bet this street player is committing to
      const total = action.amount;
      if (total <= state.currentBet && p.stack > total - p.bet) {
        return { ok: false, error: 'Raise must be higher than current bet' };
      }
      const additional = total - p.bet;
      if (additional > p.stack) return { ok: false, error: 'Not enough chips' };

      // For Pot-Limit Omaha: enforce pot-limit cap
      if (state.type === 'plo' && action.type !== 'allin') {
        const potNow = currentPotTotal(state) + toCall;  // pot after this player calls
        const maxRaise = state.currentBet + potNow;       // max total bet
        if (total > maxRaise && p.stack > total - p.bet) {
          return { ok: false, error: 'Exceeds pot limit (max ' + maxRaise + ')' };
        }
      }

      // Minimum raise check (unless all-in)
      const raiseSize = total - state.currentBet;
      const isAllIn = additional === p.stack;
      if (!isAllIn && raiseSize < state.minRaise && state.currentBet > 0) {
        return { ok: false, error: 'Minimum raise is ' + state.minRaise };
      }

      p.stack -= additional;
      p.bet = total;
      p.totalBet += additional;
      if (p.stack === 0) p.allIn = true;
      if (raiseSize >= state.minRaise) state.minRaise = raiseSize;
      state.currentBet = total;
      state.lastAggressorIdx = idx;
      // Reset acted flag for all other live players (they need to respond)
      state.players.forEach((pp, i) => { if (i !== idx && !pp.folded && !pp.sittingOut && !pp.allIn) pp.acted = false; });
      p.acted = true;
    }
    else {
      return { ok: false, error: 'Unknown action: ' + action.type };
    }

    // Advance turn or close street
    advanceTurn(state);
    return { ok: true, state };
  }

  function currentPotTotal(state) {
    let total = state.pots.reduce((s,p) => s + p.amount, 0);
    state.players.forEach(p => total += p.bet);
    return total;
  }

  function advanceTurn(state) {
    // If only one player left, end hand immediately
    if (liveCount(state) === 1) {
      finishHand(state);
      return;
    }

    // If no one can act (all all-in or folded), enter run-it voting
    const canAct = actionablePlayers(state);
    if (canAct.length === 0) {
      collectBets(state);
      state.pendingRunout = true;
      state.activeIdx = -1;
      state.players.forEach(p => { p.bet = 0; p.acted = false; });
      state.currentBet = 0;
      enterRunitVoting(state);
      return;
    }

    // If everyone who can act has acted and bets are equal -> end street
    const allActed = canAct.every(p => p.acted && p.bet === state.currentBet);
    if (allActed) {
      endStreet(state);
      return;
    }

    // Otherwise advance to next player who hasn't acted (or needs to)
    state.activeIdx = nextToAct(state, state.activeIdx);
  }

  function nextToAct(state, fromIdx) {
    const n = state.players.length;
    for (let i = 1; i <= n; i++) {
      const j = (fromIdx + i) % n;
      const p = state.players[j];
      if (!p.folded && !p.allIn && !p.sittingOut) return j;
    }
    return -1;
  }

  function endStreet(state) {
    collectBets(state);

    // If everyone but one is all-in or folded, enter run-it voting
    if (actionablePlayers(state).length <= 1 && liveCount(state) > 1 && state.board.length < 5) {
      state.players.forEach(p => { p.bet = 0; p.acted = false; });
      state.currentBet = 0;
      state.pendingRunout = true;
      state.activeIdx = -1;
      enterRunitVoting(state);
      return;
    }

    // Reset for next street
    state.players.forEach(p => { p.bet = 0; p.acted = false; });
    state.currentBet = 0;
    state.minRaise = state.bb;

    if (dealNextStreet(state)) {
      // First to act post-flop: first non-folded, non-allin player left of dealer
      state.activeIdx = nextToAct(state, state.dealerIdx);
      if (state.activeIdx < 0) {
        // No one can act (everyone all-in). Re-enter endStreet to deal further.
        endStreet(state);
      }
    }
  }

  /**
   * Deal exactly the next street (flop/turn/river). Returns false if the
   * river is already dealt — caller should call finishHand.
   */
  function dealNextStreet(state) {
    if (state.street === 'preflop') {
      state.deck.pop(); // burn
      state.board.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
      state.street = 'flop';
      return true;
    } else if (state.street === 'flop') {
      state.deck.pop();
      state.board.push(state.deck.pop());
      state.street = 'turn';
      return true;
    } else if (state.street === 'turn') {
      state.deck.pop();
      state.board.push(state.deck.pop());
      state.street = 'river';
      return true;
    } else {
      // river already dealt
      finishHand(state);
      return false;
    }
  }

  function runOutBoard(state) {
    while (state.board.length < 5) {
      if (!dealNextStreet(state)) break;
    }
    state.pendingRunout = false;
  }

  // ---------- RUN-IT-MULTIPLE TIMES ----------

  /**
   * Eligible voters = players with money in any side pot (i.e., non-folded
   * players with totalBet > 0). In practice, the live, all-in players.
   */
  function runitEligibleVoters(state) {
    return state.players.filter(p => !p.folded && !p.sittingOut && p.totalBet > 0).map(p => p.id);
  }

  function enterRunitVoting(state) {
    state.runitPhase = 'voting';
    state.runitVotes = {};
    // If only one eligible voter, auto-resolve to 1 (no point asking)
    const voters = runitEligibleVoters(state);
    if (voters.length < 2) {
      finalizeRunitVote(state, 1);
    }
  }

  /**
   * Submit a vote for run-it-N-times. Returns { ok, error?, finalized }.
   * If all eligible voters have voted, the lowest is taken and finalized=true.
   */
  function submitRunitVote(state, playerId, count) {
    if (state.runitPhase !== 'voting') return { ok: false, error: 'Not voting' };
    if (![1,2,3,4].includes(count)) return { ok: false, error: 'Invalid count' };
    const voters = runitEligibleVoters(state);
    if (!voters.includes(playerId)) return { ok: false, error: 'Not eligible to vote' };
    state.runitVotes[playerId] = count;
    if (voters.every(id => state.runitVotes[id] != null)) {
      const chosen = Math.min(...voters.map(id => state.runitVotes[id]));
      finalizeRunitVote(state, chosen);
      return { ok: true, finalized: true, chosen };
    }
    return { ok: true, finalized: false };
  }

  function finalizeRunitVote(state, count) {
    state.runitPhase = 'running';
    state.runitCount = Math.max(1, Math.min(4, count));
    state.runitActiveIdx = 0;
    if (state.runitCount > 1) {
      // Initialize empty boards. The deck is reset/replenished from current
      // board state. Note: state.board still holds the "current displayed" board
      // (e.g. flop dealt already). For multi-runout we treat that as the
      // shared prefix and each runout extends with fresh independent samples.
      const sharedPrefix = state.board.slice();
      state.runitBoards = [];
      for (let i = 0; i < state.runitCount; i++) {
        state.runitBoards.push(sharedPrefix.slice());
      }
      // The main `board` field will track runitBoards[runitActiveIdx]
      state.board = state.runitBoards[0];
    }
  }

  /**
   * Deal the next street on the currently active runout board.
   * Returns true if dealt, false if this board is complete.
   *
   * For runitCount=1 this behaves identically to the old dealNextStreet
   * (operating on state.board). For runitCount>1, it operates on the
   * runitBoards[runitActiveIdx] board.
   */
  function dealNextStreetMulti(state) {
    if (state.runitCount > 1 && state.runitBoards.length > 0) {
      const b = state.runitBoards[state.runitActiveIdx];
      if (b.length === 0) {
        state.deck.pop();
        b.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
      } else if (b.length === 3) {
        state.deck.pop();
        b.push(state.deck.pop());
      } else if (b.length === 4) {
        state.deck.pop();
        b.push(state.deck.pop());
      } else {
        return false;
      }
      state.board = b;  // sync legacy view
      // Update street label by the *active* board's length, useful for UI
      if (b.length === 3) state.street = 'flop';
      else if (b.length === 4) state.street = 'turn';
      else if (b.length === 5) state.street = 'river';
      return true;
    }
    // Single runout — delegate
    return dealNextStreet(state);
  }

  /** Move to the next runout board (used between successive boards). */
  function advanceRunitBoard(state) {
    if (state.runitCount > 1 && state.runitActiveIdx < state.runitCount - 1) {
      state.runitActiveIdx++;
      state.board = state.runitBoards[state.runitActiveIdx];
      // Reset street to start of this board's deal
      const len = state.board.length;
      if (len === 0) state.street = 'preflop';
      else if (len === 3) state.street = 'flop';
      else if (len === 4) state.street = 'turn';
      else state.street = 'river';
      return true;
    }
    return false;
  }


  /**
   * Collect bets into pots, handling side pots for all-in scenarios.
   *
   * Approach:
   *  1. Snapshot current bets (so folded players' chips still go into the pot).
   *  2. Sort distinct bet levels; for each level, every player who put in
   *     at least that level contributes one slice of (level - prevLevel).
   *  3. Eligibility for that tier = non-folded players who reached that level.
   *  4. If a tier has zero eligible players (everyone folded out), merge
   *     into the previous pot, or award to the highest-contributing
   *     non-folded player if it's the only pot.
   */
  function collectBets(state) {
    const bets = state.players.map(p => p.bet);
    const totalIn = bets.reduce((a,b) => a + b, 0);
    if (totalIn === 0) return;

    const levels = [...new Set(bets.filter(b => b > 0))].sort((a,b) => a-b);
    let prevLevel = 0;

    for (const lvl of levels) {
      const slice = lvl - prevLevel;
      let pot = 0;
      const eligible = [];
      state.players.forEach((p, i) => {
        if (bets[i] >= lvl) {
          pot += slice;
          if (!p.folded) eligible.push(p.id);
        }
      });
      if (pot === 0) { prevLevel = lvl; continue; }

      if (eligible.length === 0) {
        // Nobody eligible at this tier — merge with previous pot if there is one
        if (state.pots.length > 0) {
          state.pots[state.pots.length - 1].amount += pot;
        } else {
          // Award uncontested to anyone who isn't folded — falls through to finishHand logic
          state.pots.push({ amount: pot, eligibleIds: state.players.filter(p => !p.folded).map(p => p.id) });
        }
      } else {
        // Merge with last pot if same eligibility set
        const last = state.pots[state.pots.length - 1];
        if (last && sameSet(last.eligibleIds, eligible)) {
          last.amount += pot;
        } else {
          state.pots.push({ amount: pot, eligibleIds: eligible });
        }
      }
      prevLevel = lvl;
    }
    // Clear bets
    state.players.forEach(p => p.bet = 0);
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    const s = new Set(a);
    return b.every(x => s.has(x));
  }

  function finishHand(state) {
    collectBets(state);
    state.street = 'showdown';

    const evalFn = state.type === 'plo' ? HandEval.evalOmaha : HandEval.evalHoldem;
    const live = state.players.filter(p => !p.folded);

    // Determine the boards to evaluate against. For single runout, use state.board.
    // For multi-runout, use state.runitBoards.
    const boards = (state.runitCount > 1 && state.runitBoards.length > 0)
      ? state.runitBoards.slice()
      : [state.board.slice()];

    // Pre-compute hand strength for each live player against each board
    // handScoresPerBoard[boardIdx][playerId] = { score, cards }
    const handScoresPerBoard = boards.map(b => {
      const out = {};
      for (const p of live) {
        if (p.hole.length > 0 && b.length >= 3) {
          out[p.id] = evalFn(p.hole, b);
        }
      }
      return out;
    });

    const payouts = {};
    const results = [];

    for (const pot of state.pots) {
      const eligible = pot.eligibleIds.filter(id => !state.players.find(p => p.id === id).folded);
      if (eligible.length === 0) {
        if (pot.eligibleIds.length > 0) {
          const winnerId = pot.eligibleIds[0];
          payouts[winnerId] = (payouts[winnerId] || 0) + pot.amount;
        }
        continue;
      }

      if (eligible.length === 1 || boards[0].length < 3) {
        // Uncontested or no board — single winner gets it all
        const winnerId = eligible[0];
        payouts[winnerId] = (payouts[winnerId] || 0) + pot.amount;
        results.push({
          potAmount: pot.amount,
          winners: [winnerId],
          category: null,
          boardResults: null,
        });
        continue;
      }

      // Split the pot into N equal slices (N = number of runouts)
      const N = boards.length;
      const sliceBase = Math.floor(pot.amount / N);
      const sliceRemainder = pot.amount - sliceBase * N;
      const boardResults = [];
      // For overall results display (UI banner), aggregate winners
      const totalWinsByPlayer = {};

      for (let bi = 0; bi < N; bi++) {
        const handScores = handScoresPerBoard[bi];
        let bestScore = null;
        let winners = [];
        for (const id of eligible) {
          const s = handScores[id];
          if (!s) continue;
          if (!bestScore || HandEval.cmp(s.score, bestScore) > 0) {
            bestScore = s.score;
            winners = [id];
          } else if (HandEval.cmp(s.score, bestScore) === 0) {
            winners.push(id);
          }
        }
        // First board gets the rounding remainder
        const sliceAmount = sliceBase + (bi === 0 ? sliceRemainder : 0);
        const share = Math.floor(sliceAmount / winners.length);
        const sliceRem = sliceAmount - share * winners.length;
        winners.forEach((id, i) => {
          const won = share + (i < sliceRem ? 1 : 0);
          payouts[id] = (payouts[id] || 0) + won;
          totalWinsByPlayer[id] = (totalWinsByPlayer[id] || 0) + won;
        });
        boardResults.push({
          boardIdx: bi,
          board: boards[bi].slice(),
          winners,
          amount: sliceAmount,
          category: bestScore ? HandEval.describe(bestScore) : null,
          winningCards: winners[0] && handScores[winners[0]] ? handScores[winners[0]].cards : null,
        });
      }

      // Aggregate winners across boards for the summary
      const aggregateWinners = Object.keys(totalWinsByPlayer);
      results.push({
        potAmount: pot.amount,
        winners: aggregateWinners,
        category: boardResults[0].category, // representative
        winningCards: boardResults[0].winningCards,
        boardResults,
      });
    }

    // Apply payouts
    for (const [id, amt] of Object.entries(payouts)) {
      const p = state.players.find(pp => pp.id === id);
      if (p) p.stack += amt;
    }

    state.lastResult = {
      board: state.board.slice(),
      boards: boards,                // all boards (for UI display)
      runitCount: state.runitCount,
      results,
      handScoresPerBoard,
      payouts,
      handNumber: state.handNumber,
    };

    state.activeIdx = -1;
  }

  /**
   * Get max raise (cap) for current player.
   * For Hold'em: their entire stack. For PLO: pot-limit.
   */
  function maxRaiseTotal(state, playerId) {
    const p = state.players.find(pp => pp.id === playerId);
    if (!p) return 0;
    if (state.type === 'plo') {
      const toCall = state.currentBet - p.bet;
      const pot = currentPotTotal(state) + toCall;
      return Math.min(state.currentBet + pot, p.bet + p.stack);
    }
    return p.bet + p.stack;
  }

  /**
   * Get min raise total for current player.
   */
  function minRaiseTotal(state, playerId) {
    const p = state.players.find(pp => pp.id === playerId);
    if (!p) return 0;
    if (state.currentBet === 0) return Math.min(state.bb, p.bet + p.stack);
    return Math.min(state.currentBet + state.minRaise, p.bet + p.stack);
  }

  /**
   * Sanitize state for a particular viewer (hides other players' hole cards
   * unless we're in showdown).
   */
  function sanitizeFor(state, viewerId) {
    const showAll = state.street === 'showdown' || state.pendingRunout;
    return {
      ...state,
      deck: [], // never send deck
      players: state.players.map(p => ({
        ...p,
        hole: (p.id === viewerId || (showAll && !p.folded)) ? p.hole : p.hole.map(() => '?'),
      })),
    };
  }

  /**
   * Rebuy: restore a busted player with the given stack amount.
   * Returns { ok, error? }. The player will be active starting next hand.
   * If the player isn't busted, this is a no-op success (chips added regardless).
   */
  function rebuyPlayer(state, playerId, amount) {
    const p = state.players.find(pp => pp.id === playerId);
    if (!p) return { ok: false, error: 'Player not found' };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Invalid amount' };
    if (amount > 1_000_000_000) return { ok: false, error: 'Amount too large' };
    p.stack = (p.stack || 0) + Math.floor(amount);
    p.sittingOut = false;
    return { ok: true };
  }

  return {
    create, startHand, applyAction, finishHand,
    sanitizeFor, maxRaiseTotal, minRaiseTotal,
    nextActive, liveCount, actionablePlayers, currentPotTotal,
    dealNextStreet, dealNextStreetMulti, advanceRunitBoard, runOutBoard,
    submitRunitVote, runitEligibleVoters, finalizeRunitVote,
    rebuyPlayer
  };
})();
