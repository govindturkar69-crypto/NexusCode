import { useParams } from "react-router-dom";
import { RoomContext } from "@livekit/components-react";
import { livekitUrl } from "../meeting/config";
import MeetingStage from "../meeting/MeetingStage";
import { NOT_CONFIGURED } from "../meeting/messages";
import { useMeetingRoom } from "../meeting/useMeetingRoom";
import Alert from "../components/ui/Alert";
import BackLink from "../components/ui/BackLink";
import Button from "../components/ui/Button";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";

const STATUS = {
  idle: "Not in the meeting.",
  joining: "Joining…",
  connected: "Connected",
  reconnecting: "Connection lost. Reconnecting…",
  left: "You left the meeting.",
};

function VideoMeeting() {
  const { projectId } = useParams();
  const { phase, room, error, notice, join, leave, setNotice, clearNotice } = useMeetingRoom(projectId);
  const configured = Boolean(livekitUrl());
  const inCall = Boolean(room) && (phase === "connected" || phase === "reconnecting");

  return (
    <Page width={1100}>
      <BackLink to={`/projects/${projectId}`}>Back to the project</BackLink>
      <PageHeader eyebrow={`video-meeting --project ${projectId}`} title="Video Meeting" tone="success">
        <p
          role="status"
          aria-live="polite"
          className={`small ${phase === "connected" ? "text-success" : phase === "reconnecting" ? "text-danger" : "muted"}`}
          style={{ marginTop: "0.5rem" }}
        >
          {configured ? STATUS[phase] : NOT_CONFIGURED}
        </p>
      </PageHeader>

      {!configured ? (
        <Alert tone="info">
          Video meetings are turned off here. An administrator needs to set the LiveKit settings (see docs/DEPLOY.md).
        </Alert>
      ) : (
        <>
          <Alert>{error}</Alert>
          <Alert tone="info" onDismiss={clearNotice}>{notice}</Alert>

          {inCall ? (
            <RoomContext.Provider value={room}>
              <MeetingStage onLeave={leave} onProblem={(text) => text && setNotice(text)} />
            </RoomContext.Provider>
          ) : (
            <div className="card" style={{ marginTop: "1rem" }}>
              <p className="muted" style={{ marginTop: 0 }}>
                Everyone in this project can join. Your browser will ask to use your camera and microphone.
              </p>
              <Button onClick={join} disabled={phase === "joining"}>
                {phase === "joining" ? "Joining…" : phase === "left" || error ? "📹 Join again" : "📹 Join meeting"}
              </Button>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

export default VideoMeeting;
