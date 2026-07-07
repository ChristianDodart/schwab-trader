import { resetFirstRun } from "../FirstRun";
import { useToast } from "../Toast";

export function SetupGuideReset() {
  const toast = useToast();
  return (
    <button className="btn btn-secondary btn-sm"
      onClick={() => { resetFirstRun(); toast("The setup guide will show on the dashboard again.", "success"); }}>
      Show the setup guide again
    </button>
  );
}
