import {
  scratchpadDocumentPath,
  type ScratchpadDocument,
} from "../domain/scratchpad";
import type { CreateTaskInput, Task } from "../domain/task";
import type { TaskNotesTaskModel } from "../domain/tasknotes-model";
import type { DemoSeed } from "./demo-seed";
import { dateOffset } from "./demo-tasks";

/** The curated collection behind the App Store and Google Play screenshots
 * (`pnpm store:screenshots`). Dates are relative to the browser clock, which
 * the generator freezes, so every run renders the same week.
 */
export const storeDemoSeed: DemoSeed = {
  tasks: storeTasks,
  scratchpads: storeScratchpads,
};

const WEBSITE = "[[Projects/Website relaunch]]";
const MOVING = "[[Projects/Moving house]]";
const TALK = "[[Projects/Conference talk]]";

interface SeedTask extends Omit<CreateTaskInput, "scheduled" | "due"> {
  id: string;
  /** Days from today, with an optional "HH:MM" start. */
  scheduled?: [number, string?];
  due?: [number, string?];
  done?: boolean;
}

const TASKS: SeedTask[] = [
  {
    id: "draft-launch-announcement",
    title: "Draft the launch announcement",
    status: "in-progress",
    priority: "high",
    scheduled: [0, "10:00"],
    due: [2],
    projects: [WEBSITE],
    tags: ["work"],
    timeEstimate: 60,
    reminders: [
      {
        id: "announcement",
        type: "relative",
        relatedTo: "due",
        offset: "-PT1H",
      },
    ],
    body: [
      "A short post for the blog and the newsletter. Lead with what changes for existing customers.",
      "",
      "## Outline",
      "",
      "- What is new in the relaunch",
      "- Faster pages and a simpler pricing table",
      "- Where to send feedback",
      "",
      "## Before Thursday",
      "",
      "- [x] Collect screenshots from design",
      "- [ ] Ask Priya for a customer quote",
      "- [ ] Schedule the post for **9 am**",
      "",
    ].join("\n"),
  },
  {
    id: "call-removal-companies",
    title: "Call three removal companies for quotes",
    status: "open",
    priority: "normal",
    scheduled: [0],
    projects: [MOVING],
    contexts: ["phone"],
  },
  {
    id: "review-homepage-copy",
    title: "Review homepage copy with Priya",
    status: "open",
    priority: "normal",
    scheduled: [0, "14:00"],
    projects: [WEBSITE],
    tags: ["work"],
    timeEstimate: 30,
  },
  {
    id: "confirm-photographer",
    title: "Confirm the photographer for launch week",
    status: "open",
    priority: "normal",
    scheduled: [0],
    projects: [WEBSITE],
    tags: ["work"],
  },
  {
    id: "weekly-review",
    title: "Weekly review",
    status: "open",
    priority: "normal",
    scheduled: [0, "16:30"],
    recurrence: "FREQ=WEEKLY;BYDAY=TU",
    contexts: ["computer"],
  },
  {
    id: "pick-up-prescription",
    title: "Pick up prescription",
    status: "open",
    priority: "low",
    scheduled: [0],
    contexts: ["errands"],
  },
  {
    id: "renew-car-insurance",
    title: "Renew the car insurance",
    status: "open",
    priority: "high",
    due: [-1],
    tags: ["home"],
  },
  {
    id: "write-alt-text",
    title: "Write alt text for the case studies",
    status: "in-progress",
    priority: "normal",
    scheduled: [1],
    projects: [WEBSITE],
    tags: ["work"],
  },
  {
    id: "book-venue-walkthrough",
    title: "Book the venue walkthrough",
    status: "open",
    priority: "normal",
    scheduled: [1, "11:00"],
    projects: [TALK],
  },
  {
    id: "rehearse-talk",
    title: "Rehearse the talk out loud",
    status: "open",
    priority: "normal",
    scheduled: [1, "18:00"],
    projects: [TALK],
    timeEstimate: 45,
  },
  {
    id: "plan-dns-cutover",
    title: "Plan the DNS cutover",
    status: "open",
    priority: "normal",
    scheduled: [2, "09:00"],
    projects: [WEBSITE],
    tags: ["work"],
  },
  {
    id: "dentist-check-up",
    title: "Dentist check-up",
    status: "open",
    priority: "none",
    scheduled: [2, "11:30"],
  },
  {
    id: "send-slides",
    title: "Send slides to the organisers",
    status: "open",
    priority: "high",
    due: [3],
    projects: [TALK],
  },
  {
    id: "collect-boxes",
    title: "Collect packing boxes",
    status: "open",
    priority: "low",
    scheduled: [3],
    projects: [MOVING],
    contexts: ["errands"],
  },
  {
    id: "pack-kitchen",
    title: "Pack the kitchen",
    status: "open",
    priority: "normal",
    scheduled: [4],
    projects: [MOVING],
  },
  {
    id: "set-up-redirects",
    title: "Set up redirects for old URLs",
    status: "open",
    priority: "normal",
    scheduled: [6],
    projects: [WEBSITE],
    tags: ["work"],
  },
  {
    id: "pay-rent",
    title: "Pay rent",
    status: "open",
    priority: "normal",
    scheduled: [7],
    recurrence: "FREQ=MONTHLY;BYMONTHDAY=1",
  },
  {
    id: "transfer-utilities",
    title: "Transfer utilities to the new address",
    status: "open",
    priority: "normal",
    scheduled: [7],
    projects: [MOVING],
  },
  {
    id: "launch-website",
    title: "Launch the new website",
    status: "open",
    priority: "high",
    due: [9],
    projects: [WEBSITE],
    tags: ["work"],
  },
  {
    id: "moving-day",
    title: "Moving day",
    status: "open",
    priority: "high",
    scheduled: [11],
    projects: [MOVING],
  },
  {
    id: "give-conference-talk",
    title: "Give the conference talk",
    status: "open",
    priority: "high",
    scheduled: [16, "10:00"],
    projects: [TALK],
  },
  {
    id: "order-bookshelves",
    title: "Order bookshelves for the study",
    status: "open",
    priority: "low",
    projects: [MOVING],
  },
  {
    id: "standing-desk",
    title: "Compare standing desks",
    status: "open",
    priority: "none",
  },
  {
    id: "kick-off-meeting",
    title: "Kick-off meeting with design",
    priority: "normal",
    scheduled: [-21, "10:00"],
    projects: [WEBSITE],
    done: true,
  },
  {
    id: "submit-talk-abstract",
    title: "Submit the talk abstract",
    priority: "high",
    scheduled: [-14],
    projects: [TALK],
    done: true,
  },
  {
    id: "sign-lease",
    title: "Sign the new lease",
    priority: "high",
    scheduled: [-8],
    projects: [MOVING],
    done: true,
  },
  {
    id: "measure-living-room",
    title: "Measure the new living room",
    priority: "low",
    scheduled: [-6],
    projects: [MOVING],
    done: true,
  },
  {
    id: "write-talk-outline",
    title: "Write the talk outline",
    priority: "normal",
    scheduled: [-4],
    projects: [TALK],
    done: true,
  },
  {
    id: "approve-logo",
    title: "Approve the new logo",
    priority: "normal",
    scheduled: [-2, "15:00"],
    projects: [WEBSITE],
    done: true,
  },
];

