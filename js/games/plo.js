/* ============================================================
   PLO — Pot-Limit Omaha
   Shares engine with Hold'em; the engine branches on state.type.
   Differences handled in engine:
     - 4 hole cards instead of 2
     - Hand evaluation: must use exactly 2 hole + 3 board (HandEval.evalOmaha)
     - Pot-limit raise cap
   ============================================================ */
const PLO = {
  create: (config) => Holdem.create({ ...config, gameType: 'plo' }),
};
