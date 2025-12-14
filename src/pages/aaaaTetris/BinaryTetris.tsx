import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import './BinaryTetris.scss';

// Types and constants (same as before)
type Parity = 'even' | 'odd';
type TTradeMini = {
  id: string;
  side: Parity;
  contractType: 'DIGITEVEN' | 'DIGITODD';
  stake: number;
  duration: number;
  symbol: string;
  status: 'open' | 'won' | 'lost' | 'error';
  profit?: number;
  entry?: number;
  exit?: number;
  exitDigit?: number;
  createdAt: number;
  closedAt?: number;
  errorMsg?: string;
};

const MARKET_NAMES: Record<string, string> = {
  R_10: 'Volatility 10',
  '1HZ10V': 'Volatility 10 (1s)',
  R_25: 'Volatility 25',
  '1HZ25V': 'Volatility 25 (1s)',
  R_50: 'Volatility 50',
  '1HZ50V': 'Volatility 50 (1s)',
  R_75: 'Volatility 75',
  '1HZ75V': 'Volatility 75 (1s)',
  R_100: 'Volatility 100',
  '1HZ100V': 'Volatility 100 (1s)',
};

const APP_ID = 1089;

// NEW CONSTANTS FOR TETRIS MODEL
const COLUMNS = 3;  // Each container has 3 columns
const MAX_BLOCKS_PER_CONTAINER = 30;  // Reset when reaches 30
const FALL_SPEED = 300; // ms per block movement

type Block = {
  id: string;
  parity: Parity;
  digit: number;
  column: number;  // Which column it's in (0, 1, 2)
  row: number;     // Current row position
  falling: boolean; // Is it currently falling?
  fresh: boolean;   // Just added
};

type ContainerState = {
  grid: (Block | null)[][]; // 3 columns × N rows grid
  fallingBlocks: Block[];    // Blocks currently falling
  totalBlocks: number;       // Count for reset
};

