import React, { useEffect, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import './DepositTwo.scss';

interface Trader {
  token: string;
  loginId: string;
  isCopying: boolean;
}

const DepositTwo: React.FC = () => {
  const [copierToken, setCopierToken] = useState<string>('');
  const [copierLoginId, setCopierLoginId] = useState<string>('');
  const [copierBalance, setCopierBalance] = useState<number>(0);
  const [copierCurrency, setCopierCurrency] = useState<string>('USD');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [traders, setTraders] = useState<Trader[]>([]);

  // Main copier init + fetch list of traders
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    const loginid = localStorage.getItem('active_loginid');
    if (!token || !loginid) {
      setIsLoading(false);
      return;
    }
    setCopierToken(token);
    setCopierLoginId(loginid);

    const sub = api_base.api.onMessage().subscribe(({ data }: any) => {

      // Copier authorize response
      if (data.msg_type === 'authorize' && data.authorize.loginid === loginid) {
        setCopierBalance(data.authorize.balance);
        setCopierCurrency(data.authorize.currency);
        setIsLoading(false);
        // request copytrading list
        api_base.api.send({ copytrading_list: 1 });
        return;
      }

      // Received list of traders
      if (data.msg_type === 'copytrading_list' && data.copytrading_list) {
        const list = data.copytrading_list.traders || [];
        // Map each trader token and loginid, initial isCopying = true
        setTraders(
          list.map((t: any) => ({
            token: t.token,
            loginId: t.loginid,
            isCopying: true,
          }))
        );
        return;
      }
    });

    // kick off copier authorize
    api_base.api.send({ authorize: token });
    return () => sub.unsubscribe();
  }, []);

  // Stop copying: send copy_stop directly
  const stopCopytrading = (traderToken: string) => {
    api_base.api.send({ copy_stop: traderToken });
    setTraders(prev =>
      prev.map(t =>
        t.token === traderToken ? { ...t, isCopying: false } : t
      )
    );
  };

  return (
    <div className="copier-container">
    <div className="copier-dashboard">
      <h1>Copier Dashboard</h1>

      <div className="copier-card">
        <h2>Your Copier Account</h2>
        {isLoading ? (
          <p className="loading">Loading copier data…</p>
        ) : (
          <>
            <p><strong>Login ID:</strong> {copierLoginId}</p>
            <p><strong>Balance:</strong> {copierBalance.toFixed(2)} {copierCurrency}</p>
          </>
        )}
      </div>

      <div className="trader-management">
        <div className="header">
        <h2 >Traders You’re Copying</h2>
        </div>
        <div className="traders-list">
          {traders.length === 0 && !isLoading && (
            <p>You are copying no traders yet.</p>
          )}
          {traders.map((t, i) => (
            <div key={t.token} className="trader-card">
              <h3>Trader #{i + 1}</h3>
              <p><strong>Login ID:</strong> {t.loginId}</p>
              <p><strong>Status:</strong> {t.isCopying ? '✅ Active' : '❌ Stopped'}</p>
              <button onClick={() => stopCopytrading(t.token)} disabled={!t.isCopying}>
                Stop Copytrading
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
};

export default DepositTwo;
