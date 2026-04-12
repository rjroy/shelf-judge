export function NarrationEmpty() {
  return (
    <div className="narration-empty">
      <div className="narration-text">
        <div className="narration-label">Collection Narrative</div>
        <div className="narration-desc">
          Generate a natural-language interpretation of your profile &mdash; what your collection
          says about what you value, and where the tensions are.
        </div>
      </div>
      <button className="btn-narrate" disabled>
        Generate Narrative
      </button>
    </div>
  );
}
