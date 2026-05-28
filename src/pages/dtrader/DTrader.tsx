import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useApiBase } from '@/hooks/useApiBase';
import { getDTraderEmbedUrl, syncDTraderSession } from '@/utils/sync-dtrader-session';
import { localize } from '@deriv-com/translations';
import './DTrader.scss';

/**
 * Embeds DTrader from same-origin `/dtrader/` (Deriv core build) when on Denara hosts.
 * Session keys are synced into `client.accounts` before the iframe loads.
 */
const DTrader = observer(() => {
    const { activeLoginid, isAuthorized } = useApiBase();
    const [iframe_src, setIframeSrc] = useState('');
    const [session_ready, setSessionReady] = useState(false);

    const embed_url = useMemo(() => getDTraderEmbedUrl(), []);

    useEffect(() => {
        syncDTraderSession();
        setSessionReady(true);
        setIframeSrc(embed_url);
    }, [embed_url, activeLoginid, isAuthorized]);

    return (
        <div className='dtrader-embed'>
            {session_ready && iframe_src ? (
                <iframe
                    key={`${iframe_src}-${activeLoginid || 'guest'}`}
                    className='dtrader-embed__frame'
                    src={iframe_src}
                    title={localize('DTrader')}
                    allow='fullscreen'
                    referrerPolicy='strict-origin-when-cross-origin'
                />
            ) : (
                <div className='dtrader-embed__loading'>{localize('Please wait, loading DTrader...')}</div>
            )}
        </div>
    );
});

export default DTrader;
