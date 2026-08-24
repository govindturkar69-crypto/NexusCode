import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL;
const WS_URL = API_URL.replace("http", "ws");

// Google's free STUN servers — help browsers find their public IP
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

function VideoMeeting() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("Connecting...");
  const [peerConnected, setPeerConnected] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const wsRef = useRef(null);
  const localStreamRef = useRef(null);

  useEffect(() => {
    startMeeting();
    return () => cleanup();
  }, []);

  async function startMeeting() {
    try {
      // Step 1: get camera + microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setStatus("Camera ready. Waiting for someone to join...");

      // Step 2: connect to signaling server
      const ws = new WebSocket(`${WS_URL}/ws/projects/${projectId}/meeting`);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("Connected to meeting room. Waiting for peer...");
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "offer") {
          // Someone else initiated — we need to answer
          await handleOffer(data, stream);
        } else if (data.type === "answer") {
          // They answered our offer
          await peerConnectionRef.current?.setRemoteDescription(
            new RTCSessionDescription(data)
          );
        } else if (data.type === "ice-candidate") {
          // Add their ICE candidate to our connection
          await peerConnectionRef.current?.addIceCandidate(
            new RTCIceCandidate(data.candidate)
          );
        }
      };

      // Step 3: create peer connection and send an offer
      // (whoever joins first becomes the "caller")
      const pc = createPeerConnection(ws, stream);
      peerConnectionRef.current = pc;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));

    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  function createPeerConnection(ws, stream) {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Add our local video/audio tracks to the connection
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    // When we discover our own ICE candidates, send them to the peer
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        ws.send(JSON.stringify({
          type: "ice-candidate",
          candidate: event.candidate,
        }));
      }
    };

    // When we receive the peer's video/audio stream
    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
        setPeerConnected(true);
        setStatus("Connected! 🎉");
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setPeerConnected(false);
        setStatus("Peer disconnected.");
      }
    };

    return pc;
  }

  async function handleOffer(offer, stream) {
    const pc = createPeerConnection(wsRef.current, stream);
    peerConnectionRef.current = pc;

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    wsRef.current.send(JSON.stringify({ type: "answer", sdp: answer.sdp }));
  }

  function cleanup() {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    peerConnectionRef.current?.close();
    wsRef.current?.close();
  }

  function toggleAudio() {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = !audioTrack.enabled;
  }

  function toggleVideo() {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) videoTrack.enabled = !videoTrack.enabled;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0D1117", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <button onClick={() => { cleanup(); navigate(`/projects/${projectId}`); }} style={backButtonStyle}>
          ← Leave meeting
        </button>

        <div style={{ margin: "1rem 0 1.5rem" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", color: "#7EE787", marginBottom: "0.3rem" }}>
            $ video-meeting --project {projectId}
          </div>
          <h1 style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E6EDF3", fontSize: "22px", margin: 0, fontWeight: 600 }}>
            Video Meeting
          </h1>
          <p style={{ color: peerConnected ? "#7EE787" : "#8B949E", fontSize: "13px", marginTop: "0.5rem" }}>
            {status}
          </p>
        </div>

        <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <p style={{ color: "#8B949E", fontSize: "12px", marginBottom: "0.5rem" }}>You</p>
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              style={videoStyle}
            />
          </div>
          <div style={{ flex: 1, position: "relative" }}>
            <p style={{ color: "#8B949E", fontSize: "12px", marginBottom: "0.5rem" }}>
              {peerConnected ? "Peer" : "Waiting for peer..."}
            </p>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{ ...videoStyle, opacity: peerConnected ? 1 : 0.3 }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button onClick={toggleAudio} style={controlButtonStyle}>
            🎤 Toggle Mic
          </button>
          <button onClick={toggleVideo} style={controlButtonStyle}>
            📹 Toggle Camera
          </button>
          <button onClick={() => { cleanup(); navigate(`/projects/${projectId}`); }} style={{ ...controlButtonStyle, background: "#F85149", color: "white", border: "none" }}>
            📵 Leave
          </button>
        </div>
      </div>
    </div>
  );
}

const backButtonStyle = {
  padding: "0",
  background: "transparent",
  color: "#58A6FF",
  border: "none",
  fontSize: "13px",
  cursor: "pointer",
};

const videoStyle = {
  width: "100%",
  borderRadius: "10px",
  background: "#161B22",
  border: "1px solid #30363D",
  minHeight: "300px",
};

const controlButtonStyle = {
  padding: "10px 16px",
  background: "#161B22",
  color: "#E6EDF3",
  border: "1px solid #30363D",
  borderRadius: "6px",
  fontSize: "13px",
  cursor: "pointer",
};

export default VideoMeeting;