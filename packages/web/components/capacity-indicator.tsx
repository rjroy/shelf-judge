import Link from "next/link";
import type { ShelfCapacityResult } from "@shelf-judge/shared";

// Capacity indicator band shown between the topbar and collection table (REQ-SHELF-30).
// Four visual states: success (all placed), warning (overflow only),
// danger (unfittable, optionally with displaced), neutral (configured without dimensions).
export function CapacityIndicator({ capacity }: { capacity: ShelfCapacityResult }) {
  if (!capacity.configured || capacity.totalShelfCount === 0) {
    return null;
  }

  const unfittableCount = capacity.unfittableGames.length;
  const displacedCount = capacity.overflowGames.length;

  // State D: shelves configured but no game dimensions.
  if (capacity.gamesWithDimensions === 0) {
    return (
      <div className="capacity-indicator neutral">
        <div className="cap-icon cap-icon-neutral">□</div>
        <div className="cap-text neutral-text">
          Shelves configured, but no game dimensions available.{" "}
          <Link
            href="/collection?dimensions=missing"
            className="cap-detail-link cap-detail-link-inline"
          >
            Add box dimensions
          </Link>{" "}
          to enable capacity analysis.
        </div>
      </div>
    );
  }

  // State C: one or more games don't fit any shelf — strongest cull signal.
  // If displaced games also exist, show them as a secondary warning line.
  if (unfittableCount > 0) {
    return (
      <div className="capacity-indicator danger capacity-indicator-stack">
        <div className="capacity-indicator-row">
          <div className="cap-icon">✕</div>
          <div className="cap-text danger-text">
            <strong>
              {unfittableCount === 1 ? "1 game doesn't" : `${unfittableCount} games don't`} fit any
              shelf
            </strong>{" "}
            — cull candidates. Box is too large for all configured shelves.
          </div>
          <Link href="/capacity" className="cap-detail-link">
            View unfittable →
          </Link>
        </div>
        {displacedCount > 0 ? (
          <div className="capacity-indicator-row capacity-indicator-subrow">
            <div className="cap-text warning-text">
              Also:{" "}
              <strong>
                {displacedCount === 1 ? "1 game displaced" : `${displacedCount} games displaced`}
              </strong>{" "}
              — shelves full.
            </div>
            <Link href="/capacity" className="cap-detail-link">
              View all overflow →
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  // State B: only overflow (games fit by shape but displaced).
  if (displacedCount > 0) {
    return (
      <div className="capacity-indicator warning">
        <div className="cap-icon">⚠</div>
        <div className="cap-text warning-text">
          <strong>
            {displacedCount === 1
              ? "1 game couldn't be placed"
              : `${displacedCount} games couldn't be placed`}
          </strong>{" "}
          — shelves are full. These games fit by shape but have no room.
        </div>
        <Link href="/capacity" className="cap-detail-link">
          View overflow →
        </Link>
      </div>
    );
  }

  // State A: everything placed.
  const placedCount = capacity.assignments.reduce((sum, a) => sum + a.games.length, 0);
  const constrained = capacity.assignments.filter((a) => a.utilization !== null);
  const avgUtilization =
    constrained.length > 0
      ? constrained.reduce((sum, a) => sum + (a.utilization ?? 0), 0) / constrained.length
      : null;
  const avgDisplay =
    avgUtilization !== null ? `, avg ${Math.round(avgUtilization * 100)}% full` : "";
  const shelfWord = capacity.totalShelfCount === 1 ? "shelf" : "shelves";
  const gameWord = placedCount === 1 ? "game" : "games";

  return (
    <div className="capacity-indicator success">
      <div className="cap-icon">✓</div>
      <div className="cap-text success-text">
        <strong>
          All {placedCount} measured {gameWord} placed
        </strong>{" "}
        · {capacity.totalShelfCount} {shelfWord}
        {avgDisplay}
      </div>
      <Link href="/capacity" className="cap-detail-link">
        View shelf assignments
      </Link>
    </div>
  );
}