const BinaryTetris: React.FC = () => {
  // market & trade params
  const [symbol, setSymbol] = useState<string>('1HZ10V');
  const [stake, setStake] = useState<string>('10');
  const [duration, setDuration] = useState<string>('1');

  // tick stream
  const wsRef = useRef<WebSocket | null>(null);
  const isMountedRef = useRef(false);
  const prevTickRef = useRef<number | null>(null);

  // NEW: Tetris board state
  const [leftContainer, setLeftContainer] = useState<ContainerState>({
    grid: Array(COLUMNS).fill(null).map(() => []),
    fallingBlocks: [],
    totalBlocks: 0,
  });
  
  const [rightContainer, setRightContainer] = useState<ContainerState>({
    grid: Array(COLUMNS).fill(null).map(() => []),
    fallingBlocks: [],
    totalBlocks: 0,
  });

  const [lastDigit, setLastDigit] = useState<number | null>(null);
  const [trades, setTrades] = useState<TTradeMini[]>([]);
  const [msg, setMsg] = useState<{ txt: string; type: 'info' | 'success' | 'error' | 'loading' }>({
    txt: 'Connected',
    type: 'info',
  });
  const [activePick, setActivePick] = useState<Parity | null>(null);
  const lockRef = useRef(false);
  const subIdByContractRef = useRef<Record<string, string>>({});
  const fallIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const numericStake = useMemo(() => Math.max(1, Math.floor(Number(stake || 1))), [stake]);
  const numericDur = useMemo(() => Math.max(1, Math.floor(Number(duration || 1))), [duration]);

  const show = (txt: string, type: 'info' | 'success' | 'error' | 'loading' = 'info') =>
    setMsg({ txt, type });

  /* ----------------------- NEW: TETRIS GAME LOGIC ----------------------- */
  
  // Check if a block can move down
  const canMoveDown = (block: Block, container: ContainerState): boolean => {
    const nextRow = block.row + 1;
    // Check if next position is occupied
    if (nextRow >= container.grid[block.column].length) {
      return false; // Would go beyond current grid
    }
    return container.grid[block.column][nextRow] === null;
  };

  // Move all falling blocks down
  const moveBlocksDown = () => {
    setLeftContainer(prev => moveContainerBlocks(prev, 'even'));
    setRightContainer(prev => moveContainerBlocks(prev, 'odd'));
  };

  const moveContainerBlocks = (container: ContainerState, parity: Parity): ContainerState => {
    const newFalling: Block[] = [];
    const newGrid = [...container.grid.map(col => [...col])];
    let totalBlocks = container.totalBlocks;

    // Move each falling block
    for (const block of container.fallingBlocks) {
      if (canMoveDown(block, container)) {
        // Clear old position
        if (newGrid[block.column][block.row]?.id === block.id) {
          newGrid[block.column][block.row] = null;
        }
        
        // Move to new position
        const newRow = block.row + 1;
        newGrid[block.column][newRow] = { ...block, row: newRow };
        newFalling.push({ ...block, row: newRow });
      } else {
        // Block has landed
        newGrid[block.column][block.row] = { ...block, falling: false, fresh: false };
        totalBlocks++;
      }
    }

    // Check for reset
    if (totalBlocks >= MAX_BLOCKS_PER_CONTAINER) {
      show(`${parity.toUpperCase()} container full! Resetting...`, 'info');
      return {
        grid: Array(COLUMNS).fill(null).map(() => []),
        fallingBlocks: [],
        totalBlocks: 0,
      };
    }

    return {
      grid: newGrid,
      fallingBlocks: newFalling,
      totalBlocks,
    };
  };

  // Add a new block at the top
  const addNewBlock = (digit: number) => {
    const parity = digit % 2 === 0 ? 'even' : 'odd';
    const column = Math.floor(Math.random() * COLUMNS); // Random column
    
    const newBlock: Block = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      parity,
      digit,
      column,
      row: 0, // Start at top
      falling: true,
      fresh: true,
    };

    if (parity === 'even') {
      setLeftContainer(prev => {
        const newGrid = [...prev.grid.map(col => [...col])];
        // Ensure column has enough rows
        while (newGrid[column].length <= 0) {
          newGrid[column].push(null);
        }
        newGrid[column][0] = newBlock;
        
        return {
          ...prev,
          grid: newGrid,
          fallingBlocks: [...prev.fallingBlocks, newBlock],
        };
      });
    } else {
      setRightContainer(prev => {
        const newGrid = [...prev.grid.map(col => [...col])];
        while (newGrid[column].length <= 0) {
          newGrid[column].push(null);
        }
        newGrid[column][0] = newBlock;
        
        return {
          ...prev,
          grid: newGrid,
          fallingBlocks: [...prev.fallingBlocks, newBlock],
        };
      });
    }
  };

  // Start falling animation
  useEffect(() => {
    fallIntervalRef.current = setInterval(moveBlocksDown, FALL_SPEED);
    return () => {
      if (fallIntervalRef.current) {
        clearInterval(fallIntervalRef.current);
      }
    };
  }, []);

  /* ----------------------- MODIFIED: pushBlock function ----------------------- */
  const pushBlock = (digit: number) => {
    addNewBlock(digit);
    
    // Remove "fresh" highlight after animation
    setTimeout(() => {
      const parity = digit % 2 === 0 ? 'even' : 'odd';
      if (parity === 'even') {
        setLeftContainer(prev => ({
          ...prev,
          grid: prev.grid.map(col => 
            col.map(block => 
              block && block.fresh ? { ...block, fresh: false } : block
            )
          ),
        }));
      } else {
        setRightContainer(prev => ({
          ...prev,
          grid: prev.grid.map(col => 
            col.map(block => 
              block && block.fresh ? { ...block, fresh: false } : block
            )
          ),
        }));
      }
    }, 500);
  };

  /* ----------------------- LIVE TICKS (WebSocket) - UNCHANGED ------------------------ */
  useEffect(() => {
    isMountedRef.current = true;

    const open = (sym: string) => {
      // Reset containers on symbol change
      setLeftContainer({
        grid: Array(COLUMNS).fill(null).map(() => []),
        fallingBlocks: [],
        totalBlocks: 0,
      });
      setRightContainer({
        grid: Array(COLUMNS).fill(null).map(() => []),
        fallingBlocks: [],
        totalBlocks: 0,
      });
      setLastDigit(null);
      prevTickRef.current = null;

      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }

      const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`);
      wsRef.current = ws;

      ws.onopen = () => {
        show(`Streaming ${MARKET_NAMES[sym] || sym}`, 'info');
        ws.send(
          JSON.stringify({
            ticks_history: sym,
            style: 'ticks',
            count: 1000,
            end: 'latest',
            subscribe: 1,
          })
        );
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;

        const data = JSON.parse(event.data);
        if (data?.error) {
          show(data.error.message || 'WS error', 'error');
          return;
        }

        if (data.msg_type === 'history') {
          const prices: number[] = (data.history?.prices || []).map(Number);
          const last = prices.at(-1);
          if (typeof last === 'number' && Number.isFinite(last)) {
            prevTickRef.current = last;
            const d = lastDigitOf(last, sym);
            if (d !== null) {
              setLastDigit(d);
              pushBlock(d);
            }
          }
          return;
        }

        if (data.msg_type === 'tick') {
          const val = Number(data.tick?.quote);
          if (!Number.isFinite(val)) return;

          const d = lastDigitOf(val, sym);
          if (d !== null) {
            setLastDigit(d);
            pushBlock(d);
          }

          prevTickRef.current = val;
        }
      };

      ws.onerror = () => show('WebSocket error', 'error');
      ws.onclose = () => show('WebSocket closed', 'warning' as any);
    };

    open(symbol);

    return () => {
      isMountedRef.current = false;
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
    };
  }, [symbol]);

  /* ----------------------- Helper functions ------------------------ */
  const lastDigitOf = (val: number, market: string) => {
    const s = formatTickForMarket(val, market);
    const d = parseInt(s.slice(-1), 10);
    return Number.isFinite(d) ? d : null;
  };

  const formatTickForMarket = (val: number, market: string) => {
    if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(market)) return val.toFixed(3);
    if (market === 'R_50' || market === 'R_75') return val.toFixed(4);
    return val.toFixed(2);
  };

  /* ----------------------- Trading functions (UNCHANGED) ------------------------ */
  // ... (keep all your trading functions exactly as they are)
  // buy(), subscribePOC(), forgetPOC(), etc.

  /* ----------------------- RENDER ------------------------ */
  const renderContainer = (container: ContainerState, parity: Parity) => {
    // Find max rows needed
    const maxRows = Math.max(...container.grid.map(col => col.length), 10);
    
    return (
      <div className={`bt-col ${parity}`}>
        <div className={`bt-col-head ${parity}`}>
          {parity === 'even' ? 'EVEN 🟩' : 'ODD 🟥'}
          <div className="bt-count">{container.totalBlocks}/30</div>
        </div>
        <div className="bt-grid">
          {/* Render columns */}
          {Array.from({ length: COLUMNS }).map((_, colIndex) => (
            <div key={colIndex} className="bt-column">
              {Array.from({ length: maxRows }).map((_, rowIndex) => {
                const block = container.grid[colIndex]?.[rowIndex];
                return (
                  <div key={rowIndex} className="bt-cell">
                    {block && (
                      <div className={`bt-block ${block.parity} ${block.falling ? 'falling' : ''} ${block.fresh ? 'fresh' : ''}`}>
                        <span className="bt-d">{block.digit}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="binary-tetris">
      <div className="bt-topbar">
        {/* ... (same as before) */}
      </div>

      <div className="bt-board">
        {renderContainer(leftContainer, 'even')}
        {renderContainer(rightContainer, 'odd')}
      </div>

      <div className="bt-bottom">
        {/* ... (same as before) */}
      </div>

      {/* ... (rest of your component unchanged) */}
    </div>
  );
};

export default BinaryTetris;