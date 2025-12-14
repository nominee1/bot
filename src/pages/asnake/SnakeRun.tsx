/* ===========================================================================
 *  SnakeRun.tsx  – streak “snake” that changes color by length
 * =========================================================================== */

import { useEffect, useState } from 'react';
import './SnakeRun.scss';

interface Props {
  length: number;           // current streak length
  crashed: boolean;         // true on the tick that ends a streak
}

const SEG_SIZE = 10;        // px
const MAX_SEGS = 200;       // cap DOM nodes

/* same thresholds as getCounterColor() in TickAnalysis */
const getColor = (c: number) => {
  if (c <= 0 || c < 10)  return '#cb4335';
  if (c < 20)            return '#2874a6';
  if (c < 50)            return '#6c3483';
  if (c < 100)           return '#800080';
  if (c < 150)           return '#4B0082';
  if (c < 200)           return '#0000FF';
  return '#00008B';
};

const SnakeRun = ({ length, crashed }: Props) => {
  /* shake for 400 ms on a crash */
  const [shake, setShake] = useState(false);
  useEffect(() => {
    if (crashed) {
      setShake(true);
      const t = setTimeout(() => setShake(false), 400);
      return () => clearTimeout(t);
    }
  }, [crashed]);

  const segs = Array.from({ length: Math.min(length, MAX_SEGS) });
  const segColor = crashed ? '#ff0033' : getColor(length);

  return (
    <div
      className={`snake-run${shake ? ' crashed' : ''}`}
      style={{ height: SEG_SIZE, gap: 2 }}
    >
      {segs.map((_, i) => (
        <div
          key={i}
          className="snake-seg"
          style={{
            width: SEG_SIZE,
            height: SEG_SIZE,
            background: segColor,
            animationDelay: `${i * 20}ms`
          }}
        />
      ))}
    </div>
  );
};

export default SnakeRun;
