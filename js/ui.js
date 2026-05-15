/* ============================================================
   UI — Rendering for poker table, blackjack table, action panels
   ============================================================ */

const UI = (() => {

  const { el, $, $$, fmt, fmtFull, initials } = Util;

  // Track cards we've already shown on each board, so subsequent re-renders
  // don't re-trigger the deal-in animation for already-visible cards.
  // Keyed by handNumber + boardIdx + cardPosition.
  const _shownCards = new Set();
  function _resetShownCardsIfNewHand(handNumber) {
    if (_shownCards.lastHand !== handNumber) {
      _shownCards.clear();
      _shownCards.lastHand = handNumber;
    }
  }
  function _markCardShown(handNumber, boardIdx, cardIdx) {
    const key = handNumber + ':' + boardIdx + ':' + cardIdx;
    if (_shownCards.has(key)) return false; // already shown
    _shownCards.add(key);
    return true;
  }

  function renderHeader(state) {
    const titles = { holdem: "Texas Hold'em", plo: 'Pot-Limit Omaha', blackjack: 'Blackjack' };
    $('#game-title').textContent = titles[state.type] || '—';
    if (state.type === 'blackjack') {
      $('#game-stakes').textContent = `${fmt(state.minBet)}–${fmt(state.maxBet)}`;
    } else {
      $('#game-stakes').textContent = `${fmt(state.sb)} / ${fmt(state.bb)}`;
    }
  }

  // ============ POKER TABLE ============
  function renderPokerTable(state, viewerId) {
    const board = $('#game-board');
    board.innerHTML = '';

    const table = el('div', { class: 'poker-table' });
    const felt = el('div', { class: 'poker-felt' });

    // Compute all-in equities when relevant.
    // - For single-runout: against current state.board
    // - For multi-runout: against the shared prefix (cards present before run-it started),
    //   which is the shorter of the two boards (always equal-length when freshly initialized)
    let equities = null;
    const isMultiRunoutNow = state.runitCount > 1 && state.runitBoards && state.runitBoards.length > 0;
    const showEquities = state.pendingRunout
      || (state.runitPhase === 'running' && state.runitBoards.some(b => b.length < 5));
    if (showEquities) {
      const livePlayers = state.players.filter(p => !p.folded && !p.sittingOut && p.hole && p.hole.length > 0 && !p.hole.includes('?'));
      if (livePlayers.length >= 2) {
        // Use the shared prefix: cards common to ALL boards
        let evalBoard;
        if (isMultiRunoutNow) {
          // Find the longest common prefix across all runitBoards
          const allBoards = state.runitBoards;
          let prefixLen = allBoards[0].length;
          for (const b of allBoards) {
            let k = 0;
            while (k < prefixLen && k < b.length && b[k] === allBoards[0][k]) k++;
            prefixLen = k;
          }
          evalBoard = allBoards[0].slice(0, prefixLen);
        } else {
          evalBoard = state.board;
        }
        try {
          equities = Odds.computeEquities(
            livePlayers.map(p => ({ id: p.id, hole: p.hole })),
            evalBoard,
            state.type
          );
        } catch (e) { console.warn('equity calc failed', e); }
      }
    }

    const community = el('div', { class: 'community-area' });
    const potTotal = state.pots.reduce((s,p) => s + p.amount, 0) + state.players.reduce((s,p) => s + p.bet, 0);

    if (state.street !== 'idle') {
      community.appendChild(el('div', { class: 'pot-display' }, [
        el('span', { class: 'pot-label', text: 'Pot' }),
        el('span', { class: 'pot-amount', text: fmtFull(potTotal) })
      ]));

      // Determine which boards to render
      const isMultiRunout = (state.runitCount > 1 && state.runitBoards && state.runitBoards.length > 0);
      const boards = isMultiRunout ? state.runitBoards : [state.board];
      const winning = state.lastResult && state.lastResult.results[0] && state.lastResult.results[0].winningCards;
      const winSet = new Set(winning || []);
      const activeBoardIdx = isMultiRunout ? state.runitActiveIdx : 0;

      const boardsWrap = el('div', { class: 'community-boards' + (isMultiRunout ? ' multi runs-' + state.runitCount : '') });
      const singleExpected = state.street === 'preflop' ? 0
                           : state.street === 'flop' ? 3
                           : state.street === 'turn' ? 4
                           : 5;

      // Per-board winner info from lastResult (only at showdown)
      const boardResultMap = {};
      if (state.lastResult && state.lastResult.results) {
        for (const r of state.lastResult.results) {
          if (r.boardResults) {
            for (const br of r.boardResults) {
              boardResultMap[br.boardIdx] = br;
            }
          }
        }
      }

      // For "during animation" — compute winner of each fully-dealt board on the fly
      const evalFn = state.type === 'plo' ? HandEval.evalOmaha : HandEval.evalHoldem;
      const livePlayersForEval = state.players.filter(p => !p.folded && !p.sittingOut && p.hole && p.hole.length > 0 && !p.hole.includes('?'));

      // Reset the shown-cards tracker if we're on a new hand
      _resetShownCardsIfNewHand(state.handNumber);

      boards.forEach((b, bi) => {
        const row = el('div', { class: 'community-board-row' });
        if (isMultiRunout) {
          row.appendChild(el('div', { class: 'community-board-label', text: 'Run ' + (bi + 1) }));
        }
        const cardsRow = el('div', { class: 'community-cards' });
        // Detect which positions are newly dealt in this render
        const newlyDealtPositions = [];
        b.forEach((c, ci) => {
          if (_markCardShown(state.handNumber, bi, ci)) newlyDealtPositions.push(ci);
        });
        // The first newly-dealt index is when the stagger starts (so the FIRST
        // new card lands with no delay, subsequent ones cascade)
        const firstNewIdx = newlyDealtPositions[0];
        b.forEach((c, ci) => {
          const isRiverCard = ci === 4;
          const cardEl = Cards.render(c, { highlight: winSet.has(c) });
          if (isRiverCard) cardEl.classList.add('river-card');
          if (newlyDealtPositions.includes(ci)) {
            cardEl.classList.add('is-newly-dealt');
            // Stagger: position within this batch × 850ms
            const order = ci - firstNewIdx;
            if (order > 0) cardEl.style.animationDelay = (order * 850) + 'ms';
          } else {
            cardEl.classList.add('already-shown');
          }
          cardsRow.appendChild(cardEl);
        });
        const padTo = isMultiRunout ? 5 : singleExpected;
        for (let i = b.length; i < padTo; i++) {
          const fd = Cards.render('?');
          fd.classList.add('pending-card');
          cardsRow.appendChild(fd);
        }
        row.appendChild(cardsRow);

        // Winner indicator on completed multi-runout boards
        if (isMultiRunout && b.length === 5) {
          let winnerLabel = '';
          if (boardResultMap[bi]) {
            const br = boardResultMap[bi];
            const names = br.winners.map(id => state.players.find(pp => pp.id === id)?.name || '?');
            winnerLabel = `${names.join(', ')} · ${br.category || ''}`;
          } else if (livePlayersForEval.length >= 2) {
            // Live computation during animation
            try {
              let bestScore = null, winners = [];
              for (const p of livePlayersForEval) {
                const ev = evalFn(p.hole, b);
                if (!bestScore || HandEval.cmp(ev.score, bestScore) > 0) {
                  bestScore = ev.score; winners = [p.id];
                } else if (HandEval.cmp(ev.score, bestScore) === 0) {
                  winners.push(p.id);
                }
              }
              const names = winners.map(id => state.players.find(pp => pp.id === id)?.name || '?');
              winnerLabel = `${names.join(', ')} · ${HandEval.describe(bestScore)}`;
            } catch (e) {}
          }
          if (winnerLabel) {
            row.appendChild(el('div', { class: 'community-board-winner', text: winnerLabel }));
          }
        }
        boardsWrap.appendChild(row);
      });
      community.appendChild(boardsWrap);

      const stageLabel = state.runitPhase === 'voting'
        ? 'CHOOSE: HOW MANY RUNOUTS?'
        : (state.runitPhase === 'running' && state.runitCount > 1)
          ? `RUNNING IT ${state.runitCount}× · BOARD ${state.runitActiveIdx + 1}`
          : state.pendingRunout
            ? 'ALL IN · RUN IT OUT'
            : state.street === 'showdown'
              ? (state.lastResult && state.lastResult.results[0] && state.lastResult.results[0].category) || 'Showdown'
              : state.street.toUpperCase();
      const isAllInLabel = state.pendingRunout || state.runitPhase === 'running' || state.runitPhase === 'voting';
      const stageEl = el('div', { class: 'stage-label' + (isAllInLabel ? ' allin' : ''), text: stageLabel });
      community.appendChild(stageEl);
    } else {
      community.appendChild(el('div', { class: 'waiting-msg', text: 'Waiting for the next hand…' }));
    }
    felt.appendChild(community);
    table.appendChild(felt);

    const myIdx = state.players.findIndex(p => p.id === viewerId);
    const n = state.players.length;
    // Use a compact (side-hugging) seat arc whenever the board area is taller
    // than usual — multi-runout stacks several boards vertically and the standard
    // top-arc seats overlap with cards. 3+ boards is when it gets crowded.
    const useCompactArc = (state.runitCount >= 3);
    const positions = computeSeatPositions(n, { compactArc: useCompactArc });

    state.players.forEach((p, i) => {
      const slot = myIdx >= 0 ? (i - myIdx + n) % n : i;
      const pos = positions[slot];
      const isViewer = p.id === viewerId;

      const seat = el('div', { class: 'seat' + (isViewer ? ' viewer' : ''), style: { left: pos.x, top: pos.y, transform: 'translate(-50%, -50%)' } });
      if (state.activeIdx === i) seat.classList.add('active-turn');
      if (p.folded) seat.classList.add('folded');

      // Opponent seats get small cards above the name plate.
      // The viewer gets only a name plate here — their full-size cards
      // render in a dedicated area below the felt.
      if (!isViewer) {
        const cards = el('div', { class: 'seat-cards' });
        if (p.hole.length > 0) {
          p.hole.forEach(c => cards.appendChild(Cards.render(c, { small: true })));
        } else if (state.street !== 'idle' && !p.sittingOut) {
          const count = state.type === 'plo' ? 4 : 2;
          for (let k = 0; k < count; k++) cards.appendChild(Cards.render('?', { small: true }));
        }
        seat.appendChild(cards);
      }

      const seatCard = el('div', { class: 'seat-card' });
      const nameRow = el('div', { class: 'seat-name' }, [ document.createTextNode(p.name) ]);
      if (isViewer) nameRow.appendChild(el('span', { class: 'you-badge', text: 'YOU' }));
      seatCard.appendChild(nameRow);
      seatCard.appendChild(el('div', { class: 'seat-stack', text: fmtFull(p.stack) }));

      let status = '';
      if (p.sittingOut) status = 'Sitting out';
      else if (p.folded) status = 'Folded';
      else if (p.allIn) status = 'All in';
      else if (state.activeIdx === i) status = 'Thinking…';
      seatCard.appendChild(el('div', { class: 'seat-status', text: status }));

      if (p.bet > 0) seatCard.appendChild(el('div', { class: 'seat-bet has-chips', text: fmtFull(p.bet) }));
      if (state.dealerIdx === i && state.street !== 'idle') {
        seatCard.appendChild(el('div', { class: 'seat-dealer-btn', text: 'D' }));
      }

      // Equity badge during all-in runout
      if (equities && equities[p.id] != null && !p.folded) {
        const pct = Math.round(equities[p.id] * 100);
        seatCard.appendChild(el('div', { class: 'seat-equity', text: pct + '% to win' }));
      }

      seat.appendChild(seatCard);
      table.appendChild(seat);
    });

    board.appendChild(table);

    // Render YOUR hand in a dedicated, prominent area below the table
    const me = state.players.find(p => p.id === viewerId);
    if (me && state.street !== 'idle' && me.hole.length > 0) {
      const myHandWrap = el('div', { class: 'my-hand' });
      let labelText = 'YOUR HAND';
      if (equities && equities[viewerId] != null) {
        const pct = Math.round(equities[viewerId] * 100);
        const suffix = (state.runitCount > 1) ? ` (RUNNING ${state.runitCount}×)` : '';
        labelText = `YOUR HAND · ${pct}% TO WIN${suffix}`;
      }
      const label = el('div', { class: 'my-hand-label' + (equities ? ' equity' : ''), text: labelText });
      myHandWrap.appendChild(label);
      const myCards = el('div', { class: 'my-hand-cards' });
      me.hole.forEach(c => myCards.appendChild(Cards.render(c, { big: true })));
      myHandWrap.appendChild(myCards);
      board.appendChild(myHandWrap);
    }

    if (state.street === 'showdown' && state.lastResult) {
      board.appendChild(renderShowdownBanner(state, viewerId));
    }
  }

  function computeSeatPositions(n, opts) {
    // Slot 0 = viewer, near bottom-center of felt.
    // Other slots spread across the top arc so they all fit on-screen
    // regardless of player count.
    // When multi-runout is active (3+ boards stacked vertically in the center),
    // we flatten the arc so seats hug the sides and leave the center clear.
    const compact = opts && opts.compactArc;
    const positions = [];

    if (n === 1) {
      positions.push({ x: '50%', y: '78%' });
      return positions;
    }

    // Viewer at bottom
    positions.push({ x: '50%', y: '82%' });

    const opponents = n - 1;
    if (compact) {
      // Compact mode for multi-runout: opponents hug the left and right sides,
      // alternating, so they never cross the vertical center column where the
      // multi-board stack lives. Each side gets up to 4 tiers from top down.
      const perSide = Math.ceil(opponents / 2);
      for (let i = 0; i < opponents; i++) {
        const side = i % 2 === 0 ? 'left' : 'right';
        const tier = Math.floor(i / 2);
        const x = side === 'left' ? 6 : 94;
        // Stack tiers in the upper half of the felt only (top → midline).
        // perSide=1 → single tier at y=22%
        // perSide=2 → tiers at y=18%, 50%
        // perSide=3 → tiers at y=14%, 36%, 58%
        // perSide=4 → tiers at y=12%, 30%, 48%, 66% (avoids viewer at 82%)
        const startY = 22 - (perSide - 1) * 4;
        const stepY  = perSide === 1 ? 0 : (perSide <= 2 ? 32 : 18);
        const y = startY + tier * stepY;
        positions.push({ x: x + '%', y: y + '%' });
      }
      return positions;
    }

    // Standard arc: opponents on top arc from ~170° to ~10°
    const startAngle = Math.PI * 0.95;
    const endAngle   = Math.PI * 0.05;
    for (let i = 0; i < opponents; i++) {
      const t = opponents === 1 ? 0.5 : i / (opponents - 1);
      const angle = startAngle + (endAngle - startAngle) * t;
      const x = 50 + 42 * Math.cos(angle);
      const y = 45 - 36 * Math.sin(angle);
      positions.push({ x: x + '%', y: y + '%' });
    }
    return positions;
  }

  function renderShowdownBanner(state, viewerId) {
    const wrap = el('div', { class: 'showdown-banner' });
    const wins = state.lastResult.results;
    const winText = wins.map(w => {
      const winnerNames = w.winners.map(id => {
        const p = state.players.find(pp => pp.id === id);
        return p ? p.name + (p.id === viewerId ? ' (you)' : '') : '?';
      }).join(', ');
      const cat = w.category ? ` — ${w.category}` : '';
      return `${winnerNames} wins ${fmtFull(w.potAmount)}${cat}`;
    }).join(' · ');
    wrap.textContent = winText;
    return wrap;
  }

  // Returns a span with a kbd hint badge
  function kbd(key) {
    return el('span', { class: 'kbd', text: key });
  }

  // Build button label with a key hint at the right
  function labelWithKey(text, key) {
    const wrap = el('span', { style: { display: 'inline-flex', alignItems: 'center' } });
    wrap.appendChild(document.createTextNode(text));
    wrap.appendChild(kbd(key));
    return wrap;
  }

  function renderPokerActions(state, viewerId, onAction) {
    const panel = $('#action-panel');
    panel.innerHTML = '';
    panel.classList.remove('disabled');

    // Reset any active poker bindings whenever we re-render
    if (window.PokerKeys) window.PokerKeys = null;

    const me = state.players.find(p => p.id === viewerId);
    if (!me) { showWaiting(panel, 'Spectating'); return; }

    // ===== Busted player — offer rebuy =====
    // Show the rebuy button when the player has 0 chips AND either:
    //   - the table is idle (between hands / waiting), or
    //   - the player is sitting out a hand in progress (others are playing)
    // We hide it during the player's OWN live hand and during all-in resolution
    // so the rebuy CTA doesn't interrupt the player's experience of their hand.
    const playerIsSpectator = me.sittingOut && (me.totalBet || 0) === 0;
    if ((me.stack || 0) <= 0 && (state.street === 'idle' || playerIsSpectator)) {
      const wrap = el('div', { class: 'rebuy-action-wrap' });
      wrap.appendChild(el('div', { class: 'rebuy-message', text: "You're out of chips." }));
      const btn = el('button', { class: 'btn btn-primary', onclick: () => window.AppRebuy && window.AppRebuy.open() }, 'Buy back in');
      wrap.appendChild(btn);
      panel.appendChild(wrap);
      return;
    }

    // ===== Run-it voting phase =====
    if (state.runitPhase === 'voting') {
      const voters = state.players.filter(p => !p.folded && !p.sittingOut && p.totalBet > 0);
      const iAmVoter = voters.some(v => v.id === viewerId);
      const myVote = state.runitVotes && state.runitVotes[viewerId];
      const votesIn = voters.filter(v => state.runitVotes && state.runitVotes[v.id] != null).length;

      if (iAmVoter && !myVote) {
        // Show the picker
        panel.appendChild(el('div', { class: 'action-info' }, [
          el('span', { class: 'action-info-label', text: 'All-in — run it how many times?' }),
          el('span', { class: 'action-info-value', text: 'Lowest pick wins' })
        ]));
        const btns = el('div', { class: 'action-buttons runit-vote-row' });
        [1,2,3,4].forEach(n => {
          btns.appendChild(el('button', {
            class: 'btn runit-vote-btn' + (n === 1 ? ' runit-vote-1' : ''),
            onclick: () => onAction({ type: 'runit-vote', count: n })
          }, [labelWithKey(n + '×', String(n))]));
        });
        panel.appendChild(btns);
        // Expose keys
        window.PokerKeys = {
          runitVote1: () => onAction({ type: 'runit-vote', count: 1 }),
          runitVote2: () => onAction({ type: 'runit-vote', count: 2 }),
          runitVote3: () => onAction({ type: 'runit-vote', count: 3 }),
          runitVote4: () => onAction({ type: 'runit-vote', count: 4 }),
        };
      } else if (iAmVoter && myVote) {
        showWaiting(panel, `You voted ${myVote}× — waiting for others (${votesIn}/${voters.length})`);
      } else {
        showWaiting(panel, `Players voting on run-it count (${votesIn}/${voters.length})`);
      }
      return;
    }

    // ===== Run-it animation in progress — disable input =====
    if (state.runitPhase === 'running' && state.runitCount > 1) {
      showWaiting(panel, `Running it ${state.runitCount}× — dealing board ${state.runitActiveIdx + 1} of ${state.runitCount}…`);
      return;
    }

    if (state.street === 'idle')     { showWaiting(panel, 'Waiting for next hand…'); return; }
    if (state.street === 'showdown') { showWaiting(panel, 'Hand complete'); return; }
    if (state.players[state.activeIdx]?.id !== viewerId) {
      const active = state.players[state.activeIdx];
      showWaiting(panel, active ? `Waiting on ${active.name}…` : 'Waiting…');
      return;
    }

    const toCall = state.currentBet - me.bet;
    const canCheck = toCall === 0;

    panel.appendChild(el('div', { class: 'action-info' }, [
      el('span', { class: 'action-info-label', text: canCheck ? 'Action on you' : `${fmtFull(toCall)} to call` }),
      el('span', { class: 'action-info-value', text: 'Stack: ' + fmtFull(me.stack) })
    ]));

    const btns = el('div', { class: 'action-buttons' });

    // Fold button
    const foldBtn = el('button', { class: 'btn action-btn-fold', onclick: () => onAction({ type: 'fold' }) }, [labelWithKey('Fold', 'F')]);
    btns.appendChild(foldBtn);

    // Check / Call button (one key — C)
    let checkOrCallFn;
    if (canCheck) {
      checkOrCallFn = () => onAction({ type: 'check' });
      btns.appendChild(el('button', { class: 'btn action-btn-check', onclick: checkOrCallFn }, [labelWithKey('Check', 'C')]));
    } else {
      const callAmt = Math.min(toCall, me.stack);
      checkOrCallFn = () => onAction({ type: 'call' });
      const lbl = callAmt >= me.stack ? `All-in ${fmtFull(callAmt)}` : `Call ${fmtFull(callAmt)}`;
      btns.appendChild(el('button', { class: 'btn action-btn-call', onclick: checkOrCallFn }, [labelWithKey(lbl, 'C')]));
    }
    panel.appendChild(btns);

    const minRaise = Holdem.minRaiseTotal(state, viewerId);
    const maxRaise = Holdem.maxRaiseTotal(state, viewerId);

    let raiseInput = null, raiseFn = null, allinFn = null, halfFn = null, potFn = null, maxFn = null;

    if (maxRaise > me.bet && me.stack > toCall) {
      const betControls = el('div', { class: 'bet-controls' });
      const slider = el('input', { type: 'range', class: 'bet-slider', min: minRaise, max: maxRaise, value: minRaise, step: 1 });
      const input = el('input', { type: 'number', class: 'bet-input', min: minRaise, max: maxRaise, value: minRaise });
      raiseInput = input;
      slider.addEventListener('input', () => input.value = slider.value);
      input.addEventListener('input', () => slider.value = Util.clamp(+input.value || minRaise, minRaise, maxRaise));
      // Allow Enter inside the bet input to confirm the raise
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); raiseFn && raiseFn(); }
      });

      const presets = el('div', { class: 'bet-presets' });
      const potNow = Holdem.currentPotTotal(state);
      const half = Math.min(maxRaise, Math.max(minRaise, Math.round(state.currentBet + potNow * 0.5)));
      const full = Math.min(maxRaise, Math.max(minRaise, Math.round(state.currentBet + potNow)));
      const setVal = v => { input.value = v; slider.value = v; };
      halfFn = () => setVal(half);
      potFn  = () => setVal(full);
      maxFn  = () => setVal(maxRaise);
      presets.appendChild(el('button', { class: 'bet-preset', onclick: halfFn }, [labelWithKey('½ pot', '1')]));
      presets.appendChild(el('button', { class: 'bet-preset', onclick: potFn  }, [labelWithKey('Pot',   '2')]));
      presets.appendChild(el('button', { class: 'bet-preset', onclick: maxFn  }, [labelWithKey('Max',   '3')]));

      betControls.appendChild(presets);
      betControls.appendChild(slider);
      betControls.appendChild(input);

      const raiseLabel = state.currentBet === 0 ? 'Bet' : 'Raise';
      raiseFn = () => {
        const amt = Util.clamp(+input.value || minRaise, minRaise, maxRaise);
        onAction({ type: state.currentBet === 0 ? 'bet' : 'raise', amount: amt });
      };
      allinFn = () => {
        setVal(maxRaise);
        onAction({ type: state.currentBet === 0 ? 'bet' : 'raise', amount: maxRaise });
      };
      betControls.appendChild(el('button', { class: 'btn action-btn-raise', onclick: raiseFn }, [labelWithKey(raiseLabel, 'R')]));
      panel.appendChild(betControls);
    }

    // Expose actions for keyboard
    window.PokerKeys = {
      fold:    () => onAction({ type: 'fold' }),
      checkOrCall: checkOrCallFn,
      raise:   () => { if (raiseInput) { raiseInput.focus(); raiseInput.select(); } },
      submitRaise: raiseFn,
      allin:   allinFn,
      half:    halfFn,
      pot:     potFn,
      max:     maxFn,
    };
  }

  // ============ BLACKJACK TABLE ============
  function renderBlackjackTable(state, viewerId) {
    const board = $('#game-board');
    board.innerHTML = '';

    const isBot = !state.dealer.id || state.dealer.id === 'bot';
    const visiblePlayers = state.players.filter(p => p.id !== state.dealer.id);
    const isSolo = visiblePlayers.length === 1 && isBot;

    const table = el('div', { class: 'bj-table' + (isSolo ? ' solo' : '') });

    const dealer = el('div', { class: 'bj-dealer' + (isBot ? ' bot-dealer' : '') });
    const dealerInfo = el('div', { class: 'bj-dealer-info' });
    const h3 = el('h3');
    h3.appendChild(document.createTextNode(isBot ? '🤖 House' : (state.dealer.name || 'Dealer')));
    if (isBot) h3.appendChild(el('span', { class: 'bot-badge', style: { marginLeft: '8px' }, text: 'BOT' }));
    else h3.appendChild(el('span', { class: 'player-badge', style: { marginLeft: '8px' }, text: 'DEALER' }));
    dealerInfo.appendChild(h3);

    if (state.dealer.holeRevealed) {
      const v = HandEval.blackjackValue(state.dealer.hand);
      const totalCls = 'bj-dealer-total' + (v.isBust ? ' bust' : '');
      dealerInfo.appendChild(el('div', { class: totalCls, text: 'Total: ' + v.total + (v.isBust ? ' — bust' : (v.isSoft ? ' (soft)' : '')) }));
    } else {
      const showText = state.dealer.hand.length > 0 ? `Showing ${HandEval.blackjackValue([state.dealer.hand[0]]).total}` : (state.phase === 'idle' ? 'Waiting…' : 'Ready to deal');
      dealerInfo.appendChild(el('div', { class: 'bj-dealer-total', text: showText }));
    }
    dealer.appendChild(dealerInfo);

    const dealerCards = el('div', { class: 'bj-dealer-cards' });
    state.dealer.hand.forEach(c => dealerCards.appendChild(Cards.render(c)));
    dealer.appendChild(dealerCards);
    table.appendChild(dealer);

    const playersRow = el('div', { class: 'bj-players-row' });
    visiblePlayers.forEach(p => {
      const idx = state.players.findIndex(pp => pp.id === p.id);
      const pNode = el('div', { class: 'bj-player' });
      if (state.activeIdx === idx) pNode.classList.add('active-turn');
      if (p.status === 'bust' || p.status === 'lost') pNode.classList.add('lost');
      else if (p.status === 'won' || p.status === 'blackjack') pNode.classList.add('won');
      else if (p.status === 'push') pNode.classList.add('push');

      const nameRow = el('div', { class: 'bj-player-name' }, [ document.createTextNode(p.name) ]);
      if (p.id === viewerId) nameRow.appendChild(el('span', { class: 'you-badge', text: 'YOU' }));
      pNode.appendChild(nameRow);
      pNode.appendChild(el('div', { class: 'bj-player-bankroll', text: fmtFull(p.bankroll) + ' chips' }));

      const cards = el('div', { class: 'bj-player-cards' });
      p.hand.forEach(c => cards.appendChild(Cards.render(c)));
      pNode.appendChild(cards);

      if (p.hand.length > 0) {
        const v = HandEval.blackjackValue(p.hand);
        pNode.appendChild(el('div', {
          class: 'bj-player-total' + (v.isBlackjack ? ' blackjack' : ''),
          text: v.isBlackjack ? 'Blackjack!' : (v.isSoft ? 'Soft ' : '') + v.total
        }));
      }
      if (p.bet > 0) pNode.appendChild(el('div', { class: 'bj-player-bet', text: 'Bet: ' + fmtFull(p.bet) }));

      const statusLabel = {
        bust: 'Bust', stood: 'Standing', blackjack: 'Blackjack',
        won: 'Won', lost: 'Lost', push: 'Push',
        betting: 'Betting…', ready: 'Ready ✓', waiting: 'Sitting out', playing: 'Playing'
      }[p.status] || '';
      pNode.appendChild(el('div', { class: 'bj-player-status', text: statusLabel }));

      playersRow.appendChild(pNode);
    });
    table.appendChild(playersRow);
    board.appendChild(table);
  }

  function renderBlackjackActions(state, viewerId, onAction) {
    const panel = $('#action-panel');
    panel.innerHTML = '';
    panel.classList.remove('disabled');

    // Reset blackjack keys on every render
    if (window.BlackjackKeys) window.BlackjackKeys = null;

    const me = state.players.find(p => p.id === viewerId);
    if (!me) { showWaiting(panel, 'Spectating'); return; }

    const isBot = !state.dealer.id || state.dealer.id === 'bot';
    const iAmDealer = viewerId === state.dealer.id && !isBot;

    // ===== Busted player — offer rebuy (not the dealer) =====
    if (!iAmDealer && (me.bankroll || 0) <= 0 && (!me.bet || me.bet === 0)) {
      const wrap = el('div', { class: 'rebuy-action-wrap' });
      wrap.appendChild(el('div', { class: 'rebuy-message', text: "You're out of chips." }));
      const btn = el('button', { class: 'btn btn-primary', onclick: () => window.AppRebuy && window.AppRebuy.open() }, 'Buy back in');
      wrap.appendChild(btn);
      panel.appendChild(wrap);
      return;
    }

    // === Human dealer controls during dealer phase ===
    if (iAmDealer && state.phase === 'dealer') {
      const v = HandEval.blackjackValue(state.dealer.hand);
      panel.appendChild(el('div', { class: 'action-info' }, [
        el('span', { class: 'action-info-label', text: 'Dealer action' }),
        el('span', { class: 'action-info-value', text: (v.isSoft ? 'Soft ' : '') + v.total })
      ]));
      const mustHit = v.total < 17 || (v.total === 17 && v.isSoft);
      const hitFn = () => onAction({ type: 'hit' });
      const standFn = () => onAction({ type: 'stand' });
      const btns = el('div', { class: 'action-buttons' });
      btns.appendChild(el('button', { class: 'btn action-btn-call', onclick: hitFn }, [labelWithKey('Hit', 'H')]));
      const standBtn = el('button', { class: 'btn action-btn-check', onclick: standFn }, [labelWithKey('Stand', 'S')]);
      if (mustHit) standBtn.disabled = true;
      btns.appendChild(standBtn);
      panel.appendChild(btns);
      if (mustHit) {
        panel.appendChild(el('div', { class: 'muted', style: { fontSize: '0.85rem' }, text: 'Must hit on 16 or less / soft 17' }));
      }
      window.BlackjackKeys = { hit: hitFn, stand: mustHit ? null : standFn };
      return;
    }

    // === Human dealer waiting ===
    if (iAmDealer) {
      if (state.phase === 'idle' || state.phase === 'settled') {
        showWaiting(panel, 'Waiting for next hand…');
      } else if (state.phase === 'betting') {
        showWaiting(panel, 'Players are placing bets…');
      } else if (state.phase === 'playing') {
        const active = state.players[state.activeIdx];
        showWaiting(panel, active ? `${active.name} is playing…` : 'Waiting…');
      } else {
        showWaiting(panel, 'Dealing…');
      }
      return;
    }

    if (state.phase === 'idle' || state.phase === 'settled') {
      showWaiting(panel, 'Waiting for next hand…'); return;
    }

    if (state.phase === 'betting' && me.status === 'betting') {
      panel.appendChild(el('div', { class: 'action-info' }, [
        el('span', { class: 'action-info-label', text: 'Place your bet' }),
        el('span', { class: 'action-info-value', text: fmtFull(me.bankroll) + ' chips' })
      ]));

      const betWrap = el('div', { class: 'bj-bet-panel' });
      const presets = el('div', { class: 'bj-bet-presets' });
      const opts = [state.minBet, state.minBet * 2, state.minBet * 5, state.minBet * 10, state.maxBet]
        .filter((v,i,a) => v <= me.bankroll && v <= state.maxBet && a.indexOf(v) === i);
      opts.forEach(v => {
        presets.appendChild(el('button', { class: 'bj-chip', onclick: () => onAction({ type: 'bet', amount: v }) }, fmt(v)));
      });
      betWrap.appendChild(presets);

      const customRow = el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' } });
      const input = el('input', { type: 'number', min: state.minBet, max: Math.min(state.maxBet, me.bankroll), value: state.minBet, style: { width: '120px', padding: '10px 14px' } });
      const placeFn = () => {
        const v = Util.clamp(+input.value || state.minBet, state.minBet, Math.min(state.maxBet, me.bankroll));
        onAction({ type: 'bet', amount: v });
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); placeFn(); }
      });
      const placeBtn = el('button', { class: 'btn btn-primary', onclick: placeFn }, [labelWithKey('Place bet', 'B')]);
      const skipBtn = el('button', { class: 'btn btn-ghost', style: { flex: 'none', padding: '12px 16px' }, onclick: () => onAction({ type: 'skip' }) }, 'Sit out');
      customRow.appendChild(input);
      customRow.appendChild(placeBtn);
      customRow.appendChild(skipBtn);
      betWrap.appendChild(customRow);
      panel.appendChild(betWrap);

      window.BlackjackKeys = {
        bet: () => { input.focus(); input.select(); },
        submitBet: placeFn,
      };
      return;
    }

    if (state.phase === 'betting' && me.status === 'ready') {
      showWaiting(panel, 'Waiting for others to bet…'); return;
    }

    if (state.phase === 'playing') {
      const isMyTurn = state.players[state.activeIdx]?.id === viewerId;
      if (!isMyTurn) {
        const active = state.players[state.activeIdx];
        showWaiting(panel, active ? `Waiting on ${active.name}…` : 'Dealer playing…');
        return;
      }
      const v = HandEval.blackjackValue(me.hand);
      panel.appendChild(el('div', { class: 'action-info' }, [
        el('span', { class: 'action-info-label', text: 'Your move' }),
        el('span', { class: 'action-info-value', text: (v.isSoft ? 'Soft ' : '') + v.total })
      ]));
      const hitFn = () => onAction({ type: 'hit' });
      const standFn = () => onAction({ type: 'stand' });
      const canDouble = me.hand.length === 2 && me.bankroll >= me.bet;
      const doubleFn = canDouble ? () => onAction({ type: 'double' }) : null;
      const btns = el('div', { class: 'action-buttons' });
      btns.appendChild(el('button', { class: 'btn action-btn-call', onclick: hitFn }, [labelWithKey('Hit', 'H')]));
      btns.appendChild(el('button', { class: 'btn action-btn-check', onclick: standFn }, [labelWithKey('Stand', 'S')]));
      if (canDouble) {
        btns.appendChild(el('button', { class: 'btn action-btn-raise', onclick: doubleFn }, [labelWithKey('Double', 'D')]));
      }
      panel.appendChild(btns);
      window.BlackjackKeys = { hit: hitFn, stand: standFn, double: doubleFn };
      return;
    }

    if (state.phase === 'dealer') {
      showWaiting(panel, 'Dealer is playing…'); return;
    }
  }

  function showWaiting(panel, msg) {
    panel.classList.add('disabled');
    panel.appendChild(el('div', { class: 'waiting-msg', text: msg }));
  }

  // ============ LOBBY ============
  function renderLobbyPlayers(players, hostId, dealerId) {
    const list = $('#lobby-players');
    list.innerHTML = '';
    players.forEach(p => {
      const li = el('li');
      li.appendChild(el('div', { class: 'player-name' }, [
        el('div', { class: 'player-avatar', text: initials(p.name) }),
        document.createTextNode(p.name),
      ]));
      const badges = el('div', { style: { display: 'flex', gap: '6px' } });
      if (p.id === hostId)    badges.appendChild(el('span', { class: 'player-badge', text: 'Host' }));
      if (p.id === dealerId)  badges.appendChild(el('span', { class: 'player-badge', text: 'Dealer' }));
      li.appendChild(badges);
      list.appendChild(li);
    });
  }

  // ============ HISTORY ============
  function renderHistory(history) {
    const body = $('#history-body');
    body.innerHTML = '';
    if (!history || history.length === 0) {
      body.appendChild(el('p', { class: 'muted', text: 'No hands played yet.' }));
      return;
    }
    history.slice().reverse().forEach(h => {
      const entry = el('div', { class: 'hand-entry' });
      entry.appendChild(el('div', { class: 'hand-entry-header' }, [
        el('span', { text: 'Hand #' + h.handNumber }),
        el('span', { class: 'hand-entry-result', text: h.summary || '' })
      ]));
      if (h.details) entry.appendChild(el('div', { text: h.details, style: { fontSize: '0.9rem', color: 'var(--ink-soft)' } }));
      if (h.cards && h.cards.length) {
        const cardsRow = el('div', { class: 'hand-entry-cards' });
        h.cards.forEach(c => cardsRow.appendChild(Cards.render(c, { tiny: true })));
        entry.appendChild(cardsRow);
      }
      body.appendChild(entry);
    });
  }

  // ============ ADMIN DRAWER ============
  function renderAdminDrawer(state, isHost, players, callbacks) {
    const body = $('#drawer-body');
    body.innerHTML = '';

    // Shortcuts cheatsheet — shown to everyone
    body.appendChild(renderShortcutsCheatsheet(state.type));

    if (!isHost) {
      body.appendChild(el('p', { class: 'muted', text: 'Only the host can change table settings.' }));
      return;
    }

    // Pending rebuy requests — only shown if there are any
    if (callbacks.rebuyRequests && callbacks.rebuyRequests.length > 0) {
      const recSec = el('div', { class: 'drawer-section' });
      recSec.appendChild(el('h3', { text: 'Buy-back requests' }));
      callbacks.rebuyRequests.forEach(req => {
        const row = el('div', { class: 'rebuy-request' });
        const info = el('div', { class: 'rebuy-request-info' });
        info.appendChild(el('div', { class: 'rebuy-request-name', text: req.name }));
        info.appendChild(el('div', { class: 'rebuy-request-amount', text: 'Requested: ' + fmtFull(req.requestedAmount) }));
        row.appendChild(info);
        const acts = el('div', { class: 'rebuy-request-actions' });
        acts.appendChild(el('button', { class: 'btn btn-primary', onclick: () => callbacks.reviewRebuy(req.playerId) }, 'Review'));
        row.appendChild(acts);
        recSec.appendChild(row);
      });
      body.appendChild(recSec);
    }

    const sec1 = el('div', { class: 'drawer-section' });
    sec1.appendChild(el('h3', { text: 'Players' }));
    const ul = el('ul', { class: 'player-mgmt-list' });
    players.forEach(p => {
      const li = el('li');
      li.appendChild(el('span', { text: p.name }));
      const acts = el('div', { class: 'actions' });
      if (state.type === 'blackjack') {
        acts.appendChild(el('button', { onclick: () => callbacks.adjustBankroll(p.id, +500) }, '+500'));
        acts.appendChild(el('button', { onclick: () => callbacks.adjustBankroll(p.id, -500) }, '−500'));
      } else {
        acts.appendChild(el('button', { onclick: () => callbacks.adjustStack(p.id, +1000) }, '+1k'));
        acts.appendChild(el('button', { onclick: () => callbacks.adjustStack(p.id, -1000) }, '−1k'));
      }
      if (p.id !== Network.getPlayerId()) {
        acts.appendChild(el('button', { class: 'danger', onclick: () => {
          if (confirm(`Kick ${p.name}?`)) callbacks.kick(p.id);
        }}, 'Kick'));
      }
      li.appendChild(acts);
      ul.appendChild(li);
    });
    sec1.appendChild(ul);
    body.appendChild(sec1);

    const sec2 = el('div', { class: 'drawer-section' });
    sec2.appendChild(el('h3', { text: 'Hand control' }));
    if (state.type !== 'blackjack') {
      if (state.street === 'idle' || state.street === 'showdown') {
        sec2.appendChild(el('button', { class: 'btn btn-primary btn-lg', style: { marginBottom: '8px' }, onclick: () => callbacks.startHand() }, 'Deal next hand'));
      } else {
        sec2.appendChild(el('p', { class: 'muted', text: 'Hand in progress.' }));
      }
    } else {
      if (state.phase === 'idle' || state.phase === 'settled') {
        sec2.appendChild(el('button', { class: 'btn btn-primary btn-lg', style: { marginBottom: '8px' }, onclick: () => callbacks.startHand() }, 'Start next round'));
      } else {
        sec2.appendChild(el('p', { class: 'muted', text: 'Round in progress.' }));
      }
    }
    body.appendChild(sec2);

    if (state.type !== 'blackjack') {
      const sec3 = el('div', { class: 'drawer-section' });
      sec3.appendChild(el('h3', { text: 'Blinds' }));
      sec3.appendChild(el('div', { class: 'setting-row' }, [
        el('label', { text: 'Small blind' }),
        el('input', { type: 'number', value: state.sb, min: 1, id: 'admin-sb' })
      ]));
      sec3.appendChild(el('div', { class: 'setting-row' }, [
        el('label', { text: 'Big blind' }),
        el('input', { type: 'number', value: state.bb, min: 2, id: 'admin-bb' })
      ]));
      sec3.appendChild(el('button', { class: 'btn btn-secondary', style: { marginTop: '12px' }, onclick: () => {
        const sb = +document.getElementById('admin-sb').value;
        const bb = +document.getElementById('admin-bb').value;
        callbacks.setBlinds(sb, bb);
      }}, 'Update blinds'));
      body.appendChild(sec3);
    }

    const sec4 = el('div', { class: 'drawer-section' });
    sec4.appendChild(el('button', { class: 'btn btn-danger btn-lg', onclick: () => {
      if (confirm('End the game and return to lobby for everyone?')) callbacks.endGame();
    }}, 'End game'));
    body.appendChild(sec4);
  }

  // ============ CHAT ============
  function renderShortcutsCheatsheet(gameType) {
    const sec = el('div', { class: 'drawer-section' });
    sec.appendChild(el('h3', { text: 'Keyboard shortcuts' }));
    const list = el('div', { class: 'shortcut-list' });

    const items = [];
    if (gameType === 'blackjack') {
      items.push(['Hit',        ['H']]);
      items.push(['Stand',      ['S']]);
      items.push(['Double',     ['D']]);
      items.push(['Focus bet input',   ['B']]);
      items.push(['Submit bet/raise',  ['Enter']]);
    } else {
      items.push(['Fold',       ['F']]);
      items.push(['Check / Call', ['C']]);
      items.push(['Focus raise input', ['R']]);
      items.push(['All-in',     ['A']]);
      items.push(['½ pot / Pot / Max', ['1', '2', '3']]);
      items.push(['Submit raise', ['Enter']]);
    }
    items.push(['Toggle chat',          ['M']]);
    items.push(['Toggle hand history',  ['?']]);
    items.push(['Toggle settings',      [',']]);
    items.push(['Send chat / blur',     ['Enter', 'Esc']]);

    items.forEach(([action, keys]) => {
      const row = el('div', { class: 'shortcut-row' });
      row.appendChild(el('span', { class: 'shortcut-row-action', text: action }));
      const kw = el('div', { class: 'shortcut-row-keys' });
      keys.forEach(k => kw.appendChild(el('span', { class: 'kbd', text: k })));
      row.appendChild(kw);
      list.appendChild(row);
    });
    sec.appendChild(list);
    return sec;
  }

  function renderChat(messages, myId) {
    const wrap = $('#chat-messages');
    wrap.innerHTML = '';
    if (!messages || messages.length === 0) {
      wrap.appendChild(el('div', { class: 'chat-empty', text: 'No messages yet. Say something.' }));
      return;
    }
    messages.forEach(m => wrap.appendChild(renderChatMessage(m, myId)));
    // Auto-scroll to bottom
    wrap.scrollTop = wrap.scrollHeight;
  }

  function renderChatMessage(m, myId) {
    if (m.system) {
      const w = el('div', { class: 'chat-msg chat-msg-system' });
      w.appendChild(el('div', { class: 'chat-msg-text', text: m.text }));
      return w;
    }
    const isSelf = m.playerId === myId;
    const w = el('div', { class: 'chat-msg' + (isSelf ? ' self' : '') });
    w.appendChild(el('div', { class: 'chat-msg-avatar', text: initials(m.name || '?') }));
    const body = el('div', { class: 'chat-msg-body' });
    body.appendChild(el('div', { class: 'chat-msg-meta' }, [
      el('span', { class: 'chat-msg-name', text: m.name + (isSelf ? ' (you)' : '') }),
      el('span', { class: 'chat-msg-time', text: formatChatTime(m.ts) }),
    ]));
    // textContent (via el's text:) safely escapes — no XSS risk
    body.appendChild(el('div', { class: 'chat-msg-text', text: m.text }));
    w.appendChild(body);
    return w;
  }

  function appendChatMessage(m, myId) {
    const wrap = $('#chat-messages');
    // Remove empty placeholder if present
    const empty = wrap.querySelector('.chat-empty');
    if (empty) empty.remove();
    wrap.appendChild(renderChatMessage(m, myId));
    wrap.scrollTop = wrap.scrollHeight;
  }

  function updateChatBadge(count) {
    const badge = $('#chat-unread');
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  function formatChatTime(ts) {
    const d = new Date(ts);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return h + ':' + m;
  }
  function renderStats(filter) {
    const display = Stats.getDisplay(filter);
    const tiles = $('#stats-tiles');
    tiles.innerHTML = '';
    display.tiles.forEach(t => {
      const tile = el('div', { class: 'stat-tile' + (t.accent ? ' ' + t.accent : '') });
      tile.appendChild(el('div', { class: 'stat-tile-label', text: t.label }));
      tile.appendChild(el('div', { class: 'stat-tile-value', text: t.value }));
      if (t.sub) tile.appendChild(el('div', { class: 'stat-tile-sub', text: t.sub }));
      tiles.appendChild(tile);
    });

    const recent = $('#stats-recent');
    recent.innerHTML = '';
    if (display.recent.length === 0) {
      recent.appendChild(el('div', { class: 'stats-recent-empty', text: 'No hands recorded yet. Play a game to start tracking.' }));
    } else {
      display.recent.slice(0, 20).forEach(r => {
        const row = el('div', { class: 'stats-recent-row' });
        const gameLabel = { holdem: "Hold'em", plo: 'PLO', blackjack: 'Blackjack' }[r.game] || r.game;
        row.appendChild(el('span', { class: 'stats-recent-game', text: gameLabel }));
        row.appendChild(el('span', { class: 'stats-recent-desc', text: r.desc || '' }));
        const resultText = r.outcome === 'win' ? `+${fmtFull(r.netChange)}`
                        : r.outcome === 'push' ? 'Push'
                        : r.outcome === 'fold' ? 'Fold'
                        : `${fmtFull(r.netChange)}`;
        row.appendChild(el('span', { class: 'stats-recent-result ' + (r.outcome === 'win' ? 'win' : r.outcome === 'push' ? 'push' : 'loss'), text: resultText }));
        row.appendChild(el('span', { class: 'stats-recent-time', text: Stats.formatTime(r.ts) }));
        recent.appendChild(row);
      });
    }
  }

  return {
    renderHeader,
    renderPokerTable, renderPokerActions,
    renderBlackjackTable, renderBlackjackActions,
    renderLobbyPlayers, renderHistory, renderAdminDrawer,
    renderStats,
    renderChat, appendChatMessage, updateChatBadge,
  };
})();
