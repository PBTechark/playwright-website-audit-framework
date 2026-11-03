import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useInterval } from '../lib/hooks';

const MAX_CHARS = 400_000;

/** Engine console output. While `live`, new output is fetched incrementally by byte offset. */
export function LogViewer({ auditId, live }: { auditId: string; live: boolean }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const offset = useRef<number | undefined>(undefined);
  const busy = useRef(false);
  const container = useRef<HTMLPreElement>(null);

  const fetchMore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const chunk = await api.log(auditId, offset.current);
      offset.current = chunk.next;
      if (chunk.text) setText((current) => (current + chunk.text).slice(-MAX_CHARS));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      busy.current = false;
    }
  }, [auditId]);

  useEffect(() => {
    offset.current = undefined;
    setText('');
    void fetchMore();
  }, [fetchMore]);

  // One last fetch when the run ends, so the final lines are not missed.
  useEffect(() => {
    if (!live) void fetchMore();
  }, [live, fetchMore]);

  useInterval(() => void fetchMore(), live ? 2000 : null);

  useEffect(() => {
    if (follow && container.current) container.current.scrollTop = container.current.scrollHeight;
  }, [text, follow]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg">Engine log{live ? ', live' : ''}</h2>
          <p className="text-sm text-ink-3">Raw output from the Playwright audit engine.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" className="check" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
          Keep scrolled to the end
        </label>
      </div>
      {error && <p className="field-error mb-2">{error}</p>}
      <pre
        ref={container}
        className="h-96 overflow-auto whitespace-pre-wrap break-all rounded-control bg-[#0b111c] p-5 font-mono text-xs leading-6 text-[#d5dce7] ring-1 ring-inset ring-line focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
        tabIndex={0}
        aria-label="Audit log"
      >
        {text || 'Waiting for output…'}
      </pre>
    </div>
  );
}
