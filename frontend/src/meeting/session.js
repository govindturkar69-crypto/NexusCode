// WebRTC signalling for a 1:1 meeting. The server decides roles: the peer
// that joins second gets {type: "role", initiator: true} and makes the offer,
// so the two sides never offer at the same time.
//
// Messages are handled strictly one at a time (a promise queue), so an ICE
// candidate can't be applied while an offer is still being processed, and
// candidates that arrive before the remote description are queued.

const OPEN = 1; // WebSocket.OPEN

export function createMeetingSession({ stream, socket, createPeerConnection, onStatus, onRemoteStream }) {
  let pc = null;
  let pendingCandidates = [];
  let closed = false;
  let queue = Promise.resolve();

  function send(message) {
    // Only ever send on an open socket (the old code could send while CONNECTING)
    if (socket.readyState === OPEN) socket.send(JSON.stringify(message));
  }

  function resetPeer() {
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    pc = null;
    pendingCandidates = [];
    onRemoteStream(null);
  }

  function newPeer() {
    resetPeer();
    const peer = createPeerConnection();
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        const candidate = typeof event.candidate.toJSON === "function" ? event.candidate.toJSON() : event.candidate;
        send({ type: "ice-candidate", candidate });
      }
    };
    peer.ontrack = (event) => {
      onRemoteStream(event.streams[0]);
      onStatus("connected");
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "disconnected") onStatus("peer-lost");
    };
    pc = peer;
    return peer;
  }

  async function applyQueuedCandidates() {
    const queued = pendingCandidates;
    pendingCandidates = [];
    for (const candidate of queued) await pc.addIceCandidate(candidate);
  }

  async function handle(message) {
    switch (message.type) {
      case "role":
        if (message.initiator) {
          const peer = newPeer();
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          send({ type: "offer", sdp: offer.sdp });
          onStatus("calling");
        } else {
          onStatus("waiting");
        }
        break;
      case "peer-joined":
        onStatus("peer-joining");
        break;
      case "offer": {
        const peer = newPeer();
        await peer.setRemoteDescription({ type: "offer", sdp: message.sdp });
        await applyQueuedCandidates();
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        send({ type: "answer", sdp: answer.sdp });
        break;
      }
      case "answer":
        if (pc && !pc.remoteDescription) {
          await pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
          await applyQueuedCandidates();
        }
        break;
      case "ice-candidate":
        if (pc && pc.remoteDescription) await pc.addIceCandidate(message.candidate);
        else pendingCandidates.push(message.candidate);
        break;
      case "peer-left":
        resetPeer();
        onStatus("waiting");
        break;
      case "room-full":
        onStatus("room-full");
        break;
      default:
        break;
    }
  }

  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    queue = queue
      .then(() => (closed ? undefined : handle(message)))
      .catch(() => onStatus("error"));
  };
  socket.onclose = () => {
    if (!closed) onStatus("disconnected");
  };

  return {
    // Exposed for tests: wait for every message handled so far
    idle: () => queue,
    close() {
      closed = true;
      socket.onmessage = null;
      socket.onclose = null;
      resetPeer();
      socket.close();
    },
  };
}
