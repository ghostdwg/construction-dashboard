// tests/fixtures/r2-lifecycle/meetingRegisterFixtures.ts
//
// Synthetic Meeting / MeetingActionItem builders mirroring the IMPLEMENTED
// Build 1 schema (prisma/schema.prisma `Meeting`, `MeetingActionItem`).
// These feed the Meeting -> Register -> TrackedItem leg of the lifecycle
// (promoteMeetingActionItem in lib/services/trackedItems/index.ts), which is
// real, unit-tested production code — not a simulation. No DB, no network.

export interface FixtureMeeting {
  id: number;
  bidId: number;
  title: string;
  meetingDate: Date;
  meetingType: string;
  status: string;
  reviewStatus: string;
  transcript: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FixtureMeetingActionItem {
  id: number;
  bidId: number;
  meetingId: number | null;
  source: string;
  description: string;
  assignedToName: string | null;
  dueDate: Date | null;
  priority: string;
  status: string;
  sourceText: string | null;
  isGcTask: boolean;
  carriedFromDate: string | null;
  createdAt: Date;
  updatedAt: Date;
}

let _nextMeetingId = 5000;
export function nextMeetingId(): number {
  return _nextMeetingId++;
}
export function resetMeetingIds(start = 5000): void {
  _nextMeetingId = start;
}

export function makeMeeting(overrides: Partial<FixtureMeeting> = {}): FixtureMeeting {
  const id = nextMeetingId();
  const now = new Date("2024-10-10T09:00:00.000Z");
  return {
    id,
    bidId: 9,
    title: "Weekly OAC Meeting",
    meetingDate: new Date("2024-10-09T14:00:00.000Z"),
    meetingType: "OAC",
    status: "COMPLETE",
    reviewStatus: "PUBLISHED",
    transcript: "Synthetic speaker-labeled transcript for certification testing.",
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeMeetingActionItem(overrides: Partial<FixtureMeetingActionItem> = {}): FixtureMeetingActionItem {
  const id = nextMeetingId();
  const now = new Date("2024-10-10T09:30:00.000Z");
  return {
    id,
    bidId: 9,
    meetingId: null,
    source: "meeting",
    description: "Synthetic OAC action item for certification testing",
    assignedToName: "GC Superintendent",
    dueDate: new Date("2024-10-20T00:00:00.000Z"),
    priority: "MEDIUM",
    status: "OPEN",
    sourceText: "Per transcript minute 12:04 — synthetic evidence excerpt.",
    isGcTask: true,
    carriedFromDate: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
