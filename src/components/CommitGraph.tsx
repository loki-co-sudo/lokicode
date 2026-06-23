import { useMemo } from "react";
import type { GitCommit } from "../lib/git";

// Lane colors (cycled). Tuned to read well on the dark sidebar.
const COLORS = ["#3b82f6", "#22c55e", "#eab308", "#ec4899", "#a855f7", "#06b6d4", "#f97316"];
const LANE_W = 14;
const ROW_H = 38;
const NODE_R = 4;

interface GraphRow {
  commit: GitCommit;
  col: number;
  above: (string | null)[];
  below: (string | null)[];
  isMerge: boolean;
}

/** Assign each commit (newest-first, as returned by git log) to a lane and
 * record the lane layout above/below the row so connectors can be drawn. */
function buildGraph(commits: GitCommit[]): { rows: GraphRow[]; lanes: number } {
  const lanes: (string | null)[] = []; // lane -> hash it currently expects
  const rows: GraphRow[] = [];
  let maxLanes = 1;

  for (const commit of commits) {
    let col = lanes.indexOf(commit.hash);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) col = lanes.length;
      lanes[col] = commit.hash;
    }
    const above = lanes.slice();

    // Any other lane waiting for this commit merges into `col`.
    for (let i = 0; i < lanes.length; i++) {
      if (i !== col && lanes[i] === commit.hash) lanes[i] = null;
    }
    // Route parents: first continues in `col`, extras open new lanes.
    if (commit.parents.length === 0) {
      lanes[col] = null;
    } else {
      lanes[col] = commit.parents[0];
      for (let p = 1; p < commit.parents.length; p++) {
        let free = lanes.indexOf(null);
        if (free === -1) free = lanes.length;
        lanes[free] = commit.parents[p];
      }
    }
    // Trim trailing nulls so width stays tight.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    const below = lanes.slice();

    maxLanes = Math.max(maxLanes, above.length, below.length, col + 1);
    rows.push({ commit, col, above, below, isMerge: commit.parents.length > 1 });
  }
  return { rows, lanes: maxLanes };
}

const x = (col: number) => LANE_W / 2 + col * LANE_W;
const color = (col: number) => COLORS[col % COLORS.length];

function RowGraph({ row, width }: { row: GraphRow; width: number }) {
  const { col, above, below, commit, isMerge } = row;
  const mid = ROW_H / 2;
  const lines: React.ReactNode[] = [];

  // Top half: incoming lanes connect down to mid (merging lanes bend to node).
  above.forEach((h, i) => {
    if (h === null) return;
    const target = h === commit.hash ? col : i;
    lines.push(
      <line
        key={`t${i}`}
        x1={x(i)} y1={0} x2={x(target)} y2={mid}
        stroke={color(i)} strokeWidth={1.5}
      />,
    );
  });
  // Bottom half: outgoing lanes leave from mid (new parents fan out from node).
  below.forEach((h, j) => {
    if (h === null) return;
    const passing = above[j] != null && above[j] === h;
    const source = passing ? j : col;
    lines.push(
      <line
        key={`b${j}`}
        x1={x(source)} y1={mid} x2={x(j)} y2={ROW_H}
        stroke={color(j)} strokeWidth={1.5}
      />,
    );
  });

  return (
    <svg width={width} height={ROW_H} className="shrink-0">
      {lines}
      <circle
        cx={x(col)} cy={mid} r={NODE_R}
        fill={isMerge ? "#1b1b1c" : color(col)}
        stroke={color(col)} strokeWidth={isMerge ? 2 : 1}
      />
    </svg>
  );
}

/** Commit history rendered as a git-style graph (lanes + nodes). */
export default function CommitGraph({ commits }: { commits: GitCommit[] }) {
  const { rows, lanes } = useMemo(() => buildGraph(commits), [commits]);
  const width = Math.min(lanes, 8) * LANE_W + 4;

  return (
    <div>
      {rows.map((row) => (
        <div
          key={row.commit.hash}
          className="flex items-stretch hover:bg-neutral-800"
          title={`${row.commit.hash}\n${row.commit.author} · ${row.commit.date}`}
        >
          <RowGraph row={row} width={width} />
          <div className="min-w-0 flex-1 py-1 pr-2" style={{ height: ROW_H }}>
            <div className="truncate text-xs text-neutral-300">
              {row.isMerge && <span className="mr-1 text-purple-400">⑂</span>}
              {row.commit.subject}
            </div>
            <div className="flex gap-2 text-[10px] text-neutral-600">
              <span className="font-mono text-amber-500/80">{row.commit.short}</span>
              <span className="truncate">{row.commit.author}</span>
              <span>{row.commit.date}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
