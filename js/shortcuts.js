/* ============================================================
   SHORTCUTS — Keyboard shortcuts, context-aware
   - Respects input focus (won't fire while typing in chat/inputs)
   - Honors event.repeat=false so holding a key doesn't spam
   - Bindings are registered by name; the active context is set
     by the app (poker-turn, blackjack-turn, blackjack-bet, idle).
   ============================================================ */

const Shortcuts = (() => {

  const handlers = {};       // key -> { action, contexts: Set }
  let currentContext = 'idle';
  let enabled = true;

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function onKey(e) {
    if (!enabled) return;
    if (e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Allow Escape & Enter even when typing — they're meaningful there
    const key = normalizeKey(e);
    const allowWhileTyping = key === 'escape' || key === 'enter';
    if (!allowWhileTyping && isTypingTarget(document.activeElement)) return;

    const binding = handlers[key];
    if (!binding) return;
    if (binding.contexts && !binding.contexts.has(currentContext) && !binding.contexts.has('*')) return;

    const result = binding.action(e);
    if (result !== false) e.preventDefault();
  }

  function normalizeKey(e) {
    // For letters, use lowercase. For others, use the key as-is.
    if (e.key.length === 1) return e.key.toLowerCase();
    return e.key.toLowerCase();
  }

  /**
   * Register a shortcut.
   * @param key       Single character or special name ('escape', 'enter', '/', '?', ',')
   * @param contexts  Array of context names, or ['*'] for always.
   * @param action    Function. Return false to NOT preventDefault.
   */
  function register(key, contexts, action) {
    handlers[key.toLowerCase()] = {
      action,
      contexts: new Set(contexts),
    };
  }

  function setContext(ctx) {
    currentContext = ctx;
  }

  function getContext() { return currentContext; }

  function enable()  { enabled = true; }
  function disable() { enabled = false; }

  function init() {
    document.addEventListener('keydown', onKey);
  }

  return { init, register, setContext, getContext, enable, disable };
})();
