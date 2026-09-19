import { useCallback, useEffect, useState } from 'react';
import pwaManager from '@/utils/pwa-utils';

const isAndroidChrome = () => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    return /Android/i.test(ua) && /Chrome|Chromium|EdgA|SamsungBrowser/i.test(ua);
};

export const usePwaInstall = () => {
    const [canInstall, setCanInstall] = useState(() => pwaManager.canInstall());
    const [installed, setInstalled] = useState(() => pwaManager.isInstalled());

    useEffect(() => {
        setInstalled(pwaManager.isInstalled());
        setCanInstall(pwaManager.canInstall());
        return pwaManager.onInstallStateChange(next => {
            setCanInstall(next);
            setInstalled(pwaManager.isInstalled());
        });
    }, []);

    const install = useCallback(async () => {
        const ok = await pwaManager.showInstallPrompt();
        if (ok) setInstalled(true);
        return ok;
    }, []);

    return {
        canInstall: canInstall && !installed,
        showInstall: !installed && (canInstall || isAndroidChrome()),
        installed,
        install,
    };
};
