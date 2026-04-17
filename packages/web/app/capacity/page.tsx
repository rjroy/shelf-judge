import type { Metadata } from "next";
import Link from "next/link";
import { getShelfCapacity } from "@/lib/api";
import type {
  AssignedGame,
  ShelfAssignment,
  ShelfCapacityResult,
  UnfittableEntry,
  OverflowEntry,
} from "@shelf-judge/shared";

export const metadata: Metadata = { title: "Shelf Capacity" };
export const dynamic = "force-dynamic";

function formatVolume(value: number): string {
  return `${Math.round(value).toLocaleString()} in\u00B3`;
}

function scoreChipClass(score: number): string {
  if (score >= 7.5) return "score-value high";
  if (score >= 5.0) return "score-value mid";
  return "score-value low";
}

function scoreColorClass(score: number): string {
  if (score >= 7.5) return "high";
  if (score >= 5.0) return "mid";
  return "low";
}

function utilBarFillClass(utilization: number): string {
  // Matches the mockup thresholds: ≥85% high (green), ≥60% mid, ≥100% warn (overflow),
  // <40% low (faint green). Mockup shows "high" at 82%/94% and "low" at 28%.
  if (utilization >= 1.0) return "util-bar-fill warn";
  if (utilization >= 0.6) return "util-bar-fill high";
  if (utilization >= 0.4) return "util-bar-fill mid";
  return "util-bar-fill low";
}

function ShelfAssignmentCard({ assignment }: { assignment: ShelfAssignment }) {
  const heightless = assignment.capacityIn3 === null;
  const pct = assignment.utilization !== null ? Math.round(assignment.utilization * 100) : null;
  const gradeClass = `grade-badge grade-${assignment.grade.toUpperCase()}`;

  return (
    <div className="shelf-assign-card">
      <div className="shelf-assign-header">
        <div className="shelf-assign-meta">
          <div className="shelf-assign-name">{assignment.shelfName}</div>
          <div className="shelf-assign-unit">
            {assignment.unitName}
            {heightless ? (
              <>
                {" · "}
                <span className="shelf-assign-unconstrained">unconstrained height</span>
              </>
            ) : null}
          </div>
          <div className="util-bar-wrap">
            {heightless || assignment.utilization === null ? (
              <div className="util-unconstrained">
                No utilization tracked (unconstrained height)
              </div>
            ) : (
              <>
                <div className="util-bar-track">
                  <div
                    className={utilBarFillClass(assignment.utilization)}
                    style={{ width: `${Math.min(100, pct ?? 0)}%` }}
                  />
                </div>
                <div className="util-pct">
                  {pct}% · {formatVolume(assignment.usedIn3)} /{" "}
                  {assignment.capacityIn3 !== null ? formatVolume(assignment.capacityIn3) : "—"}
                </div>
              </>
            )}
          </div>
        </div>
        <div className={gradeClass}>{assignment.grade.toUpperCase()}</div>
      </div>
      {assignment.games.length > 0 ? (
        <div className="shelf-games">
          {assignment.games.map((game) => (
            <AssignedGameRow key={game.gameId} game={game} heightless={heightless} />
          ))}
        </div>
      ) : (
        <div className="shelf-games">
          <div className="shelf-game-row shelf-game-empty">(no games assigned)</div>
        </div>
      )}
    </div>
  );
}

function AssignedGameRow({ game, heightless }: { game: AssignedGame; heightless: boolean }) {
  return (
    <div className="shelf-game-row">
      <Link href={`/games/${game.gameId}`} className="shelf-game-name game-link">
        {game.gameName}
      </Link>
      <div className={`shelf-game-score ${scoreColorClass(game.fitnessScore)}`}>
        {game.fitnessScore.toFixed(1)}
      </div>
      <div className="shelf-game-vol">{heightless ? "—" : formatVolume(game.volumeIn3)}</div>
    </div>
  );
}

