import { useEffect, useEffectEvent } from "react";
import { useSearchParams } from "react-router-dom";

// Pages run a one-off action asked for in the URL (?do=new-task), e.g. from the
// command palette, once they're ready. The parameter is removed first, so a
// reload or Back doesn't repeat it.
export function useDoParam(handlers, ready = true) {
  const [params, setParams] = useSearchParams();
  const action = params.get("do");
  const run = useEffectEvent((name) => handlers[name]?.());
  useEffect(() => {
    if (!action || !ready) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("do");
        return next;
      },
      { replace: true },
    );
    run(action);
  }, [action, ready, setParams]);
}
