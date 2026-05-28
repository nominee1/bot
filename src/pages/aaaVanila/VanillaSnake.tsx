// src/pages/aaaStrategies/vanilla/VanillaProfitTrack.tsx
import React, { useMemo } from 'react';
import './VanillaSnake.scss';

export type VanillaDir = 'CALL' | 'PUT';

export type ProfitTrackState = {
  // signed streak:
  //  +N => profitable streak (green)
  //  -N => not-profitable streak (grey)
  streak: number;
};

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

function isProfitable(dir: VanillaDir, spot: number, profitLine: number) {
  // CALL profitable if spot >= line
  // PUT  profitable if spot <= line
  if (!Number.isFinite(spot) || !Number.isFinite(profitLine)) return false;
  return dir === 'CALL' ? spot >= profitLine : spot <= profitLine;
}

const VanillaProfitTrack: React.FC<{
  dir: VanillaDir;
  spot: number;
  profitLine: number;
  state: ProfitTrackState;
  maxSquares?: number;
}> = ({ dir, spot, profitLine, state, maxSquares = 40 }) => {
  const profitable = useMemo(
    () => isProfitable(dir, spot, profitLine),
    [dir, spot, profitLine]
  );

  const streak = state.streak || 0;
  const absStreak = Math.abs(streak);
  const shown = clamp(absStreak, 0, maxSquares);
  const overflow = absStreak > maxSquares ? absStreak : null;

  // Which side is the "profit side" on the illustration:
  // CALL: profit is RIGHT, PUT: profit is LEFT
  const profitSide: 'left' | 'right' = dir === 'CALL' ? 'right' : 'left';

  const showGreen = profitable;
  const fillSide: 'left' | 'right' = showGreen ? profitSide : (profitSide === 'left' ? 'right' : 'left');

  const leftCount = fillSide === 'left' ? shown : 0;
  const rightCount = fillSide === 'right' ? shown : 0;

  const signLabel =
    streak === 0 ? '0' : (streak > 0 ? `+${absStreak}` : `-${absStreak}`);

  return (
    <div className="vanilla-profit-track">
      <div className="vpt-header">
        <div className={`badge ${profitable ? 'good' : 'neutral'}`}>
          {dir} • {profitable ? 'PROFIT ZONE' : 'WAITING'}
        </div>

        <div className="meta">
          <span>Spot: <b>{Number.isFinite(spot) ? spot.toFixed(2) : '—'}</b></span>
          <span>Sweet spot: <b>{Number.isFinite(profitLine) ? profitLine.toFixed(2) : '—'}</b></span>
        </div>
      </div>

      <div className="vpt-track">
        {/* LEFT side */}
        <div className="side left">
          {Array.from({ length: leftCount }).map((_, i) => (
            <div
              key={i}
              className={`sq ${showGreen && fillSide === 'left' ? 'green' : 'grey'} ${i === 0 ? 'head' : ''}`}
              style={{ animationDelay: `${i * 18}ms` }}
            />
          ))}
          {overflow && fillSide === 'left' && (
            <div className={`overflow ${showGreen ? 'green' : 'grey'}`}>{signLabel}</div>
          )}
        </div>

        {/* CENTER sweet spot */}
        <div className="center" title="Sweet spot (profit line)">
          <div className="center-line" />
          <div className="glow" />
        </div>

        {/* RIGHT side */}
        <div className="side right">
          {Array.from({ length: rightCount }).map((_, i) => (
            <div
              key={i}
              className={`sq ${showGreen && fillSide === 'right' ? 'green' : 'grey'} ${i === 0 ? 'head' : ''}`}
              style={{ animationDelay: `${i * 18}ms` }}
            />
          ))}
          {overflow && fillSide === 'right' && (
            <div className={`overflow ${showGreen ? 'green' : 'grey'}`}>{signLabel}</div>
          )}
        </div>
      </div>

      <div className="vpt-footer">
        <span className="hint">
          Squares = tick-by-tick progress (capped). Overflow shows total streak.
        </span>
      </div>
    </div>
  );
};

export default VanillaProfitTrack;