function storeTasks(model: TaskNotesTaskModel): Task[] {
  const today = new Date();
  return TASKS.map(({ id, done, scheduled, due, ...input }, index) => {
    const task = model.create(
      {
        ...input,
        scheduled: scheduled && when(today, scheduled),
        due: due && when(today, due),
        sortOrder: String(TASKS.length - index).padStart(6, "0"),
      },
      {
        id,
        now: new Date(today.getTime() - (index + 1) * 3_600_000).toISOString(),
      },
    );
    return done ? model.update(task, { status: "done" }) : task;
  });
}

function when(today: Date, [days, time]: [number, string?]): string {
  const day = dateOffset(today, days);
  return time ? `${day}T${time}` : day;
}

function storeScratchpads(now: Date): ScratchpadDocument[] {
  const at = (days: number) =>
    new Date(now.getTime() - days * 86_400_000).toISOString();
  const note = (
    id: string,
    days: number,
    body: string[],
    title?: string,
  ): ScratchpadDocument => ({
    id,
    path: scratchpadDocumentPath(new Date(at(days)), id),
    revision: "scratch-1",
    state: days === 0 ? "active" : "converted",
    dateCreated: at(days),
    dateModified: at(days),
    ...(days === 0 ? {} : { dateConverted: at(days) }),
    ...(title ? { title } : {}),
    body: [...body, ""].join("\n"),
  });
  return [
    note(
      "talk-notes",
      0,
      [
        "- Talk ideas",
        "  - Open with the old homepage next to the new one",
        "  - Keep the live demo under five minutes",
        "  - End on what we would do differently",
        "- [ ] Ask Sam for the speaker badge details",
        "- [ ] Check the venue has a USB-C adapter",
        "- [[tasks/rehearse-talk|Rehearse the talk out loud]]",
      ],
      "Talk prep",
    ),
    note(
      "homepage-feedback",
      1,
      [
        "- Hero headline reads well on phones",
        "- [ ] Shorten the pricing footnotes",
        "- [x] Swap the team photo",
      ],
      "Homepage feedback",
    ),
    note(
      "moving-checklist",
      3,
      [
        "- [x] Book the van",
        "- [ ] Redirect post",
        "- [ ] Tell the bank and the GP",
      ],
      "Moving checklist",
    ),
  ];
}
