// Node has no WebRTC: the host never gets a PeerJS id, so every guest has to use the relay.
export class Peer {
  open = false;
  destroyed = false;
  disconnected = false;
  on() {
    return this;
  }
  reconnect() {}
  destroy() {
    this.destroyed = true;
  }
}
