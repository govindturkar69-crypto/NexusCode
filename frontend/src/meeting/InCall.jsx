import { RoomContext } from "@livekit/components-react";
import MeetingStage from "./MeetingStage";

// The call once joined. Loaded lazily with the LiveKit components, so the
// meeting lobby doesn't wait for them.
function InCall({ room, onLeave, onProblem }) {
  return (
    <RoomContext.Provider value={room}>
      <MeetingStage onLeave={onLeave} onProblem={onProblem} />
    </RoomContext.Provider>
  );
}

export default InCall;
