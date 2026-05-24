import { formatTokenApprox } from "../utils/tokenHelper";

interface ContextBudgetCardProps {
  totalTokens: number;
}

export function ContextBudgetCard({ totalTokens }: ContextBudgetCardProps) {
  const pctTotal = Math.min((totalTokens / 1000000) * 100, 100);
  const pctOf256k = Math.min((totalTokens / 256000) * 100, 100);

  const formatPct = (pct: number) => {
    if (pct === 0) return "0%";
    if (pct < 0.1) return "<0.1%";
    return `${pct.toFixed(1)}%`;
  };

  const formattedTokens = formatTokenApprox(totalTokens);
  const crossed256k = totalTokens >= 256000;

  return (
    <div className="glass-panel context-budget-card">
      <div className="context-budget-card__header">
        <span className="material-symbols-outlined context-budget-card__icon">
          analytics
        </span>
        <div className="context-budget-card__title-group">
          <h4 className="context-budget-card__title">Context Budget Visualizer</h4>
          <span className="context-budget-card__subtitle">
            Estimated footprint inside 256k and 1M context limits ({formattedTokens} tokens active)
          </span>
        </div>
      </div>

      <div className="context-unified-bar-container">
        {/* Top Labels */}
        <div className="context-bar-top-labels">
          <span className="context-bar-status-text">
            Active: <strong className="color-primary">{formattedTokens} tokens</strong>
          </span>
          <div className="context-bar-stats-group">
            <span className="stats-badge" data-alert={crossed256k}>
              256k Limit: {formatPct(pctOf256k)}
            </span>
            <span className="stats-badge secondary">
              1M Limit: {formatPct(pctTotal)}
            </span>
          </div>
        </div>

        {/* The Track and Fill */}
        <div className="context-bar-track-wrapper">
          <div className="context-bar-track unified-track">
            {/* 256k Stop Divider Line */}
            <div 
              className={`context-bar-stop-line ${crossed256k ? 'crossed' : ''}`}
              style={{ left: '25.6%' }}
            />
            {/* The Actual Fill */}
            <div 
              className="context-bar-fill unified-fill" 
              style={{ width: `${pctTotal}%` }}
            />
          </div>
          
          {/* Bottom Labels along the track */}
          <div className="context-bar-bottom-labels">
            <span className="scale-label start">0</span>
            <div className="scale-label stop-256k" style={{ left: '25.6%', transform: 'translateX(-50%)' }}>
              <span className="stop-marker-dot" data-active={crossed256k} />
              <span>256k Stop</span>
            </div>
            <span className="scale-label end">1M Limit</span>
          </div>
        </div>
      </div>
    </div>
  );
}
