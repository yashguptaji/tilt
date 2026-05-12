/* ============================================================
   CHAT — Table chat (host-authoritative, ephemeral per-session)
   - Host maintains canonical message log
   - Clients receive 'chat-history' on join, 'chat-msg' per new message
   - Rate-limited and length-capped at the host
   ============================================================ */

const Chat = (() => {

  const MAX_MESSAGES   = 100;
  const MAX_MSG_LENGTH = 500;
  const RATE_WINDOW_MS = 5000;
  const RATE_MAX       = 10;     // messages per window per player

  const state = {
    messages: [],          // [{id, playerId, name, text, ts, system}]
    rateByPlayer: {},      // playerId -> array of timestamps
    unread: 0,
    onUpdate: null,
  };

  function reset() {
    state.messages = [];
    state.rateByPlayer = {};
    state.unread = 0;
  }

  /**
   * Host-side: validate and add a chat message from a player.
   * Returns the message object if accepted, or null if dropped.
   */
  function hostAddPlayerMessage(playerId, name, rawText) {
    if (typeof rawText !== 'string') return null;
    const text = rawText.trim().slice(0, MAX_MSG_LENGTH);
    if (!text) return null;

    // Rate limit
    const now = Date.now();
    const recent = (state.rateByPlayer[playerId] || []).filter(t => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) return null;
    recent.push(now);
    state.rateByPlayer[playerId] = recent;

    const msg = {
      id: 'm-' + now + '-' + Math.random().toString(36).slice(2, 8),
      playerId, name, text, ts: now, system: false,
    };
    pushMessage(msg);
    return msg;
  }

  /**
   * Host or client: push a system message (e.g. "Alice joined").
   */
  function pushSystemMessage(text) {
    const msg = {
      id: 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      playerId: null, name: 'system', text, ts: Date.now(), system: true,
    };
    pushMessage(msg);
    return msg;
  }

  /**
   * Append a message (validated upstream), trimming to MAX_MESSAGES.
   */
  function pushMessage(msg) {
    state.messages.push(msg);
    if (state.messages.length > MAX_MESSAGES) {
      state.messages = state.messages.slice(-MAX_MESSAGES);
    }
    if (state.onUpdate) state.onUpdate(msg);
  }

  /**
   * Client-side: replace history (e.g. on welcome).
   */
  function setHistory(messages) {
    state.messages = (messages || []).slice(-MAX_MESSAGES);
    if (state.onUpdate) state.onUpdate(null);
  }

  function getMessages() { return state.messages; }

  function bumpUnread() { state.unread++; }
  function clearUnread() { state.unread = 0; }
  function getUnread()   { return state.unread; }

  function setOnUpdate(fn) { state.onUpdate = fn; }

  return {
    reset,
    hostAddPlayerMessage,
    pushSystemMessage,
    pushMessage,
    setHistory,
    getMessages,
    bumpUnread, clearUnread, getUnread,
    setOnUpdate,
    MAX_MSG_LENGTH,
  };
})();
