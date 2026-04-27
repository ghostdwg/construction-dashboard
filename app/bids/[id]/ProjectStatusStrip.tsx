type Props = {
  dueDate: string | null;
  subCount: number;
  respondedCount: number;
  levelingUploadCount: number;
  hasBrief: boolean;
};

const DAY_MS = 86_400_000;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function startOfDay(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function getDueState(dueDate: string | null) {
  if (!dueDate) {
    return {
      value: "not set",
      note: "set bid due date",
      color: "var(--text)",
      borderColor: "var(--line)",
    };
  }

  const today = startOfDay(new Date());
  const due = startOfDay(new Date(dueDate));
  const dayDelta = Math.round((due.getTime() - today.getTime()) / DAY_MS);

  if (dayDelta < 0) {
    return {
      value: `${Math.abs(dayDelta)}d late`,
      note: `due ${dateFormatter.format(due)}`,
      color: "var(--red)",
      borderColor: "var(--red)",
    };
  }

  if (dayDelta <= 7) {
    return {
      value: `${dayDelta}d`,
      note: `due ${dateFormatter.format(due)}`,
      color: "var(--amber)",
      borderColor: "var(--amber)",
    };
  }

  return {
    value: `${dayDelta}d`,
    note: `due ${dateFormatter.format(due)}`,
    color: "var(--signal-soft)",
    borderColor: "var(--line)",
  };
}

function getResponseState(subCount: number, respondedCount: number) {
  if (subCount === 0) {
    return {
      value: "0/0",
      note: "no subs invited",
      color: "var(--text)",
    };
  }

  return {
    value: `${respondedCount}/${subCount}`,
    note: "responses logged",
    color: respondedCount > 0 ? "var(--signal-soft)" : "var(--text)",
  };
}

function getLevelingState(levelingUploadCount: number) {
  if (levelingUploadCount === 0) {
    return {
      value: "none",
      note: "leveled uploads",
      color: "var(--text)",
    };
  }

  return {
    value: String(levelingUploadCount),
    note: levelingUploadCount === 1 ? "leveled upload" : "leveled uploads",
    color: "var(--signal-soft)",
  };
}

function getBriefState(hasBrief: boolean) {
  return hasBrief
    ? {
        value: "ready",
        note: "Glint briefing live",
        color: "var(--signal-soft)",
      }
    : {
        value: "pending",
        note: "Glint briefing not generated",
        color: "var(--text)",
      };
}

function StatusTile({
  label,
  value,
  note,
  color,
  borderColor = "var(--line)",
}: {
  label: string;
  value: string;
  note: string;
  color: string;
  borderColor?: string;
}) {
  return (
    <div
      className="min-w-0 rounded-[var(--radius)] border px-4 py-3.5"
      style={{
        background: "var(--panel)",
        borderColor,
      }}
    >
      <p
        className="font-mono text-[9px] uppercase tracking-[0.14em]"
        style={{ color: "var(--text-dim)" }}
      >
        {label}
      </p>
      <p
        className="mt-2 text-[28px] font-[800] tracking-[-0.05em] leading-none"
        style={{ color }}
      >
        {value}
      </p>
      <p
        className="mt-2 text-[11px]"
        style={{ color: "var(--text-soft)" }}
      >
        {note}
      </p>
    </div>
  );
}

export default function ProjectStatusStrip({
  dueDate,
  subCount,
  respondedCount,
  levelingUploadCount,
  hasBrief,
}: Props) {
  const due = getDueState(dueDate);
  const responses = getResponseState(subCount, respondedCount);
  const leveling = getLevelingState(levelingUploadCount);
  const brief = getBriefState(hasBrief);

  return (
    <section className="w-full">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatusTile
          label="due"
          value={due.value}
          note={due.note}
          color={due.color}
          borderColor={due.borderColor}
        />
        <StatusTile
          label="responses"
          value={responses.value}
          note={responses.note}
          color={responses.color}
        />
        <StatusTile
          label="leveling"
          value={leveling.value}
          note={leveling.note}
          color={leveling.color}
        />
        <StatusTile
          label="briefing"
          value={brief.value}
          note={brief.note}
          color={brief.color}
        />
      </div>
    </section>
  );
}
