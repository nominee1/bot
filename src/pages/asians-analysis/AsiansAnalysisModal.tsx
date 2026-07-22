import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import AsiansAnalysisPanel from './AsiansAnalysisPanel';
import './asiansAnalysis.scss';

export type TAsiansAnalysisModalProps = {
    open: boolean;
    onClose: () => void;
};

export default function AsiansAnalysisModal({ open, onClose }: TAsiansAnalysisModalProps) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    return createPortal(
        <div className='asians-analysis' role='dialog' aria-modal='true' aria-labelledby='asians-analysis-title'>
            <button type='button' className='asians-analysis__backdrop' aria-label='Close' onClick={onClose} />
            <AsiansAnalysisPanel active={open} onClose={onClose} />
        </div>,
        document.body
    );
}
