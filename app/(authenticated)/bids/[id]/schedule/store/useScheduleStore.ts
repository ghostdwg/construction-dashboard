"use client";

// Phase 5C — Schedule V2 Zustand store with Immer
//
// Holds the local-client copy of the schedule. The server is the source of
// truth; after every mutation the API returns the updated activities list
// and we replace our local copy. Undo/redo is client-side only — it rewinds
// to the previous server-confirmed state.

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { ActivityV2, DepRow, ScheduleV2 } from "@/lib/services/schedule/scheduleV2Service";

type HistoryFrame = { activities: ActivityV2[]; deps: DepRow[] };

export type ScheduleStore = {
  // Data
  schedule: ScheduleV2 | null;
  activities: ActivityV2[];
  deps: DepRow[];

  // Pending: cells changed locally but not yet saved to server
  pendingPatches: Record<string, Partial<ActivityV2 & { predecessors: string }>>;

  // Undo/redo
  past: HistoryFrame[];
  future: HistoryFrame[];

  // Saving indicator (activity ids currently in-flight)
  saving: Set<string>;

  // Actions
  load: (schedule: ScheduleV2, activities: ActivityV2[], deps: DepRow[]) => void;
  setActivities: (activities: ActivityV2[], deps: DepRow[]) => void;
  setPatch: (activityId: string, patch: Partial<ActivityV2 & { predecessors: string }>) => void;
  clearPatch: (activityId: string) => void;
  setSaving: (activityId: string, saving: boolean) => void;
  snapshot: () => void;
  undo: () => void;
  redo: () => void;
};

export const useScheduleStore = create<ScheduleStore>()(
  immer((set, get) => ({
    schedule: null,
    activities: [],
    deps: [],
    pendingPatches: {},
    past: [],
    future: [],
    saving: new Set(),

    load(schedule, activities, deps) {
      set((s) => {
        s.schedule = schedule;
        s.activities = activities;
        s.deps = deps;
        s.past = [];
        s.future = [];
        s.pendingPatches = {};
        // Immer doesn't handle Set well in non-draft context; assign directly
      });
    },

    setActivities(activities, deps) {
      set((s) => {
        s.activities = activities;
        s.deps = deps;
      });
    },

    setPatch(activityId, patch) {
      set((s) => {
        s.pendingPatches[activityId] = { ...s.pendingPatches[activityId], ...patch };
      });
    },

    clearPatch(activityId) {
      set((s) => {
        delete s.pendingPatches[activityId];
      });
    },

    setSaving(activityId, saving) {
      set((s) => {
        // Immer draft — need plain object workaround for Set
        const next = new Set(s.saving);
        if (saving) next.add(activityId);
        else next.delete(activityId);
        s.saving = next;
      });
    },

    snapshot() {
      const { activities, deps, past } = get();
      set((s) => {
        s.past = [...past.slice(-49), { activities, deps }]; // keep last 50
        s.future = [];
      });
    },

    undo() {
      const { past, activities, deps } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1];
      set((s) => {
        s.future = [{ activities, deps }, ...s.future.slice(0, 49)];
        s.past = past.slice(0, -1);
        s.activities = prev.activities;
        s.deps = prev.deps;
      });
    },

    redo() {
      const { future, activities, deps } = get();
      if (future.length === 0) return;
      const next = future[0];
      set((s) => {
        s.past = [...s.past.slice(-49), { activities, deps }];
        s.future = future.slice(1);
        s.activities = next.activities;
        s.deps = next.deps;
      });
    },
  }))
);
