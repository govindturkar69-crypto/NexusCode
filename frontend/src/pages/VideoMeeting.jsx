import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { socketUrl } from "../api/client";
import { createMeetingSession } from "../meeting/session";
import BackLink from "../components/ui/BackLink";
import Button from "../components/ui/Button";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";

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
    <Page width={1000}>
      <BackLink to={`/projects/${projectId}`}>Leave meeting</BackLink>
      <PageHeader eyebrow={`video-meeting --project ${projectId}`} title="Video Meeting" tone="success">
        <p role="status" aria-live="polite" className={`small ${peerConnected ? "text-success" : errorText ? "text-danger" : "muted"}`} style={{ marginTop: "0.5rem" }}>
          {statusText}
        </p>
      </PageHeader>

      <div className="split" style={{ marginBottom: "1.5rem" }}>
        <figure style={{ margin: 0 }}>
          <figcaption className="muted small" style={{ marginBottom: "0.5rem" }}>
            You{!micOn && " (muted)"}{!cameraOn && " (camera off)"}
          </figcaption>
          <video ref={localVideoRef} autoPlay muted playsInline className="video" />
        </figure>
        <figure style={{ margin: 0 }}>
          <figcaption className="muted small" style={{ marginBottom: "0.5rem" }}>
            {peerConnected ? "Peer" : "Waiting for peer..."}
          </figcaption>
          <video ref={remoteVideoRef} autoPlay playsInline className="video" style={{ opacity: peerConnected ? 1 : 0.3 }} />
        </figure>
      </div>

      <div className="row">
        <Button variant="ghost" onClick={toggleMic} aria-pressed={!micOn}>
          🎤 {micOn ? "Mute mic" : "Unmute mic"}
        </Button>
        <Button variant="ghost" onClick={toggleCamera} aria-pressed={!cameraOn}>
          📹 {cameraOn ? "Turn camera off" : "Turn camera on"}
        </Button>
        <Button variant="danger-solid" onClick={leave}>📵 Leave</Button>
      </div>
    </Page>
  );
}

export default VideoMeeting;
