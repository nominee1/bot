// DirectOracleV1Loader.tsx
import React from 'react';
import { observer } from 'mobx-react-lite';
import Button from '@/components/shared_ui/button';
import { useStore } from '@/hooks/useStore';
import oracle from './../../xml/oracleV2.xml';

const DirectOracleV1Loader: React.FC = observer(() => {
  const { blockly_store } = useStore();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const importXmlDirect = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const importer =
        (blockly_store as any).importFromXml ??
        (blockly_store as any).loadXml ??
        (blockly_store as any).hydrateFromXml ??
        (blockly_store as any).loadWorkspaceFromXml;

      if (typeof importer !== 'function') {
        throw new Error(
          'No XML import method found on blockly_store (expected importFromXml/loadXml/hydrateFromXml).'
        );
      }

      if (typeof (blockly_store as any).resetWorkspace === 'function') {
        await (blockly_store as any).resetWorkspace();
      }

      await importer.call(blockly_store, oracleXml);
      // At this point the workspace should be populated
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [blockly_store]);

  return (
    <div className="direct-xml-loader">
      <Button
        text={busy ? 'Loading…' : 'Load Oracle v1'}
        onClick={importXmlDirect}
        primary
        large
        has_effect
        disabled={busy}
        data-testid="dt-load-oraclev1-direct"
      />
      {error && (
        <div
          className="direct-xml-loader__error"
          role="alert"
          style={{ marginTop: 8, fontSize: 12, color: '#b00020' }}
        >
          {error}
        </div>
      )}
    </div>
  );
});

export default DirectOracleV1Loader;
