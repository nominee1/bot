import AsiansAnalysisPanel from './AsiansAnalysisPanel';
import './asiansAnalysis.scss';

/**
 * Full-page Asians Path Lab (main tab), same pattern as Risk Calculator / Instant Fill.
 * Tabs only mount the active child, so scanning stays on while this page is visible.
 */
export default function AsiansAnalysisPage() {
    return (
        <div className='asians-analysis-page tutorials-wrapper tutorials-wrapper--asians-path-lab'>
            <AsiansAnalysisPanel active page />
        </div>
    );
}
