/* ============================================================
   APP — Main orchestration
   ============================================================ */

(() => {
  const { $, $$, el, show, fmt, fmtFull } = Util;

  const App = {
    mode: null,             // 'host' | 'guest' | 'solo'
    role: null,
    myName: '',
    myId: null,
    targetRoomId: null,

    config: {
      gameType: 'holdem',
      stack: 1000,
      sb: 5, bb: 10,
      bjBank: 500, bjMin: 10, bjMax: 200,
      bjDealer: 'bot',
      persist: 'fresh',
      timer: 30,
    },
    seatedPlayers: [],
    started: false,

    gameState: null,
    handHistory: [],
    lastStacks: {},
    rebuyRequests: [],  // host-side queue: [{playerId, name, requestedAmount, ts}]
  };

  // ============ THEME ============
  function initTheme() {
    const saved = Util.Store.get('theme', null);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

    $('#theme-toggle').addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        Util.Store.set('theme', 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        Util.Store.set('theme', 'dark');
      }
    });
  }

  // ============ LANDING ============
  function initLanding() {
    const lastName = Util.Store.get('lastName');
    if (lastName) $('#host-name').value = lastName;

    $$('.game-pick').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.game-pick').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        App.config.gameType = btn.dataset.game;
        $('#btn-solo').style.display = btn.dataset.game === 'blackjack' ? '' : 'none';
      });
    });

    $('#btn-create-room').addEventListener('click', async () => {
      const name = $('#host-name').value.trim();
      if (!name) { Util.toast('Enter your name first', 'error'); return; }
      App.myName = name;
      Util.Store.set('lastName', name);
      try { await hostStart(); }
      catch (e) { Util.toast('Failed to start: ' + (e.message || e), 'error'); console.error(e); }
    });

    $('#btn-solo').addEventListener('click', () => {
      const name = $('#host-name').value.trim();
      if (!name) { Util.toast('Enter your name first', 'error'); return; }
      App.myName = name;
      Util.Store.set('lastName', name);
      startSolo();
    });

    $('#btn-join-form').addEventListener('click', () => show('join'));
    $('#btn-stats').addEventListener('click', () => openStats());

    $$('.back-btn').forEach(b => b.addEventListener('click', () => show(b.dataset.back)));

    $('#btn-join-room').addEventListener('click', async () => {
      const name = $('#guest-name').value.trim();
      if (!name) { Util.toast('Enter your name first', 'error'); return; }
      App.myName = name;
      Util.Store.set('lastName', name);
      try { await guestJoin(); }
      catch (e) {
        $('#join-status').textContent = e.message || 'Failed to join';
        $('#join-status').classList.add('error');
        console.error(e);
      }
    });

    $$('.stats-tab').forEach(t => t.addEventListener('click', () => {
      $$('.stats-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      UI.renderStats(t.dataset.tab);
    }));
    $('#btn-reset-stats').addEventListener('click', () => {
      if (confirm('Reset all statistics? This cannot be undone.')) {
        Stats.reset();
        UI.renderStats($('.stats-tab.active').dataset.tab);
        Util.toast('Stats reset', 'success');
      }
    });
  }

  function openStats() {
    show('stats');
    UI.renderStats('all');
    $$('.stats-tab').forEach(x => x.classList.remove('active'));
    $('.stats-tab[data-tab="all"]').classList.add('active');
  }

  // ============ SOLO ============
  function startSolo() {
    App.mode = 'solo';
    App.role = 'admin';
    App.myId = Util.uuid();
    App.config.gameType = 'blackjack';
    App.config.bjDealer = 'bot';
    App.seatedPlayers = [{ id: App.myId, name: App.myName }];
    startGame();
  }

  function updateDealerDropdown() {
    const sel = $('#cfg-bj-dealer');
    if (!sel) return;
    const current = App.config.bjDealer || 'bot';
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: 'bot', text: 'House bot (auto)' }));
    App.seatedPlayers.forEach(p => {
      sel.appendChild(el('option', { value: p.id, text: p.name + (p.id === App.myId ? ' (you)' : '') }));
    });
    sel.value = current;
  }

  // ============ HOST ============
  async function hostStart() {
    App.mode = 'host';
    App.role = 'admin';
    $('#btn-create-room').disabled = true;
    $('#btn-create-room').textContent = 'Starting…';

    Network.setHandlers({
      onConnectionChange: handleHostConnectionChange,
      onMessage: handleHostMessage,
      onError: t => Util.toast('Network: ' + t, 'error')
    });

    const roomId = await Network.host();
    App.myId = Network.getPlayerId();
    App.seatedPlayers = [{ id: App.myId, name: App.myName }];

    show('lobby');
    setupLobby(roomId);
  }

  function handleHostConnectionChange(evt) {
    if (evt.type === 'join') {
      if (!App.seatedPlayers.find(p => p.id === evt.playerId)) {
        App.seatedPlayers.push({ id: evt.playerId, name: evt.name });
      }
      Network.sendToPlayer(evt.playerId, {
        type: 'welcome',
        roomConfig: App.config,
        players: App.seatedPlayers,
        hostId: App.myId,
        gameStarted: App.started,
        chatHistory: Chat.getMessages(),
      });
      broadcastLobby();
      if (App.started && App.gameState) sendStateTo(evt.playerId);
      Util.toast(`${evt.name} joined`, 'success');
      if (App.started) hostBroadcastSystemChat(`${evt.name} joined the table`);
    } else if (evt.type === 'leave') {
      const wasIn = App.seatedPlayers.find(p => p.id === evt.playerId);
      App.seatedPlayers = App.seatedPlayers.filter(p => p.id !== evt.playerId);
      if (App.started && App.gameState) {
        const p = App.gameState.players.find(pp => pp.id === evt.playerId);
        if (p) {
          p.sittingOut = true;
          if (App.gameState.type !== 'blackjack' && App.gameState.activeIdx >= 0 && App.gameState.players[App.gameState.activeIdx]?.id === evt.playerId) {
            Holdem.applyAction(App.gameState, evt.playerId, { type: 'fold' });
          }
          broadcastState();
        }
      }
      broadcastLobby();
      if (wasIn) {
        Util.toast(`${wasIn.name} left`, '');
        if (App.started) hostBroadcastSystemChat(`${wasIn.name} left the table`);
      }
      // Drop any pending rebuy request from this player
      if (App.rebuyRequests.length > 0) {
        const before = App.rebuyRequests.length;
        App.rebuyRequests = App.rebuyRequests.filter(r => r.playerId !== evt.playerId);
        if (App.rebuyRequests.length !== before) {
          updateRebuyBadge();
          // If the modal was showing this player's request, close it
          if ($('#rebuy-approval-modal').classList.contains('open')) {
            $('#rebuy-approval-modal').classList.remove('open');
            setTimeout(showNextRebuyApproval, 200);
          }
        }
      }
    }
  }

  function handleHostMessage(msg) {
    if (msg.type === 'action') handlePlayerAction(msg.playerId, msg.action);
    else if (msg.type === 'chat-send') {
      const sender = App.seatedPlayers.find(p => p.id === msg.playerId);
      const name = sender ? sender.name : 'Unknown';
      const accepted = Chat.hostAddPlayerMessage(msg.playerId, name, msg.text);
      if (accepted) {
        Network.broadcast({ type: 'chat-msg', message: accepted });
        // Update host's own UI
        hostUiOnNewChat(accepted);
      } else {
        Network.sendToPlayer(msg.playerId, { type: 'toast', text: 'Message rate-limited or empty', kind: 'error' });
      }
    }
    else if (msg.type === 'rebuy-request') {
      handleRebuyRequest(msg.playerId, msg.amount);
    }
  }

  // Host helpers for chat
  function hostBroadcastSystemChat(text) {
    const sysMsg = {
      id: 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
      playerId: null, name: 'system', text, ts: Date.now(), system: true,
    };
    Chat.pushMessage(sysMsg);
    Network.broadcast({ type: 'chat-msg', message: sysMsg });
    hostUiOnNewChat(sysMsg);
  }

  function hostUiOnNewChat(msg) {
    if (isChatOpen()) {
      UI.appendChatMessage(msg, App.myId);
    } else if (msg.system || msg.playerId !== App.myId) {
      Chat.bumpUnread();
      UI.updateChatBadge(Chat.getUnread());
    }
  }

  function broadcastLobby() {
    Network.broadcast({
      type: 'lobby',
      players: App.seatedPlayers,
      hostId: App.myId,
      roomConfig: App.config,
    });
    if (!App.started) {
      UI.renderLobbyPlayers(App.seatedPlayers, App.myId, App.config.bjDealer);
      updateStartButton();
      updateDealerDropdown();
    }
  }

  // ============ GUEST ============
  async function guestJoin() {
    App.mode = 'guest';
    App.role = 'player';
    App.targetRoomId = parseRoomFromHash();
    if (!App.targetRoomId) throw new Error('Invalid invite link.');
    $('#btn-join-room').disabled = true;
    $('#btn-join-room').textContent = 'Connecting…';
    $('#join-status').textContent = '';

    Network.setHandlers({
      onConnectionChange: handleGuestConnectionChange,
      onMessage: handleGuestMessage,
    });

    await Network.join(App.targetRoomId, { name: App.myName });
    App.myId = Network.getPlayerId();
  }

  function handleGuestConnectionChange(evt) {
    if (evt.type === 'host-disconnected') {
      Util.toast('Host disconnected. Game ended.', 'error');
      setTimeout(() => { location.hash = ''; location.reload(); }, 1800);
    }
  }

  function handleGuestMessage(msg) {
    if (msg.type === 'welcome') {
      App.config = msg.roomConfig;
      App.seatedPlayers = msg.players;
      if (msg.chatHistory) Chat.setHistory(msg.chatHistory);
      if (!msg.gameStarted) {
        show('lobby');
        setupLobby(App.targetRoomId, true);
        UI.renderLobbyPlayers(App.seatedPlayers, msg.hostId, App.config.bjDealer);
      }
    } else if (msg.type === 'lobby') {
      App.seatedPlayers = msg.players;
      App.config = msg.roomConfig;
      if (!App.started) UI.renderLobbyPlayers(App.seatedPlayers, msg.hostId, App.config.bjDealer);
    } else if (msg.type === 'state') {
      const isFirstState = !App.started;
      App.started = true;
      App.gameState = msg.state;
      if (msg.history) App.handHistory = msg.history;
      enterGameScreen();
      renderGame();
      if (isFirstState) {
        captureLastStacks();
        Stats.recordSession(App.gameState.type);
      } else {
        recordStatsIfHandEnded();
      }
      captureLastStacks();
    } else if (msg.type === 'chat-msg') {
      receiveChatMessage(msg.message);
    } else if (msg.type === 'rebuy-response') {
      handleRebuyResponse(msg);
    } else if (msg.type === 'kicked') {
      Util.toast('You were removed from the table', 'error');
      setTimeout(() => location.reload(), 1500);
    } else if (msg.type === 'end-game') {
      Util.toast('Game ended by host', '');
      setTimeout(() => location.reload(), 1500);
    } else if (msg.type === 'toast') {
      Util.toast(msg.text, msg.kind || '');
    }
  }

  // ============ LOBBY ============
  function setupLobby(roomId, asGuest = false) {
    const link = location.origin + location.pathname + '#room=' + roomId;
    $('#invite-link').value = link;
    $('#room-code-display').textContent = roomId.replace(/^tilt-/, '').toUpperCase();

    $('#btn-copy-link').onclick = () => {
      navigator.clipboard.writeText(link).then(() => {
        $('#copied-toast').classList.add('show');
        setTimeout(() => $('#copied-toast').classList.remove('show'), 1800);
      }).catch(() => Util.toast('Copy failed — long-press the link', 'error'));
    };

    const settingsPanel = $('#settings-panel');
    settingsPanel.querySelectorAll('input, select, button').forEach(e => { if (asGuest) e.disabled = true; });

    $('#cfg-game').value = App.config.gameType;
    $('#cfg-stack').value = App.config.stack;
    $('#cfg-sb').value = App.config.sb;
    $('#cfg-bb').value = App.config.bb;
    $('#cfg-bj-bank').value = App.config.bjBank;
    $('#cfg-bj-min').value = App.config.bjMin;
    $('#cfg-bj-max').value = App.config.bjMax;
    $('#cfg-persist').value = App.config.persist;
    $('#cfg-timer').value = App.config.timer;

    function updateGameSpecific() {
      const isBJ = $('#cfg-game').value === 'blackjack';
      $$('.poker-only').forEach(e => e.style.display = isBJ ? 'none' : '');
      $$('.blackjack-only').forEach(e => e.style.display = isBJ ? '' : 'none');
    }
    updateGameSpecific();
    updateDealerDropdown();

    if (!asGuest) {
      ['cfg-game','cfg-stack','cfg-sb','cfg-bb','cfg-bj-bank','cfg-bj-min','cfg-bj-max','cfg-bj-dealer','cfg-persist','cfg-timer'].forEach(id => {
        const elNode = $('#' + id);
        if (!elNode) return;
        elNode.addEventListener('change', () => {
          App.config.gameType = $('#cfg-game').value;
          App.config.stack    = +$('#cfg-stack').value;
          App.config.sb       = +$('#cfg-sb').value;
          App.config.bb       = +$('#cfg-bb').value;
          App.config.bjBank   = +$('#cfg-bj-bank').value;
          App.config.bjMin    = +$('#cfg-bj-min').value;
          App.config.bjMax    = +$('#cfg-bj-max').value;
          App.config.bjDealer = $('#cfg-bj-dealer').value;
          App.config.persist  = $('#cfg-persist').value;
          App.config.timer    = +$('#cfg-timer').value;
          updateGameSpecific();
          broadcastLobby();
        });
      });

      $('#btn-start-game').addEventListener('click', () => startGame());
    }

    UI.renderLobbyPlayers(App.seatedPlayers, asGuest ? null : App.myId, App.config.bjDealer);
    updateStartButton();
  }

  function updateStartButton() {
    const btn = $('#btn-start-game');
    const hint = $('#start-hint');
    if (!btn) return;
    // For blackjack with bot dealer, 1 player is fine. Otherwise need 2.
    const minPlayers = (App.config.gameType === 'blackjack' && App.config.bjDealer === 'bot') ? 1 : 2;
    if (App.seatedPlayers.length < minPlayers) {
      btn.disabled = true;
      hint.textContent = minPlayers === 1 ? 'Add yourself…' : 'Waiting for at least one more player…';
    } else {
      btn.disabled = false;
      hint.textContent = `${App.seatedPlayers.length} player${App.seatedPlayers.length > 1 ? 's' : ''} ready. Deal anytime.`;
    }
  }

  // ============ GAME START ============
  function startGame() {
    const isSolo = App.mode === 'solo';
    if (!isSolo && App.mode !== 'host') return;
    if (!isSolo && App.seatedPlayers.length < 2 && !(App.config.gameType === 'blackjack' && App.config.bjDealer === 'bot' && App.seatedPlayers.length >= 1)) {
      Util.toast('Need at least 2 players', 'error'); return;
    }

    const persisted = App.config.persist === 'persist' ? loadPersistedBalances() : {};

    if (App.config.gameType === 'blackjack') {
      const dealerId = App.config.bjDealer || 'bot';
      const dealerName = dealerId === 'bot' ? 'House' : (App.seatedPlayers.find(p => p.id === dealerId)?.name || 'Dealer');
      App.gameState = Blackjack.create({
        players: App.seatedPlayers.map(p => ({
          id: p.id, name: p.name,
          stack: persisted[p.id] ?? App.config.bjBank
        })),
        minBet: App.config.bjMin,
        maxBet: App.config.bjMax,
        dealerId,
        dealerName,
      });
      Blackjack.startBettingRound(App.gameState);
    } else {
      App.gameState = Holdem.create({
        gameType: App.config.gameType,
        players: App.seatedPlayers.map(p => ({
          id: p.id, name: p.name,
          stack: persisted[p.id] ?? App.config.stack
        })),
        sb: App.config.sb,
        bb: App.config.bb,
      });
      Holdem.startHand(App.gameState);
    }

    App.started = true;
    App.handHistory = [];
    if (!isSolo) broadcastState();
    enterGameScreen();
    renderGame();
    captureLastStacks();
    Stats.recordSession(App.gameState.type);
    persistBalancesIfNeeded();
  }

  function enterGameScreen() {
    show('game');
    UI.renderHeader(App.gameState);

    $('#btn-leave').onclick = () => {
      const msg = App.mode === 'solo' ? 'Leave game?' :
                  App.mode === 'host' ? 'End the game and return to landing?' : 'Leave this table?';
      if (confirm(msg)) {
        if (App.mode !== 'solo') Network.disconnect();
        location.hash = '';
        location.reload();
      }
    };
    $('#btn-game-settings').onclick = openSettingsDrawer;
    $('#btn-hand-history').onclick = openHistoryDrawer;
    $('#btn-close-drawer').onclick = () => closeDrawer('settings-drawer');
    $('#btn-close-history').onclick = () => closeDrawer('history-drawer');
    $$('.drawer-backdrop').forEach(b => b.onclick = () => b.parentElement.classList.remove('open'));

    // Chat — show only in multiplayer
    const chatBtn = $('#btn-chat');
    if (App.mode === 'solo') {
      chatBtn.style.display = 'none';
    } else {
      chatBtn.style.display = '';
      chatBtn.onclick = openChatDrawer;
      $('#btn-close-chat').onclick = () => closeDrawer('chat-drawer');
      $('#chat-send').onclick = sendChatFromInput;
      const input = $('#chat-input');
      input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChatFromInput();
        }
      };
    }

    // Rebuy modals
    $('#btn-rebuy-cancel').onclick = closeRebuyRequestModal;
    $('#btn-close-rebuy').onclick = closeRebuyRequestModal;
    $('#btn-rebuy-submit').onclick = submitRebuyRequest;
    $('#rebuy-amount').onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitRebuyRequest(); }
    };
    // Host approval modal
    $('#btn-rebuy-approve').onclick = approveRebuy;
    $('#btn-rebuy-reject').onclick = rejectRebuy;
    $('#rebuy-approval-amount').onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); approveRebuy(); }
    };
    // Click backdrop to dismiss (player-side only — host should explicitly act)
    document.querySelectorAll('#rebuy-modal .modal-backdrop').forEach(b => {
      b.onclick = closeRebuyRequestModal;
    });
  }

  // ============ CHAT ============
  function openChatDrawer() {
    $('#chat-drawer').classList.add('open');
    Chat.clearUnread();
    UI.updateChatBadge(0);
    UI.renderChat(Chat.getMessages(), App.myId);
    setTimeout(() => $('#chat-input').focus(), 50);
  }

  function isChatOpen() {
    return $('#chat-drawer').classList.contains('open');
  }

  function sendChatFromInput() {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (App.mode === 'host') {
      // Host: add directly
      const me = App.seatedPlayers.find(p => p.id === App.myId);
      const accepted = Chat.hostAddPlayerMessage(App.myId, me ? me.name : App.myName, text);
      if (accepted) {
        Network.broadcast({ type: 'chat-msg', message: accepted });
        UI.appendChatMessage(accepted, App.myId);
      } else {
        Util.toast('Slow down — too many messages', 'error');
      }
    } else {
      // Guest: send to host
      Network.sendToHost({ type: 'chat-send', text });
    }
  }

  function receiveChatMessage(msg) {
    if (!msg) return;
    Chat.pushMessage(msg);
    if (isChatOpen()) {
      UI.appendChatMessage(msg, App.myId);
    } else if (!msg.system || msg.playerId !== App.myId) {
      Chat.bumpUnread();
      UI.updateChatBadge(Chat.getUnread());
    }
  }

  // ============ REBUY ============

  // Open the rebuy request modal (shown to the busted player)
  function openRebuyRequestModal() {
    const modal = $('#rebuy-modal');
    const input = $('#rebuy-amount');
    const isBlackjack = App.gameState && App.gameState.type === 'blackjack';
    const defaultAmount = isBlackjack
      ? (App.config.bjBank || 500)
      : (App.config.stack || 1000);
    input.value = defaultAmount;

    const intro = $('#rebuy-modal-intro');
    if (App.mode === 'solo') {
      intro.textContent = 'Restore your chips and keep playing.';
      $('#btn-rebuy-submit').textContent = 'Rebuy';
    } else {
      intro.textContent = 'Send a request to the host to rejoin the table with chips. They can approve or modify the amount.';
      $('#btn-rebuy-submit').textContent = 'Send request';
    }

    modal.classList.add('open');
    setTimeout(() => { input.focus(); input.select(); }, 60);
  }

  function closeRebuyRequestModal() {
    $('#rebuy-modal').classList.remove('open');
  }

  function submitRebuyRequest() {
    const amount = Math.floor(+$('#rebuy-amount').value);
    if (!Number.isFinite(amount) || amount <= 0) {
      Util.toast('Enter a valid amount', 'error');
      return;
    }
    closeRebuyRequestModal();
    if (App.mode === 'solo') {
      // Self-approve
      doRebuy(App.myId, amount);
      renderGame();
      Util.toast(`Bought back in with ${Util.fmt ? Util.fmt(amount) : amount} chips`, 'success');
    } else if (App.mode === 'host') {
      // Host requesting their own rebuy — just do it
      doRebuy(App.myId, amount);
      broadcastState();
      renderGame();
      Util.toast(`Rebought ${amount}`, 'success');
    } else {
      // Guest — send to host
      Network.sendToHost({ type: 'rebuy-request', amount });
      Util.toast('Request sent to host', 'success');
    }
  }

  // Host-side: a guest sent a rebuy request
  function handleRebuyRequest(playerId, requestedAmount) {
    if (!App.gameState) return;
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > 1_000_000_000) {
      Network.sendToPlayer(playerId, { type: 'toast', text: 'Invalid amount', kind: 'error' });
      return;
    }
    const player = App.gameState.players.find(p => p.id === playerId);
    if (!player) {
      Network.sendToPlayer(playerId, { type: 'toast', text: 'Not at the table', kind: 'error' });
      return;
    }
    const requested = Math.floor(requestedAmount);
    // Replace any existing pending request from this player
    App.rebuyRequests = App.rebuyRequests.filter(r => r.playerId !== playerId);
    App.rebuyRequests.push({
      playerId,
      name: player.name,
      requestedAmount: requested,
      ts: Date.now(),
    });
    // Update the badge on settings icon
    updateRebuyBadge();
    // If no popup is currently showing, show one for this request
    if (!$('#rebuy-approval-modal').classList.contains('open')) {
      showNextRebuyApproval();
    }
    Util.toast(`${player.name} wants to buy back in (${requested})`, '');
  }

  function showNextRebuyApproval() {
    if (App.rebuyRequests.length === 0) return;
    const req = App.rebuyRequests[0];
    const modal = $('#rebuy-approval-modal');
    $('#rebuy-approval-intro').textContent = `${req.name} requests ${req.requestedAmount} chips.`;
    $('#rebuy-approval-amount').value = req.requestedAmount;
    modal.classList.add('open');
    setTimeout(() => $('#rebuy-approval-amount').focus(), 60);
  }

  function approveRebuy() {
    if (App.rebuyRequests.length === 0) return;
    const req = App.rebuyRequests.shift();
    const amount = Math.floor(+$('#rebuy-approval-amount').value);
    if (!Number.isFinite(amount) || amount <= 0) {
      Util.toast('Enter a valid amount', 'error');
      App.rebuyRequests.unshift(req); // put it back
      return;
    }
    const ok = doRebuy(req.playerId, amount);
    $('#rebuy-approval-modal').classList.remove('open');
    if (ok) {
      broadcastState();
      renderGame();
      Network.sendToPlayer(req.playerId, {
        type: 'rebuy-response',
        approved: true,
        amount,
      });
      Util.toast(`Approved ${req.name} with ${amount}`, 'success');
      // Also a system chat message
      hostBroadcastSystemChat(`${req.name} bought back in for ${amount}`);
    } else {
      Util.toast('Rebuy failed', 'error');
    }
    updateRebuyBadge();
    // If more requests pending, show the next one
    setTimeout(showNextRebuyApproval, 300);
  }

  function rejectRebuy() {
    if (App.rebuyRequests.length === 0) return;
    const req = App.rebuyRequests.shift();
    $('#rebuy-approval-modal').classList.remove('open');
    Network.sendToPlayer(req.playerId, {
      type: 'rebuy-response',
      approved: false,
    });
    Util.toast(`Rejected ${req.name}`, '');
    updateRebuyBadge();
    setTimeout(showNextRebuyApproval, 300);
  }

  // Performs the actual rebuy on game state. Returns true on success.
  function doRebuy(playerId, amount) {
    if (!App.gameState) return false;
    const fn = App.gameState.type === 'blackjack' ? Blackjack.rebuyPlayer : Holdem.rebuyPlayer;
    const r = fn(App.gameState, playerId, amount);
    if (!r.ok) return false;
    if (App.mode !== 'host' && App.mode !== 'solo') return true; // guests stop here

    if (App.gameState.type === 'blackjack') {
      if (App.gameState.phase === 'idle' || App.gameState.phase === 'settled') {
        Blackjack.startBettingRound(App.gameState);
      }
    } else {
      // Hold'em / PLO: if the table is idle (waiting for enough players), start a hand
      if (App.gameState.street === 'idle') {
        const playable = App.gameState.players.filter(p => p.stack > 0 && !p.sittingOut);
        if (playable.length >= 2) {
          Holdem.startHand(App.gameState);
        }
      }
    }
    return true;
  }

  // Expose for UI button callbacks
  window.AppRebuy = { open: openRebuyRequestModal };

  // Guest receives a response from host
  function handleRebuyResponse(msg) {
    if (msg.approved) {
      Util.toast(`Buy-back approved with ${msg.amount} chips`, 'success');
    } else {
      Util.toast('Buy-back request rejected', 'error');
    }
  }

  function updateRebuyBadge() {
    const badge = $('#rebuy-badge');
    if (!badge) return;
    const count = App.rebuyRequests.length;
    if (count > 0) {
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  function openSettingsDrawer() {
    UI.renderAdminDrawer(
      App.gameState,
      App.mode === 'host' || App.mode === 'solo',
      App.seatedPlayers,
      {
        rebuyRequests: App.rebuyRequests.slice(),
        reviewRebuy: (playerId) => {
          // Bring this request to the front and open the approval modal
          const idx = App.rebuyRequests.findIndex(r => r.playerId === playerId);
          if (idx > 0) {
            const r = App.rebuyRequests.splice(idx, 1)[0];
            App.rebuyRequests.unshift(r);
          }
          closeDrawer('settings-drawer');
          showNextRebuyApproval();
        },
        startHand: hostStartNextHand,
        kick: id => {
          if (App.mode === 'solo') return;
          Network.kickPlayer(id);
          App.seatedPlayers = App.seatedPlayers.filter(p => p.id !== id);
          if (App.gameState) {
            const p = App.gameState.players.find(pp => pp.id === id);
            if (p) p.sittingOut = true;
          }
          broadcastState();
          broadcastLobby();
          closeDrawer('settings-drawer');
        },
        adjustStack: (id, delta) => {
          if (!App.gameState) return;
          const p = App.gameState.players.find(pp => pp.id === id);
          if (p) { p.stack = Math.max(0, p.stack + delta); if (App.mode !== 'solo') broadcastState(); persistBalancesIfNeeded(); openSettingsDrawer(); }
        },
        adjustBankroll: (id, delta) => {
          if (!App.gameState) return;
          const p = App.gameState.players.find(pp => pp.id === id);
          if (p) { p.bankroll = Math.max(0, p.bankroll + delta); if (App.mode !== 'solo') broadcastState(); persistBalancesIfNeeded(); openSettingsDrawer(); }
        },
        setBlinds: (sb, bb) => {
          if (!App.gameState) return;
          App.gameState.sb = sb; App.gameState.bb = bb;
          App.config.sb = sb; App.config.bb = bb;
          if (App.mode !== 'solo') broadcastState();
          Util.toast(`Blinds set to ${sb}/${bb}`, 'success');
        },
        endGame: () => {
          if (App.mode !== 'solo') Network.broadcast({ type: 'end-game' });
          Util.Store.remove('balances-' + (Network.getRoomId() || 'solo'));
          setTimeout(() => location.reload(), 600);
        }
      }
    );
    $('#settings-drawer').classList.add('open');
  }

  function openHistoryDrawer() {
    UI.renderHistory(App.handHistory);
    $('#history-drawer').classList.add('open');
  }
  function closeDrawer(id) { document.getElementById(id).classList.remove('open'); }

  // ============ NEXT HAND ============
  function hostStartNextHand() {
    if (!(App.mode === 'host' || App.mode === 'solo') || !App.gameState) return;
    if (App.gameState.lastResult) recordHistory(App.gameState);

    if (App.gameState.type === 'blackjack') Blackjack.startBettingRound(App.gameState);
    else Holdem.startHand(App.gameState);

    captureLastStacks();
    if (App.mode !== 'solo') broadcastState();
    renderGame();
    closeDrawer('settings-drawer');
    persistBalancesIfNeeded();
  }

  function recordHistory(state) {
    const result = state.lastResult;
    if (!result) return;
    if (state.type === 'blackjack') {
      App.handHistory.push({
        handNumber: result.handNumber,
        summary: `Dealer ${result.dealerTotal}`,
        details: result.results.map(r => {
          const p = state.players.find(pp => pp.id === r.id);
          return `${p?.name}: ${r.outcome} (${r.netChange >= 0 ? '+' : ''}${r.netChange})`;
        }).join(' · '),
        cards: result.dealerHand,
      });
    } else {
      const winnerNames = (result.results[0]?.winners || []).map(id => state.players.find(p => p.id === id)?.name).join(', ');
      const cat = result.results[0]?.category || '';
      App.handHistory.push({
        handNumber: result.handNumber,
        summary: `${winnerNames} won ${fmtFull(result.results.reduce((s,r) => s + r.potAmount, 0))}`,
        details: cat,
        cards: result.board,
      });
    }
    if (App.handHistory.length > 50) App.handHistory.shift();
  }

  // ============ ACTIONS ============
  function handlePlayerAction(playerId, action) {
    if (!App.gameState) return;

    // === Run-it voting action ===
    if (action && action.type === 'runit-vote') {
      if (App.gameState.type === 'blackjack') return; // ignore
      const r = Holdem.submitRunitVote(App.gameState, playerId, action.count);
      if (!r.ok) {
        if (App.mode === 'solo' || playerId === App.myId) {
          Util.toast(r.error, 'error');
        } else {
          Network.sendToPlayer(playerId, { type: 'toast', text: r.error, kind: 'error' });
        }
        return;
      }
      if (App.mode !== 'solo') broadcastState();
      renderGame();
      if (r.finalized && App.gameState.runitPhase === 'running') {
        // Voting just resolved — start the animation
        runAllInAnimation();
      }
      return;
    }

    let result;
    if (App.gameState.type === 'blackjack') {
      result = Blackjack.applyAction(App.gameState, playerId, action);
    } else {
      result = Holdem.applyAction(App.gameState, playerId, action);
    }
    if (!result.ok) {
      if (App.mode === 'solo' || playerId === App.myId) {
        Util.toast(result.error, 'error');
      } else {
        Network.sendToPlayer(playerId, { type: 'toast', text: result.error, kind: 'error' });
      }
      return;
    }

    if (App.mode !== 'solo') broadcastState();
    renderGame();
    recordStatsIfHandEnded();
    persistBalancesIfNeeded();
    captureLastStacks();

    // All-in: if entered voting phase, just wait for votes.
    // If voting auto-resolved to 1 (single voter), runitPhase is now 'running' and we animate.
    if (App.gameState.type !== 'blackjack' && App.gameState.pendingRunout) {
      if (App.gameState.runitPhase === 'running') {
        runAllInAnimation();
      }
      // else: waiting for votes — UI will show the picker
      return;
    }

    if (App.gameState.type === 'blackjack' && App.gameState.phase === 'settled') {
      setTimeout(() => {
        if (App.gameState && App.gameState.phase === 'settled') {
          recordHistory(App.gameState);
          Blackjack.startBettingRound(App.gameState);
          captureLastStacks();
          if (App.mode !== 'solo') broadcastState();
          renderGame();
        }
      }, 3500);
    } else if (App.gameState.street === 'showdown') {
      setTimeout(() => {
        if (App.gameState && App.gameState.street === 'showdown') {
          recordHistory(App.gameState);
          const playable = App.gameState.players.filter(p => p.stack > 0 && !p.sittingOut);
          if (playable.length >= 2) {
            Holdem.startHand(App.gameState);
            captureLastStacks();
            if (App.mode !== 'solo') broadcastState();
            renderGame();
          } else {
            // Not enough players with chips. Transition to idle so busted
            // players see the rebuy button (and the table waits for someone
            // to rebuy or join).
            App.gameState.street = 'idle';
            App.gameState.players.forEach(p => {
              if ((p.stack || 0) <= 0) p.sittingOut = true;
            });
            if (App.mode !== 'solo') broadcastState();
            renderGame();
          }
        }
      }, 4000);
    }
  }

  function sendAction(action) {
    if (App.mode === 'host' || App.mode === 'solo') handlePlayerAction(App.myId, action);
    else Network.sendToHost({ type: 'action', action });
  }

  // ============ ALL-IN ANIMATION ============
  // Step through remaining streets with a delay between each so players can
  // watch each card hit the board. Supports multi-runout: deals each board
  // in sequence with the river card revealed extra-slow for drama.
  function runAllInAnimation() {
    if (!App.gameState || !App.gameState.pendingRunout) return;

    const DELAY_BEFORE = 1800;     // initial pause to show hole cards + equities
    const DELAY_BETWEEN = 1800;    // between flop -> turn or board -> next-board start
    const DELAY_RIVER = 2800;      // extra suspenseful pause before river reveal
    const DELAY_AFTER_RIVER = 1200; // brief pause after river before moving on

    const isMulti = () => App.gameState && App.gameState.runitCount > 1;

    const renderAndBroadcast = () => {
      if (App.mode !== 'solo') broadcastState();
      renderGame();
    };

    // Deal cards on the currently-active board until it reaches 5 cards.
    // Calls onDone() when the board is complete.
    const dealOnCurrentBoard = (onDone) => {
      if (!App.gameState || !App.gameState.pendingRunout) { onDone(); return; }
      const curBoard = isMulti()
        ? App.gameState.runitBoards[App.gameState.runitActiveIdx]
        : App.gameState.board;
      const len = curBoard.length;
      if (len >= 5) { onDone(); return; }

      // Longer pause before the river for drama
      const isAboutToDealRiver = (len === 4);
      const delay = isAboutToDealRiver ? DELAY_RIVER : DELAY_BETWEEN;

      setTimeout(() => {
        if (!App.gameState || !App.gameState.pendingRunout) { onDone(); return; }
        if (isMulti()) Holdem.dealNextStreetMulti(App.gameState);
        else Holdem.dealNextStreet(App.gameState);
        renderAndBroadcast();
        const newLen = (isMulti()
          ? App.gameState.runitBoards[App.gameState.runitActiveIdx]
          : App.gameState.board).length;
        if (newLen < 5) {
          dealOnCurrentBoard(onDone);
        } else {
          // River just dealt — small pause before continuing
          setTimeout(onDone, DELAY_AFTER_RIVER);
        }
      }, delay);
    };

    const finalizeHand = () => {
      if (!App.gameState) return;
      App.gameState.pendingRunout = false;
      Holdem.finishHand(App.gameState);
      renderAndBroadcast();
      recordStatsIfHandEnded();
      persistBalancesIfNeeded();
      captureLastStacks();
      scheduleNextHandIfNeeded();
    };

    // Iterative driver — deal each board to completion, advance to next, finalize.
    const driveBoards = () => {
      const stepBoard = () => {
        if (!App.gameState || !App.gameState.pendingRunout) return;
        dealOnCurrentBoard(() => {
          if (!App.gameState) return;
          if (isMulti() && App.gameState.runitActiveIdx < App.gameState.runitCount - 1) {
            Holdem.advanceRunitBoard(App.gameState);
            renderAndBroadcast();
            setTimeout(stepBoard, DELAY_BETWEEN);
          } else {
            setTimeout(finalizeHand, DELAY_AFTER_RIVER);
          }
        });
      };
      stepBoard();
    };

    setTimeout(driveBoards, DELAY_BEFORE);
  }

  function scheduleNextHandIfNeeded() {
    if (!App.gameState) return;
    if (App.gameState.street === 'showdown') {
      setTimeout(() => {
        if (App.gameState && App.gameState.street === 'showdown') {
          recordHistory(App.gameState);
          const playable = App.gameState.players.filter(p => p.stack > 0 && !p.sittingOut);
          if (playable.length >= 2) {
            Holdem.startHand(App.gameState);
            captureLastStacks();
            if (App.mode !== 'solo') broadcastState();
            renderGame();
          } else {
            App.gameState.street = 'idle';
            App.gameState.players.forEach(p => {
              if ((p.stack || 0) <= 0) p.sittingOut = true;
            });
            if (App.mode !== 'solo') broadcastState();
            renderGame();
          }
        }
      }, 4000);
    }
  }

  // ============ STATS RECORDING ============
  function captureLastStacks() {
    if (!App.gameState) return;
    const stacks = {};
    App.gameState.players.forEach(p => { stacks[p.id] = p.stack ?? p.bankroll; });
    App.lastStacks = stacks;
  }

  function recordStatsIfHandEnded() {
    if (!App.gameState) return;
    if (App.gameState.type === 'blackjack') {
      if (App.gameState.phase === 'settled' && App.gameState.lastResult) {
        const myResult = App.gameState.lastResult.results.find(r => r.id === App.myId);
        if (myResult && !myResult._statRecorded) {
          myResult._statRecorded = true;
          Stats.recordBlackjackHand({
            outcome: myResult.outcome,
            bet: myResult.bet,
            netChange: myResult.netChange,
            doubled: myResult.doubled,
          });
        }
      }
    } else {
      if (App.gameState.street === 'showdown' && App.gameState.lastResult && !App.gameState.lastResult._statRecorded) {
        App.gameState.lastResult._statRecorded = true;
        const myResult = App.gameState.players.find(p => p.id === App.myId);
        if (!myResult) return;
        const myStackBefore = App.lastStacks[App.myId] || 0;
        const myStackNow    = myResult.stack ?? 0;
        const netChange     = myStackNow - myStackBefore;
        const won           = netChange > 0;
        const folded        = myResult.folded;
        const potSize       = App.gameState.lastResult.results.reduce((s,r) => s + r.potAmount, 0);
        const showdown      = !folded && !!App.gameState.lastResult.results[0]?.category;
        const desc          = (App.gameState.lastResult.results[0]?.category) || (folded ? 'Folded' : '');
        Stats.recordPokerHand(App.gameState.type, { won, folded, showdown, potSize, netChange, desc });
      }
    }
  }

  // ============ STATE BROADCAST ============
  function broadcastState() {
    if (App.mode !== 'host' || !App.gameState) return;
    for (const player of App.seatedPlayers) {
      if (player.id === App.myId) continue;
      sendStateTo(player.id);
    }
  }

  function sendStateTo(playerId) {
    if (!App.gameState) return;
    const sanitize = App.gameState.type === 'blackjack' ? Blackjack.sanitizeFor : Holdem.sanitizeFor;
    Network.sendToPlayer(playerId, {
      type: 'state',
      state: sanitize(App.gameState, playerId),
      history: App.handHistory
    });
  }

  // ============ RENDER ============
  function renderGame() {
    if (!App.gameState) return;
    UI.renderHeader(App.gameState);
    const isAuthority = App.mode === 'host' || App.mode === 'solo';
    if (App.gameState.type === 'blackjack') {
      const stateToRender = isAuthority ? Blackjack.sanitizeFor(App.gameState, App.myId) : App.gameState;
      UI.renderBlackjackTable(stateToRender, App.myId);
      UI.renderBlackjackActions(stateToRender, App.myId, sendAction);
    } else {
      const stateToRender = isAuthority ? Holdem.sanitizeFor(App.gameState, App.myId) : App.gameState;
      UI.renderPokerTable(stateToRender, App.myId);
      UI.renderPokerActions(stateToRender, App.myId, sendAction);
    }
    updateShortcutContext();
  }

  function updateShortcutContext() {
    if (!App.gameState) { Shortcuts.setContext('idle'); return; }
    if (App.gameState.type === 'blackjack') {
      const me = App.gameState.players.find(p => p.id === App.myId);
      const isMyTurn = App.gameState.players[App.gameState.activeIdx]?.id === App.myId;
      if (App.gameState.phase === 'betting' && me?.status === 'betting') Shortcuts.setContext('blackjack-bet');
      else if (App.gameState.phase === 'playing' && isMyTurn) Shortcuts.setContext('blackjack-turn');
      else if (App.gameState.phase === 'dealer' && App.myId === App.gameState.dealer.id) Shortcuts.setContext('blackjack-dealer');
      else Shortcuts.setContext('game-idle');
    } else {
      // Poker (Hold'em / PLO)
      const me = App.gameState.players.find(p => p.id === App.myId);
      // Run-it voting context
      if (App.gameState.runitPhase === 'voting') {
        const isEligibleVoter = me && !me.folded && !me.sittingOut && me.totalBet > 0;
        const myVote = App.gameState.runitVotes && App.gameState.runitVotes[App.myId];
        if (isEligibleVoter && !myVote) {
          Shortcuts.setContext('runit-voting');
          return;
        }
      }
      const isMyTurn = App.gameState.players[App.gameState.activeIdx]?.id === App.myId;
      if (App.gameState.street !== 'idle' && App.gameState.street !== 'showdown' && isMyTurn) Shortcuts.setContext('poker-turn');
      else Shortcuts.setContext('game-idle');
    }
  }

  // ============ PERSISTENCE ============
  function persistKey() { return 'balances-' + (Network.getRoomId() || 'solo'); }
  function loadPersistedBalances() {
    if (App.config.persist !== 'persist') return {};
    return Util.Store.get(persistKey(), {});
  }
  function persistBalancesIfNeeded() {
    if (App.config.persist !== 'persist' || !App.gameState) return;
    const balances = {};
    App.gameState.players.forEach(p => { balances[p.id] = p.stack ?? p.bankroll; });
    Util.Store.set(persistKey(), balances);
  }

  // ============ SHORTCUTS ============
  function initShortcuts() {
    Shortcuts.init();

    const gameContexts = ['poker-turn','blackjack-turn','blackjack-bet','blackjack-dealer','game-idle'];

    // POKER: F = fold, C = check/call, R = raise, A = all-in, 1/2/3 = presets
    Shortcuts.register('f', ['poker-turn'], () => window.PokerKeys?.fold?.());
    Shortcuts.register('c', ['poker-turn'], () => window.PokerKeys?.checkOrCall?.());
    Shortcuts.register('r', ['poker-turn'], () => window.PokerKeys?.raise?.());
    Shortcuts.register('a', ['poker-turn'], () => window.PokerKeys?.allin?.());
    Shortcuts.register('1', ['poker-turn'], () => window.PokerKeys?.half?.());
    Shortcuts.register('2', ['poker-turn'], () => window.PokerKeys?.pot?.());
    Shortcuts.register('3', ['poker-turn'], () => window.PokerKeys?.max?.());

    // RUN-IT VOTING: 1-4 to pick how many times
    Shortcuts.register('1', ['runit-voting'], () => window.PokerKeys?.runitVote1?.());
    Shortcuts.register('2', ['runit-voting'], () => window.PokerKeys?.runitVote2?.());
    Shortcuts.register('3', ['runit-voting'], () => window.PokerKeys?.runitVote3?.());
    Shortcuts.register('4', ['runit-voting'], () => window.PokerKeys?.runitVote4?.());

    // BLACKJACK: H = hit, S = stand, D = double, B = focus bet input
    Shortcuts.register('h', ['blackjack-turn','blackjack-dealer'], () => window.BlackjackKeys?.hit?.());
    Shortcuts.register('s', ['blackjack-turn','blackjack-dealer'], () => window.BlackjackKeys?.stand?.());
    Shortcuts.register('d', ['blackjack-turn'], () => window.BlackjackKeys?.double?.());
    Shortcuts.register('b', ['blackjack-bet'], () => window.BlackjackKeys?.bet?.());

    // GLOBAL (any in-game context): M = chat, ? = history, , = settings
    Shortcuts.register('m', gameContexts, () => {
      const btn = $('#btn-chat');
      if (btn && btn.style.display !== 'none') {
        if (isChatOpen()) closeDrawer('chat-drawer');
        else openChatDrawer();
      }
    });
    Shortcuts.register('?', gameContexts, () => toggleDrawer('history-drawer', openHistoryDrawer));
    Shortcuts.register('/', gameContexts, () => toggleDrawer('history-drawer', openHistoryDrawer)); // alias since ? requires shift
    Shortcuts.register(',', gameContexts, () => toggleDrawer('settings-drawer', openSettingsDrawer));

    // Escape — close any open drawer, also blur inputs
    Shortcuts.register('escape', ['*'], (e) => {
      const drawers = $$('.drawer.open');
      if (drawers.length > 0) {
        drawers.forEach(d => d.classList.remove('open'));
        return; // preventDefault
      }
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
        return;
      }
      return false; // don't preventDefault if nothing to do
    });
  }

  function toggleDrawer(id, openFn) {
    const d = document.getElementById(id);
    if (d.classList.contains('open')) d.classList.remove('open');
    else openFn();
  }
  function parseRoomFromHash() {
    const m = location.hash.match(/room=([\w-]+)/);
    return m ? m[1] : null;
  }

  function init() {
    initTheme();
    initLanding();
    initShortcuts();
    initConnectionSettings();
    $('#btn-solo').style.display = App.config.gameType === 'blackjack' ? '' : 'none';
    const roomId = parseRoomFromHash();
    if (roomId) {
      App.targetRoomId = roomId;
      show('join');
      $('#join-host-info').textContent = `Joining room ${roomId.replace(/^tilt-/, '').toUpperCase()}…`;
      const lastName = Util.Store.get('lastName');
      if (lastName) $('#guest-name').value = lastName;
    }
  }

  function initConnectionSettings() {
    const modal       = $('#connection-settings-modal');
    const triggerBtn  = $('#btn-open-connection-settings');
    const closeBtn    = $('#btn-close-connection-settings');
    const appInput    = $('#metered-app');
    const keyInput    = $('#metered-key');
    const saveBtn     = $('#btn-save-connection-settings');
    const testBtn     = $('#btn-test-connection');
    const clearBtn    = $('#btn-clear-connection-settings');
    const result      = $('#connection-test-result');
    const modalStatus = $('#conn-modal-status');
    const triggerStatus = $('#conn-trigger-status');

    if (!modal || !triggerBtn || !appInput || !keyInput) {
      console.warn('Connection settings: required elements missing');
      return;
    }

    const defaultApp = (typeof Network !== 'undefined' && Network.DEFAULT_METERED_APP) || 'tiltpoker';

    function updateStatusPills() {
      const hasKey = !!(Util.Store.get('meteredKey'));
      const text = hasKey ? 'Relay enabled' : 'Relay disabled';
      if (modalStatus) {
        modalStatus.textContent = text;
        modalStatus.classList.toggle('on', hasKey);
      }
      if (triggerStatus) {
        triggerStatus.textContent = hasKey ? 'On' : 'Off';
        triggerStatus.classList.toggle('on', hasKey);
      }
    }

    function setResult(text, kind) {
      if (!result) return;
      result.textContent = text || '';
      result.className = (kind === 'success') ? 'modal-helper success'
                       : (kind === 'error')   ? 'modal-helper error'
                       : 'modal-helper';
    }

    function fillFields() {
      appInput.value = Util.Store.get('meteredApp') || defaultApp;
      keyInput.value = Util.Store.get('meteredKey') || '';
      setResult('');
    }

    function openModal() {
      fillFields();
      updateStatusPills();
      modal.classList.add('open');
      setTimeout(() => keyInput.focus(), 60);
    }

    function closeModal() {
      modal.classList.remove('open');
    }

    function handleSave() {
      const app = (appInput.value || '').trim();
      const key = (keyInput.value || '').trim();
      if (app) Util.Store.set('meteredApp', app); else Util.Store.remove('meteredApp');
      if (key) Util.Store.set('meteredKey', key); else Util.Store.remove('meteredKey');
      const enabled = !!(key && app);
      setResult(enabled ? 'Saved — relay enabled.' : 'Saved — relay disabled (STUN only).', 'success');
      updateStatusPills();
      Util.toast(enabled ? 'Relay enabled' : 'Saved', 'success');
    }

    function handleClear() {
      Util.Store.remove('meteredApp');
      Util.Store.remove('meteredKey');
      appInput.value = defaultApp;
      keyInput.value = '';
      setResult('Cleared.');
      updateStatusPills();
    }

    async function handleTest() {
      const app = (appInput.value || '').trim();
      const rawKey = (keyInput.value || '').trim();
      const key = (Network && Network.resolveKey) ? Network.resolveKey(rawKey) : rawKey;
      if (!app || !rawKey) {
        setResult('Enter both subdomain and key to test.', 'error');
        return;
      }
      setResult('Testing…');
      try {
        const url = 'https://' + app + '.metered.live/api/v1/turn/credentials?apiKey=' + encodeURIComponent(key);
        const res = await fetch(url);
        if (!res.ok) {
          setResult('Failed: ' + res.status + ' ' + res.statusText + '. Check subdomain and key.', 'error');
          return;
        }
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setResult('OK — ' + data.length + ' relay servers available. Click Save.', 'success');
        } else {
          setResult('Got a response, but no servers returned.', 'error');
        }
      } catch (e) {
        setResult('Network error: ' + (e && e.message ? e.message : e), 'error');
      }
    }

    // Wire everything with addEventListener (more robust than onclick)
    triggerBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    document.querySelectorAll('#connection-settings-modal .modal-backdrop').forEach(b => {
      b.addEventListener('click', closeModal);
    });
    saveBtn.addEventListener('click', handleSave);
    testBtn.addEventListener('click', handleTest);
    clearBtn.addEventListener('click', handleClear);

    // Initialize the visible status pill at load
    updateStatusPills();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
