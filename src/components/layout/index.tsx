import clsx from 'clsx';
import { Outlet } from 'react-router-dom';
import { useDevice } from '@deriv-com/ui';
import DenaraCompetitionProfileFab from '@/components/denara-competition-profile-fab/denara-competition-profile-fab';
import Footer from './footer';
import AppHeader from './header';
import Body from './main-body';
import './layout.scss';

const Layout = () => {
    const { isDesktop } = useDevice();

    const isCallbackPage = window.location.pathname === '/callback';
    return (
        <div className={clsx('layout', { responsive: isDesktop })}>
            {!isCallbackPage && <AppHeader />}
            <Body>
                <Outlet />
            </Body>
            {!isCallbackPage && isDesktop && <Footer />}
            {!isCallbackPage && <DenaraCompetitionProfileFab />}
        </div>
    );
};

export default Layout;
