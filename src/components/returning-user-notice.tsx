import { useEffect, useState } from "react";
import "./returning-user-notice.css";

const marker = "tasknotes:mdbase-upgrade-notice:v1";
const visited = new WeakSet<Storage>();
// Historical app preferences only: do not inspect credentials or collection data.
const oldPrefixes = [
  "tasknotes:navigation-views:v",
  "tasknotes:primary-views:v1",
  "tasknotes:calendar-preferences:v1",
  "tasknotes:scratchpad-",
  "tasknotes:recent-searches:v1:",
];
function firstVisit(getStorage: () => Storage) {
  try {
    const storage = getStorage();
    if (visited.has(storage) || storage.getItem(marker) !== null)
      return { storage, show: false };
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && oldPrefixes.some((prefix) => key.startsWith(prefix)))
        return { storage, show: true };
    }
    return { storage, show: false };
  } catch {
    return { storage: null, show: false };
  }
}

export function ReturningUserNotice({
  getStorage = () => window.localStorage,
}: {
  getStorage?: () => Storage;
}) {
  const [visit] = useState(() => firstVisit(getStorage));
  const [visible, setVisible] = useState(visit.show);
  useEffect(() => {
    if (!visit.storage) return;
    visited.add(visit.storage);
    try {
      // Record fresh visits too, so later new-engine preferences aren't legacy.
      visit.storage.setItem(marker, "seen");
    } catch {
      // This informational notice must never interrupt the app or its writing.
    }
  }, [visit]);
  if (!visible) return null;
  return (
    <aside className="returning-user-notice" aria-label="mdbase update">
      <p>
        mdbase was upgraded. Approve TaskNotes once to continue. Your
        collections and notes are unchanged.
      </p>
      <p>Private collections need your desktop online.</p>
      <div>
        <a href="https://mdbase.dev/" target="_blank" rel="noopener noreferrer">
          Learn more
        </a>
        <button type="button" onClick={() => setVisible(false)}>
          Dismiss
        </button>
      </div>
    </aside>
  );
}