function UnfittableTable({ entries }: { entries: UnfittableEntry[] }) {
  return (
    <table className="cull-table">
      <thead>
        <tr>
          <th>Game</th>
          <th>Fitness</th>
          <th>Box Dimensions</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.gameId}>
            <td>
              <div>
                <Link href={`/games/${entry.gameId}`} className="game-link">
                  {entry.gameName}
                </Link>
              </div>
              <span className="unfittable-flag">Unfittable</span>
            </td>
            <td>
              <span className={scoreChipClass(entry.fitnessScore)}>
                {entry.fitnessScore.toFixed(1)}
              </span>
            </td>
            <td className="cull-dims">
              {entry.boxDimensions.width} × {entry.boxDimensions.height} ×{" "}
              {entry.boxDimensions.depth} in
            </td>
            <td className="cull-reason">{entry.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DisplacedTable({ entries }: { entries: OverflowEntry[] }) {
  return (
    <table className="cull-table">
      <thead>
        <tr>
          <th>Game</th>
          <th>Fitness</th>
          <th>Volume</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.gameId}>
            <td>
              <Link href={`/games/${entry.gameId}`} className="game-link">
                {entry.gameName}
              </Link>
            </td>
            <td>
              <span className={scoreChipClass(entry.fitnessScore)}>
                {entry.fitnessScore.toFixed(1)}
              </span>
            </td>
            <td className="cull-dims">{formatVolume(entry.volumeIn3)}</td>
            <td className="cull-reason cull-reason-displaced">
              Fits shelf, displaced by higher-priority games
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CapacityHeader({ capacity }: { capacity: ShelfCapacityResult }) {
  const { gamesWithDimensions, gamesWithoutDimensions, totalShelfCount } = capacity;
  const total = gamesWithDimensions + gamesWithoutDimensions;
  let meta: string;
  if (gamesWithDimensions === 0 && total === 0) {
    meta = `${totalShelfCount} shelves configured`;
  } else {
    meta = `${gamesWithDimensions} measured · ${gamesWithoutDimensions} unmeasured`;
  }
  return (
    <div className="topbar">
      <Link href="/collection" className="topbar-back">
        ← Collection
      </Link>
      <div className="topbar-title">Shelf Capacity</div>
      <div className="topbar-meta">{meta}</div>
    </div>
  );
}

function NotConfiguredEmpty() {
  return (
    <>
      <div className="topbar">
        <Link href="/collection" className="topbar-back">
          ← Collection
        </Link>
        <div className="topbar-title">Shelf Capacity</div>
      </div>
      <div className="main-scroll capacity-empty-scroll">
        <div className="empty-card">
          <div className="shelf-illustration" aria-hidden="true">
            <div className="shelf-row-illus">
              <div className="shelf-box phantom" />
              <div className="shelf-box phantom" />
              <div className="shelf-box phantom" />
            </div>
            <div className="shelf-line" />
            <div className="shelf-row-illus">
              <div className="shelf-box phantom" />
              <div className="shelf-box phantom" />
              <div className="shelf-box phantom" />
              <div className="shelf-box phantom" />
            </div>
            <div className="shelf-line" />
          </div>
          <div className="empty-title">No shelves configured</div>
          <div className="empty-body">
            To see shelf assignments and capacity analysis, you need to describe your physical
            shelves first. Add your shelf units and their dimensions to get started.
          </div>
          <div className="btn-row">
            <Link href="/shelves" className="btn btn-primary">
              Configure shelves →
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

function NoDimensionsEmpty({ capacity }: { capacity: ShelfCapacityResult }) {
  return (
    <>
      <CapacityHeader capacity={capacity} />
      <div className="main-scroll capacity-empty-scroll">
        <div className="empty-card">
          <div className="dim-illustration" aria-hidden="true">
            <div className="dim-box">?</div>
            <div className="dim-arrow">→</div>
            <div className="dim-box dim-box-faint">W×H×D</div>
          </div>
          <div className="empty-title">No game dimensions yet</div>
          <div className="empty-body">
            Your {capacity.totalShelfCount}{" "}
            {capacity.totalShelfCount === 1 ? "shelf is" : "shelves are"} configured, but no games
            have box dimensions entered. The capacity algorithm needs at least one game measured to
            produce assignments.
            <br />
            <br />
            Open any game and enter its box dimensions, or{" "}
            <Link href="/collection?dimensions=missing">view all games without dimensions</Link> in
            the collection.
          </div>
          <div className="btn-row">
            <Link href="/collection?dimensions=missing" className="btn btn-secondary">
              View unmeasured games
            </Link>
            <Link href="/collection" className="btn btn-primary">
              Go to collection →
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

export default async function CapacityPage() {
  let capacity: ShelfCapacityResult;
  try {
    capacity = await getShelfCapacity();
  } catch {
    return (
      <div className="error-banner">
        Could not connect to the shelf-judge daemon. Is it running?
      </div>
    );
  }

  if (!capacity.configured || capacity.totalShelfCount === 0) {
    return <NotConfiguredEmpty />;
  }

  if (capacity.gamesWithDimensions === 0) {
    return <NoDimensionsEmpty capacity={capacity} />;
  }

  const placedCount = capacity.assignments.reduce((sum, a) => sum + a.games.length, 0);

  return (
    <>
      <CapacityHeader capacity={capacity} />
      <div className="main-scroll capacity-scroll">
        {capacity.assignments.length > 0 ? (
          <section className="cap-section">
            <div className="cap-section-header">
              <div className="cap-section-icon" aria-hidden="true">
                📦
              </div>
              <div className="cap-section-title">Shelf Assignments</div>
              <div className="cap-section-count">
                {capacity.totalShelfCount} {capacity.totalShelfCount === 1 ? "shelf" : "shelves"} ·{" "}
                {placedCount} {placedCount === 1 ? "game" : "games"} placed
              </div>
            </div>
            {capacity.assignments.map((assignment) => (
              <ShelfAssignmentCard key={assignment.shelfId} assignment={assignment} />
            ))}
          </section>
        ) : null}

        {capacity.unfittableGames.length > 0 ? (
          <section className="cap-section">
            <div className="cap-section-header">
              <div className="cap-section-icon" aria-hidden="true">
                ✕
              </div>
              <div className="cap-section-title cap-section-title-danger">Unfittable Games</div>
              <div className="cap-section-count">
                {capacity.unfittableGames.length}{" "}
                {capacity.unfittableGames.length === 1 ? "game" : "games"} · don't fit any shelf ·
                strongest cull candidates
              </div>
            </div>
            <UnfittableTable entries={capacity.unfittableGames} />
          </section>
        ) : null}

        {capacity.overflowGames.length > 0 ? (
          <section className="cap-section">
            <div className="cap-section-header">
              <div className="cap-section-icon" aria-hidden="true">
                ⇱
              </div>
              <div className="cap-section-title cap-section-title-warning">Displaced Games</div>
              <div className="cap-section-count">
                {capacity.overflowGames.length}{" "}
                {capacity.overflowGames.length === 1 ? "game" : "games"} · fit by shape but no room
              </div>
            </div>
            <DisplacedTable entries={capacity.overflowGames} />
          </section>
        ) : null}

        {capacity.gamesWithoutDimensions > 0 ? (
          <div className="coverage-note">
            {capacity.gamesWithoutDimensions}{" "}
            {capacity.gamesWithoutDimensions === 1 ? "game has" : "games have"} no box dimensions
            and {capacity.gamesWithoutDimensions === 1 ? "is" : "are"} excluded from this
            calculation.{" "}
            <Link href="/collection?dimensions=missing">Add dimensions for unmeasured games</Link>.
          </div>
        ) : null}
      </div>
    </>
  );
}
