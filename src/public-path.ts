export const getUrlBase = (path = '') => {
    const l = window.location;
    const prefix = l.pathname.split('/').filter(Boolean)[0] || '';

    if (prefix !== 'bot' && !/^br_/.test(prefix)) return path;

    const get_path = path.startsWith('/') ? path : `/${path}`;
    return `/${prefix}${get_path}`;
};

/** Absolute asset prefix for `/bot` embed — must end with `/` so async chunks resolve. */
export function resolveBotAssetPrefix(): string {
    try {
        const prefix = window.location.pathname.split('/').filter(Boolean)[0] || '';
        if (prefix === 'bot' || /^br_/.test(prefix)) {
            return `/${prefix}/`;
        }
    } catch {
        /* ignore */
    }
    return getUrlBase('/') || '/';
}

declare let __webpack_public_path__: string;

export function setBotPublicPath(path: string) {
    const normalized = path.endsWith('/') ? path : `${path}/`;
    // Magic assignment — rspack/webpack rewrites this to update the runtime public path (`s.p`).
    __webpack_public_path__ = normalized; // eslint-disable-line no-global-assign
    window.__webpack_public_path__ = __webpack_public_path__;
}

export const getImageLocation = (image_name: string) => `assets/images/${image_name}`;

declare global {
    interface Window {
        Survicate?: {
            track: (attribute: string, value: string) => void;
        };
    }
}

const setSurvicateUserAttributes = (country: string, type: string, creationDate: string) => {
    if (window.Survicate) {
        if (country) window.Survicate.track('userCountry', country);
        if (type) window.Survicate.track('accountType', type);
        if (creationDate) window.Survicate.track('accountCreationDate', creationDate);
    }
};

let initSurvicateCalled = false;
const setSurvicateCalledValue = (value: boolean) => {
    initSurvicateCalled = value;
};

const loadSurvicateScript = (callback: () => void) => {
    const script = document.createElement('script');
    script.id = 'dbot-survicate';
    script.async = true;
    script.src = 'https://survey.survicate.com/workspaces/83b651f6b3eca1ab4551d95760fe5deb/web_surveys.js';
    script.onload = callback;

    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript?.parentNode) {
        firstScript.parentNode.insertBefore(script, firstScript);
    } else {
        document.body.appendChild(script);
    }
};

const initSurvicate = () => {
    if (initSurvicateCalled) return;
    setSurvicateCalledValue(true);
    const active_loginid = localStorage.getItem('active_loginid');
    const client_accounts = JSON.parse(localStorage.getItem('accountsList') as string) || undefined;
    const setAttributesIfAvailable = () => {
        if (active_loginid && client_accounts) {
            const { residence, account_type, created_at } = client_accounts[active_loginid] || {};
            setSurvicateUserAttributes(residence, account_type, created_at);
        }
    };

    if (document.getElementById('dbot-survicate')) {
        const survicateBox = document.getElementById('survicate-box');
        if (survicateBox) {
            survicateBox.style.display = 'block';
        }
        setAttributesIfAvailable();
    } else {
        loadSurvicateScript(setAttributesIfAvailable);
    }
};

export { initSurvicate, setSurvicateCalledValue };

/** Keep `/bot/` trailing slash so relative async chunks resolve under `/bot/static/…`. */
function ensureBotTrailingSlash() {
    try {
        const { pathname, search, hash } = window.location;
        if (pathname === '/bot') {
            window.history.replaceState({}, '', `/bot/${search}${hash}`);
        }
    } catch {
        /* ignore */
    }
}

ensureBotTrailingSlash();
setBotPublicPath(resolveBotAssetPrefix());
// Re-assert after other scripts — `assetPrefix: 'auto'` can reset to `/` when currentScript is null.
if (typeof window !== 'undefined') {
    queueMicrotask(() => setBotPublicPath(resolveBotAssetPrefix()));
    window.addEventListener('load', () => setBotPublicPath(resolveBotAssetPrefix()));
}
