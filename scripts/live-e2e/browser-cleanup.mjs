// Pure cleanup state machine. Live process inspection/signals are supplied only
// by browser-flow's exact owned-profile/direct-child adapter. Tests inject fakes.
export function assertBrowserStopped(result) {
  if (!["stopped", "stopped-after-scoped-cleanup"].includes(result)) {
    throw Error(
      "Owned browser cleanup unconfirmed; retain original context/profile and do not launch another browser",
    );
  }
}

export async function closeWithScopedCleanup(
  context,
  { inspect, stop, wait, deadline },
) {
  const closed = await Promise.race([
    Promise.resolve()
      .then(() => context.close())
      .then(
        () => true,
        () => false,
      ),
    deadline(),
  ]);
  if (closed) return "stopped";
  try {
    async function signalOwned(signal) {
      const children = await inspect();
      if (
        !Array.isArray(children) ||
        children.some((pid) => !Number.isSafeInteger(pid) || pid < 1)
      )
        throw Error("Owned process inspection unavailable");
      for (const pid of children) {
        try {
          stop(pid, signal);
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
      }
    }
    await signalOwned("SIGTERM");
    await wait(1500);
    await signalOwned("SIGKILL");
    await wait(300);
    const remaining = await inspect();
    if (!Array.isArray(remaining))
      throw Error("Owned process inspection unavailable");
    return remaining.length
      ? "cleanup-blocked"
      : "stopped-after-scoped-cleanup";
  } catch {
    // A failed ps/timeout/signal is uncertainty, never evidence of absence.
    return "cleanup-blocked";
  }
}
