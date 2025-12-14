import { useEffect, useState } from 'react';
import './Deposit.scss';

interface Account {
  loginid: string;
  token: string;
  currency: string;
}

interface Copier {
  token: string;
  loginId: string;
  balance: number;
  currency: string;
  isCopying: boolean;
  socket: WebSocket | null;
}

const Deposit = () => {
  const [traderToken, setTraderToken] = useState<string>('');
  const [traderLoginId, setTraderLoginId] = useState<string>('');
  const [traderBalance, setTraderBalance] = useState<number>(0);
  const [traderCurrency, setTraderCurrency] = useState<string>('USD');
  const [copierTokenInput, setCopierTokenInput] = useState<string>('');
  const [copiers, setCopiers] = useState<Copier[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting');
  const [traderSocket, setTraderSocket] = useState<WebSocket | null>(null);

  // Initialize Trader WebSocket connection
  useEffect(() => {
    const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=36300');
    setTraderSocket(ws);
    setIsLoading(true);

    ws.onopen = () => {
      console.log('Trader WebSocket connected');
      setConnectionStatus('open');

      const accounts: Account[] = JSON.parse(localStorage.getItem('accounts') || '[]');
      const demoAccount = accounts.find(acc => acc.loginid.startsWith('VRT')) || accounts[0];

      if (demoAccount) {
        setTraderToken(demoAccount.token);
        setTraderLoginId(demoAccount.loginid);
        setTraderCurrency(demoAccount.currency);

        ws.send(JSON.stringify({ authorize: demoAccount.token }));
      } else {
        setIsLoading(false);
        console.error('No accounts found in localStorage');
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('Trader WebSocket message:', data);

      if (data.error) {
        console.error('WebSocket error:', data.error);
        return;
      }

      if (data.msg_type === 'authorize') {
        setTraderBalance(data.authorize.balance);
        setTraderCurrency(data.authorize.currency);
        ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        setIsLoading(false);
      }
      else if (data.msg_type === 'balance') {
        setTraderBalance(data.balance.balance);
      }
    };

    ws.onclose = () => {
      setConnectionStatus('closed');
      console.log('Trader WebSocket disconnected');
    };

    ws.onerror = (error) => {
      setConnectionStatus('error');
      console.error('Trader WebSocket error:', error);
      setIsLoading(false);
    };

    const keepAliveInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ping: 1 }));
      }
    }, 120000);

    return () => {
      clearInterval(keepAliveInterval);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, []);

  // Handle copier WebSocket connections
  useEffect(() => {
    return () => {
      copiers.forEach(copier => {
        if (copier.socket && (copier.socket.readyState === WebSocket.OPEN || copier.socket.readyState === WebSocket.CONNECTING)) {
          copier.socket.close();
        }
      });
    };
  }, [copiers]);

  const initializeCopierSocket = (token: string) => {
    const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=36300');

    ws.onopen = () => {
      console.log('Copier WebSocket connected');
      ws.send(JSON.stringify({ authorize: token }));
      setCopiers(prev => prev.map(copier =>
        copier.token === token ? { ...copier, socket: ws } : copier
      ));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('Copier WebSocket message:', data);

      if (data.error) {
        console.error('Copier WebSocket error:', data.error);
        return;
      }

      if (data.msg_type === 'authorize') {
        setCopiers(prev => prev.map(copier =>
          copier.token === token ? {
            ...copier,
            loginId: data.authorize.loginid,
            balance: data.authorize.balance,
            currency: data.authorize.currency,
            isCopying: true
          } : copier
        ));

        // Start copying immediately after authorization
        if (traderToken) {
          ws.send(JSON.stringify({ copy_start: traderToken }));
        }
      }
      else if (data.msg_type === 'balance') {
        setCopiers(prev => prev.map(copier => 
          copier.token === token ? { ...copier, balance: data.balance.balance } : copier
        ));
      }
      else if (data.msg_type === 'copy_start') {
        setCopiers(prev => prev.map(copier =>
          copier.token === token ? { ...copier, isCopying: true } : copier
        ));
      }
      else if (data.msg_type === 'copy_stop') {
        setCopiers(prev => prev.map(copier =>
          copier.token === token ? { ...copier, isCopying: false } : copier
        ));
      }
    };

    ws.onclose = () => {
      console.log('Copier WebSocket disconnected');
      setCopiers(prev => prev.map(copier =>
        copier.token === token ? { ...copier, socket: null } : copier
      ));
    };

    ws.onerror = (error) => {
      console.error('Copier WebSocket error:', error);
    };

    const keepAliveInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ping: 1 }));
      }
    }, 120000);

    ws.onclose = () => {
      clearInterval(keepAliveInterval);
    };

    return ws;
  };

  const addCopier = () => {
    if (!copierTokenInput.trim()) return;

    const newCopier: Copier = {
      token: copierTokenInput,
      loginId: 'Connecting...',
      balance: 0,
      currency: 'USD',
      isCopying: false,
      socket: null
    };

    setCopiers(prev => [...prev, newCopier]);
    initializeCopierSocket(copierTokenInput);
    setCopierTokenInput('');
  };

  const stopCopying = async (copierToken: string) => {
    // Create new WebSocket connection for this operation
    const tempSocket = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=36300');
    
    tempSocket.onopen = () => {
      console.log('Temporary socket opened for stopCopying');
      tempSocket.send(JSON.stringify({ authorize: copierToken }));
      
      // After authorization, send copy_stop
      tempSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.msg_type === 'authorize') {
          tempSocket.send(JSON.stringify({
            copy_stop: traderToken
          }));
          tempSocket.close();
        }
      };
    };

    tempSocket.onerror = (error) => {
      console.error('Temporary socket error:', error);
    };
  };

  const removeCopier = (index: number) => {
    const copierToRemove = copiers[index];
    if (copierToRemove.socket) {
      copierToRemove.socket.close();
    }
    const updatedCopiers = [...copiers];
    updatedCopiers.splice(index, 1);
    setCopiers(updatedCopiers);
  };

  return (
    <div className="copy-trading-dashboard">
      <h1>Copy Trading Dashboard</h1>

      <div className="connection-status">
        Connection:
        <span className={connectionStatus}>
          {connectionStatus.toUpperCase()}
          {connectionStatus === 'connecting' && (
            <span className="loading-dots">
              <span>.</span><span>.</span><span>.</span>
            </span>
          )}
        </span>
      </div>

      <div className="trader-card">
        <h2>Your Trader Account</h2>
        {isLoading ? (
          <p>Loading trader data...</p>
        ) : traderToken ? (
          <>
            <p><strong>Login ID:</strong> {traderLoginId}</p>
            <p><strong>Balance:</strong> {traderBalance.toFixed(2)} {traderCurrency}</p>
          </>
        ) : (
          <p>No trader account found in localStorage</p>
        )}
      </div>

      <div className="copier-management">
        <h2>Manage Copiers</h2>
        <div className="add-copier">
          <input
            type="text"
            value={copierTokenInput}
            onChange={(e) => setCopierTokenInput(e.target.value)}
            placeholder="Enter copier account token"
            disabled={connectionStatus !== 'open'}
          />
          <button
            onClick={addCopier}
            disabled={!copierTokenInput.trim() || connectionStatus !== 'open'}
          >
            Add Copier
          </button>
        </div>

        <div className="copiers-list">
          {copiers.map((copier, index) => (
            <div key={index} className="copier-card">
              <h3>Copier #{index + 1}</h3>
              <p><strong>Login ID:</strong> {copier.loginId}</p>
              <p><strong>Balance:</strong> {copier.balance.toFixed(2)} {copier.currency}</p>
              <p><strong>Status:</strong> 
                {copier.isCopying ? '✅ Copying Active' : '❌ Not Copying'}
              </p>
              <div className="copier-actions">
                <button
                  className="stop-btn"
                  onClick={() => stopCopying(copier.token)}
                >
                  Stop Copy Trading
                </button>
                <button
                  className="remove-btn"
                  onClick={() => removeCopier(index)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Deposit;