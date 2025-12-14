import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useApiBase } from '@/hooks/useApiBase';

const CallContractExecutor = observer(() => {
    const { self_exclusion } = useStore();
    const { authData, accountList, activeLoginid, isAuthorized } = useApiBase();

    const [isExecuting, setIsExecuting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [ws, setWs] = useState<WebSocket | null>(null);

    // Get current account currency
    const currentAccount = accountList?.find(acc => acc.loginid === activeLoginid);
    const currency = currentAccount?.currency;

    // Setup WebSocket
    useEffect(() => {
        const socket = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=YOUR_APP_ID');
        setWs(socket);

        return () => {
            socket.close();
        };
    }, []);

    const executeCallContract = async () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            setError('WebSocket not connected.');
            return;
        }

        if (!isAuthorized || !authData?.token) {
            setError('You are not authorized.');
            return;
        }

        if (!currency) {
            setError('Active account currency not found.');
            return;
        }

        if (isExecuting) return;

        setIsExecuting(true);
        setError(null);
        setSuccess(false);

        try {
            await self_exclusion.checkRestriction();
            if (!self_exclusion.should_bot_run) {
                throw new Error('Trading restrictions prevent execution.');
            }

            // 1. Authorize with token
            ws.send(JSON.stringify({ authorize: authData.token }));

            // 2. Handle messages
            ws.onmessage = (msg) => {
                const response = JSON.parse(msg.data);

                if (response.msg_type === 'authorize') {
                    const buyRequest = {
                        buy: 1,
                        price: 10,
                        parameters: {
                            amount: 10,
                            basis: 'stake',
                            contract_type: 'CALL',
                            currency: currency,
                            duration: 1,
                            duration_unit: 't',
                            symbol: 'R_100',
                        }
                    };

                    ws.send(JSON.stringify(buyRequest));
                }

                if (response.msg_type === 'buy') {
                    console.log('✅ Buy successful:', response);
                    setIsExecuting(false);
                    setSuccess(true);
                    ws.onmessage = null;
                }

                if (response.error) {
                    throw new Error(response.error.message);
                }
            };

        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Unknown error.');
            setIsExecuting(false);
        }
    };

    return (
        <div className='call-contract-executor'>
            <h2>Execute CALL Contract</h2>
            <p>Stake: 10 | Duration: 1 tick | Market: R_100</p>

            <button
                onClick={executeCallContract}
                disabled={isExecuting || !isAuthorized}
                className='dc-btn dc-btn--primary'
            >
                {isExecuting ? 'Executing...' : 'Execute Contract'}
            </button>

            {error && <div className='error-message'>{error}</div>}
            {success && <div className='success-message'>Contract executed successfully!</div>}
        </div>
    );
});

export default CallContractExecutor;
