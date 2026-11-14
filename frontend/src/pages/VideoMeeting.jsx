import { lazy, Suspense } from "react";
import { useParams } from "react-router-dom";
import { livekitUrl } from "../meeting/config";
import { NOT_CONFIGURED } from "../meeting/messages";
import { useMeetingRoom } from "../meeting/useMeetingRoom";
import { Users, Video } from "lucide-react";
import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Spinner from "../components/ui/Spinner";

const InCall = lazy(() => import("../meeting/InCall"));

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
      <PageHeader title="Video Meeting">
        <p role="status" aria-live="polite" className={`small meeting-status meeting-status--${configured ? phase : "off"}`}>
          <span className="meeting-status__dot" aria-hidden="true" />
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
            <Suspense fallback={<div className="meeting-loading"><Spinner label="Starting the call…" /></div>}>
              <InCall room={room} onLeave={leave} onProblem={(text) => text && setNotice(text)} />
            </Suspense>
          ) : (
            <div className="card meeting-lobby motion-rise-in">
              <span className="meeting-lobby__icon" aria-hidden="true"><Users size={26} /></span>
              <h2 className="meeting-lobby__title">{phase === "left" ? "You left the meeting" : "Ready to join?"}</h2>
              <p className="muted meeting-lobby__text">
                Everyone in this project can join. Your browser will ask to use your camera and microphone.
              </p>
              <Button size="lg" onClick={join} loading={phase === "joining"} icon={<Video size={17} aria-hidden="true" />}>
                {phase === "joining" ? "Joining…" : phase === "left" || error ? "Join again" : "Join meeting"}
              </Button>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

export default VideoMeeting;
