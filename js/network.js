/* ============================================================
   NETWORK — PeerJS-based P2P layer
   - Host creates a Peer with a known room ID
   - Guests connect to host's peer ID
   - Host is authority: relays state to guests, validates actions
   - Messages: { type, ...payload }
       guest -> host: 'join', 'leave', 'action', 'chat'
       host -> guest: 'welcome', 'state', 'kicked', 'chat', 'lobby'
       host -> all guests: 'broadcast' wrapping any of above
   ============================================================ */

const Network = (() => {

  let peer = null;
  let isHost = false;
  let roomId = null;
  let conns = new Map();   // For host: peerConnId -> { conn, playerId, name }
  let hostConn = null;     // For guest: connection to host
  let myPlayerId = null;
  let onMessage = () => {};
  let onConnectionChange = () => {};
  let onError = () => {};

  function genRoomId() {
    return 'tilt-' + Util.genId(6).toLowerCase();
  }

  /**
   * Start hosting. Returns promise resolving to roomId.
   */
  function host() {
    return new Promise((resolve, reject) => {
      isHost = true;
      roomId = genRoomId();
      myPlayerId = Util.uuid();

      peer = new Peer(roomId, {
        debug: 1,
      });

      peer.on('open', id => {
        resolve(id);
      });

      peer.on('connection', conn => {
        conn.on('open', () => {
          conns.set(conn.peer, { conn, playerId: null, name: null });
        });
        conn.on('data', msg => {
          handleHostMessage(conn, msg);
        });
        conn.on('close', () => {
          const meta = conns.get(conn.peer);
          conns.delete(conn.peer);
          if (meta && meta.playerId) {
            onConnectionChange({ type: 'leave', playerId: meta.playerId });
          }
        });
        conn.on('error', e => {
          console.warn('conn error', e);
        });
      });

      peer.on('error', err => {
        console.error('peer error', err);
        if (err.type === 'unavailable-id') {
          // re-try with new ID
          peer.destroy();
          roomId = genRoomId();
          peer = new Peer(roomId, { debug: 1 });
          peer.on('open', id => resolve(id));
          peer.on('connection', c => peer.emit('connection', c));
          return;
        }
        if (err.type === 'network' || err.type === 'server-error' || err.type === 'browser-incompatible') {
          onError(err.type);
        }
        if (!peer.open) reject(err);
      });

      peer.on('disconnected', () => {
        // try to reconnect to signaling server
        try { peer.reconnect(); } catch {}
      });
    });
  }

  /**
   * Join a host by their room ID.
   */
  function join(targetRoomId, joinPayload) {
    return new Promise((resolve, reject) => {
      isHost = false;
      myPlayerId = Util.uuid();

      peer = new Peer({ debug: 1 });

      peer.on('open', () => {
        hostConn = peer.connect(targetRoomId, { reliable: true });
        let connected = false;

        const timeout = setTimeout(() => {
          if (!connected) reject(new Error('Connection timed out — is the host online?'));
        }, 12000);

        hostConn.on('open', () => {
          connected = true;
          clearTimeout(timeout);
          roomId = targetRoomId;
          // send join message
          hostConn.send({ type: 'join', playerId: myPlayerId, ...joinPayload });
          resolve();
        });
        hostConn.on('data', msg => {
          handleGuestMessage(msg);
        });
        hostConn.on('close', () => {
          onConnectionChange({ type: 'host-disconnected' });
        });
        hostConn.on('error', e => {
          if (!connected) { clearTimeout(timeout); reject(e); }
        });
      });

      peer.on('error', err => {
        if (err.type === 'peer-unavailable') reject(new Error('Room not found — check the link.'));
        else reject(err);
      });
    });
  }

  function handleHostMessage(conn, msg) {
    const meta = conns.get(conn.peer);
    if (!meta) return;
    if (msg.type === 'join') {
      meta.playerId = msg.playerId;
      meta.name = msg.name;
      onConnectionChange({ type: 'join', playerId: msg.playerId, name: msg.name, conn });
      return;
    }
    if (msg.type === 'action') {
      onMessage({ ...msg, playerId: meta.playerId, from: conn.peer });
      return;
    }
    if (msg.type === 'chat') {
      onMessage({ type: 'chat', text: msg.text, playerId: meta.playerId });
      return;
    }
  }

  function handleGuestMessage(msg) {
    onMessage(msg);
  }

  /**
   * Host sends to all guests.
   */
  function broadcast(msg) {
    for (const { conn } of conns.values()) {
      try { conn.send(msg); } catch (e) { console.warn(e); }
    }
  }

  /**
   * Host sends to specific guest by player ID.
   */
  function sendToPlayer(playerId, msg) {
    for (const { conn, playerId: pid } of conns.values()) {
      if (pid === playerId) {
        try { conn.send(msg); } catch (e) { console.warn(e); }
        return;
      }
    }
  }

  /**
   * Guest sends to host.
   */
  function sendToHost(msg) {
    if (hostConn && hostConn.open) hostConn.send(msg);
  }

  function kickPlayer(playerId) {
    for (const [peerId, meta] of conns.entries()) {
      if (meta.playerId === playerId) {
        try { meta.conn.send({ type: 'kicked' }); } catch {}
        setTimeout(() => { try { meta.conn.close(); } catch {} conns.delete(peerId); }, 500);
        return;
      }
    }
  }

  function disconnect() {
    if (peer) { try { peer.destroy(); } catch {} }
    peer = null; conns.clear(); hostConn = null;
  }

  function getRoomId()    { return roomId; }
  function getPlayerId()  { return myPlayerId; }
  function isHosting()    { return isHost; }
  function getPeerCount() { return conns.size; }

  return {
    host, join, disconnect,
    broadcast, sendToPlayer, sendToHost,
    kickPlayer,
    getRoomId, getPlayerId, isHosting, getPeerCount,
    setHandlers(opts) {
      if (opts.onMessage) onMessage = opts.onMessage;
      if (opts.onConnectionChange) onConnectionChange = opts.onConnectionChange;
      if (opts.onError) onError = opts.onError;
    }
  };
})();
