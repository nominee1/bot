// src/hooks/useDerivUserSync.ts
import { useEffect, useRef } from 'react';
import { saveDerivUser } from '@/hooks/api/saveDerivUser';

export function useDerivUserSync(appId: number) {
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;

    type StoredAcc = { loginid: string; token: string };
    const accounts: StoredAcc[] = JSON.parse(
      localStorage.getItem('accounts') ?? '[]'
    );
    const activeId = localStorage.getItem('activeLoginId');
    const active = accounts.find((a) => a.loginid === activeId);
    if (!active?.token) return;

    const ws = new WebSocket(
      `wss://ws.derivws.com/websockets/v3?app_id=${appId}`
    );

    ws.onopen = () => {
      ws.send(JSON.stringify({ authorize: active.token }));
    };

    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.msg_type !== 'authorize' || doneRef.current) return;

      const { email, loginid, fullname } = data.authorize;
      saveDerivUser({
        email,
        loginId: loginid,
        fullName: (fullname || '').trim(),
      }).catch(console.error);

      doneRef.current = true;
      ws.close();
    };

    ws.onerror = console.error;
    return () => ws.close();
  }, [appId]);
}
