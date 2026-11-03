import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { socketUrl } from "../api/client";
import { createMeetingSession } from "../meeting/session";

// Google's free STUN servers — help browsers find their public IP
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const STATUS_TEXT = {
  camera: "Starting camera...",
  connecting: "Connecting to the meeting room...",
  waiting: "Waiting for someone to join...",
  "peer-joining": "Someone joined. Connecting...",
  calling: "Calling...",
  connected: "Connected! 🎉",
  "peer-lost": "The connection to the other person was lost.",
  "room-full": "This meeting already has two people.",
  disconnected: "Disconnected from the meeting server. Refresh the page to rejoin.",
  error: "Something went wrong with the call. Refresh the page to try again.",
};

function VideoMeeting() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("camera");
  const [errorText, setErrorText] = useState("");
  const [peerConnected, setPeerConnected] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  useEffect(() => {
    // `cancelled` guards every await: React StrictMode mounts, unmounts and
    // remounts in development, and the first run must not leave a camera
    // stream or socket behind.
    let cancelled = false;
    let stream = null;
    let session = null;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) return;
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        setStatus("connecting");

        const url = await socketUrl(`/ws/projects/${projectId}/meeting`, projectId);
        if (cancelled) return;
        session = createMeetingSession({
          stream,
          socket: new WebSocket(url),
          createPeerConnection: () => new RTCPeerConnection(ICE_SERVERS),
          onStatus: setStatus,
          onRemoteStream: (remote) => {
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
            setPeerConnected(Boolean(remote));
          },
        });
      } catch (err) {
        if (!cancelled) setErrorText(err.message);
      }
    }

    start();
    return () => {
      cancelled = true;
      session?.close();
      // Turns the camera light off
      stream?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    };
  }, [projectId]);

  function toggleMic() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }

  function toggleCamera() {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOn(track.enabled);
  }

  // Unmounting runs the effect cleanup, which ends the call
  const leave = () => navigate(`/projects/${projectId}`);
  const statusText = errorText ? `Error: ${errorText}` : STATUS_TEXT[status] ?? status;

  return (
    <div style={{ minHeight: "100vh", background: "#0D1117", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <button onClick={leave} style={backButtonStyle}>
          ← Leave meeting
        </button>

        <div style={{ margin: "1rem 0 1.5rem" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", color: "#7EE787", marginBottom: "0.3rem" }}>
            $ video-meeting --project {projectId}
          </div>
          <h1 style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E6EDF3", fontSize: "22px", margin: 0, fontWeight: 600 }}>
            Video Meeting
          </h1>
          <p role="status" style={{ color: peerConnected ? "#7EE787" : errorText ? "#F85149" : "#8B949E", fontSize: "13px", marginTop: "0.5rem" }}>
            {statusText}
          </p>
        </div>

        <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <p style={{ color: "#8B949E", fontSize: "12px", marginBottom: "0.5rem" }}>
              You{!micOn && " (muted)"}{!cameraOn && " (camera off)"}
            </p>
            <video ref={localVideoRef} autoPlay muted playsInline style={videoStyle} />
          </div>
          <div style={{ flex: 1, position: "relative" }}>
            <p style={{ color: "#8B949E", fontSize: "12px", marginBottom: "0.5rem" }}>
              {peerConnected ? "Peer" : "Waiting for peer..."}
            </p>
            <video ref={remoteVideoRef} autoPlay playsInline style={{ ...videoStyle, opacity: peerConnected ? 1 : 0.3 }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button onClick={toggleMic} aria-pressed={!micOn} style={controlButtonStyle}>
            🎤 {micOn ? "Mute mic" : "Unmute mic"}
          </button>
          <button onClick={toggleCamera} aria-pressed={!cameraOn} style={controlButtonStyle}>
            📹 {cameraOn ? "Turn camera off" : "Turn camera on"}
          </button>
          <button onClick={leave} style={{ ...controlButtonStyle, background: "#F85149", color: "white", border: "none" }}>
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
