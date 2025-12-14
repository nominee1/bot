import { useEffect } from 'react';
import { AuthCtx }   from '@/hooks/useAuth';
import { api_base }  from '@/external/bot-skeleton';

export default function AuthProvider({ children }: {children:React.ReactNode}) {
  // pull token & login id from your AuthManager or sessionStorage
  const token   = sessionStorage.getItem('evenOddAuthToken') ?? undefined;
  const loginid = sessionStorage.getItem('evenOddLoginId')  ?? undefined;

  useEffect(() => {
    if (!token) return;
    (async ()=> {
      try {
        await api_base.api.send({ authorize: token });
        console.info('Authorised OK');
      } catch (e) {
        console.error('Auth failed', e);
      }
    })();
  }, [token]);

  return (
    <AuthCtx.Provider value={{token, loginid}}>
      {children}
    </AuthCtx.Provider>
  );
}
