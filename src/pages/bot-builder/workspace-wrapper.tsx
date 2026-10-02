import React from 'react';
import { observer } from 'mobx-react-lite';
import Flyout from '@/components/flyout';
import { useStore } from '@/hooks/useStore';
import StopBotModal from '../dashboard/stop-bot-modal';
import Toolbar from './toolbar';
import Toolbox from './toolbox';
import './workspace.scss';

const WorkspaceWrapper = observer(() => {
    const { blockly_store } = useStore();
    const { onMount, onUnmount, is_loading } = blockly_store;
    // window.Blockly.derivWorkspace is not MobX-observable — mirror readiness when loading flips.
    const [has_workspace, setHasWorkspace] = React.useState(() => Boolean(window.Blockly?.derivWorkspace));

    React.useEffect(() => {
        onMount();
        return () => {
            onUnmount();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useEffect(() => {
        if (!is_loading) {
            setHasWorkspace(Boolean(window.Blockly?.derivWorkspace));
        }
    }, [is_loading]);

    if (is_loading) return null;

    if (has_workspace)
        return (
            <React.Fragment>
                <Toolbox />
                <Toolbar />
                <Flyout />
                <StopBotModal />
            </React.Fragment>
        );

    return null;
});

export default WorkspaceWrapper;
