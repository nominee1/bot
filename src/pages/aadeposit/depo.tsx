import { useEffect, useState } from 'react';
import './Deposit.scss';

interface Account {
  [key: string]: string;
}

const Deposit = () => {
  const [clientLoginId, setClientLoginId] = useState<string>('');
  const [balance, setBalance] = useState<number>(0);
  const [usdToKes, setUsdToKes] = useState<number | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [currency, setCurrency] = useState<'USD' | 'KES'>('USD');
  const [transactions, setTransactions] = useState<Array<{
    id: number;
    amount: number;
    currency: string;
    date: string;
    type: 'deposit' | 'withdrawal';
  }>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [transferStatus, setTransferStatus] = useState<string>('');

  const PAYMENT_AGENT_TOKEN = 'rjGGpySixdypL5h';

  // Fetch balance and login ID
  useEffect(() => {
    const fetchClientData = async () => {
      try {
        const accountsList: Account = JSON.parse(localStorage.getItem('accountsList') || '{}');
        const activeLoginId = localStorage.getItem('active_loginid') || '';

        if (!activeLoginId || !accountsList[activeLoginId]) {
          throw new Error('No active account found');
        }

        setClientLoginId(activeLoginId);

        const token = accountsList[activeLoginId];

        const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=36300');
        ws.onopen = () => {
          ws.send(JSON.stringify({ authorize: token }));
        };
        ws.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          if (data.msg_type === 'authorize') {
            ws.send(JSON.stringify({ balance: 1 }));
          } else if (data.msg_type === 'balance') {
            setBalance(data.balance.balance);
            ws.close();
          } else if (data.error) {
            console.error('Deriv API Error:', data.error.message);
            ws.close();
          }
        };
      } catch (err) {
        console.error("Error fetching client data:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchClientData();
  }, []);

  // Fetch USD to KES
  useEffect(() => {
    const fetchExchangeRate = async () => {
      try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await res.json();
        if (data.result === 'success') setUsdToKes(data.rates.KES);
      } catch (err) {
        console.error("Failed to fetch exchange rate", err);
      }
    };
    fetchExchangeRate();
  }, []);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(e.target.value);
  };

  const handleTransfer = () => {
    setTransferStatus('Transferring...');
    const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=36300');

    ws.onopen = () => {
      ws.send(JSON.stringify({ authorize: PAYMENT_AGENT_TOKEN }));
    };

    ws.onmessage = (event) => {
      const response = JSON.parse(event.data);

      if (response.msg_type === 'authorize') {
        // Now send transfer request
        ws.send(JSON.stringify({
          paymentagent_transfer: 1,
          transfer_to: clientLoginId,
          currency: 'USD',
          amount: parseFloat(amount),
          description: 'Payment from agent'
        }));
      }

      if (response.msg_type === 'paymentagent_transfer') {
        setTransferStatus(`✅ Transfer successful: ${response.paymentagent_transfer.amount_transferred} ${response.paymentagent_transfer.currency}`);
        ws.close();
      }

      if (response.error) {
        setTransferStatus(`❌ Error: ${response.error.message}`);
        ws.close();
      }
    };

    ws.onerror = () => {
      setTransferStatus('❌ Connection error.');
    };
  };

  // Mock history
  useEffect(() => {
    setTransactions([
      { id: 1, amount: 100, currency: 'USD', date: '2024-05-01', type: 'deposit' },
      { id: 2, amount: 50, currency: 'USD', date: '2024-05-02', type: 'withdrawal' },
    ]);
  }, []);

  return (
    <div className="dashboard">
      <header>
        <h1>Payment Agent Dashboard</h1>
        {isLoading ? (
          <div className="client-info loading">Loading account data...</div>
        ) : (
          <div className="client-info">
            <span>Client ID: <strong>{clientLoginId}</strong></span>
            <span>Balance: <strong>{balance.toFixed(2)} USD</strong></span>
          </div>
        )}
      </header>

      <div className="exchange-rate">
        <h3>Exchange Rate</h3>
        {usdToKes ? (
          <p>1 USD = {usdToKes.toFixed(2)} KES</p>
        ) : (
          <p>Loading rates...</p>
        )}
      </div>

      <div className="transfer-section">
        <h3>Transfer Funds</h3>
        <div className="amount-input">
          <label>
            Amount ({currency}):
            <input
              type="number"
              value={amount}
              onChange={handleAmountChange}
              placeholder={`Enter amount in ${currency}`}
            />
          </label>
          <div className="converted-amount">
            {amount && usdToKes && (
              <span>
                ≈ {currency === 'USD'
                  ? (parseFloat(amount) * usdToKes).toFixed(2) + ' KES'
                  : (parseFloat(amount) / usdToKes).toFixed(2) + ' USD'}
              </span>
            )}
          </div>
        </div>
        <button className="transfer-button" onClick={handleTransfer}>Initiate Transfer</button>
        {transferStatus && <p className="transfer-status">{transferStatus}</p>}
      </div>

      <div className="transactions">
        <h3>Recent Transactions</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Amount</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((txn) => (
              <tr key={txn.id}>
                <td>{txn.date}</td>
                <td>{txn.amount} {txn.currency}</td>
                <td className={`type-${txn.type}`}>{txn.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Deposit;
