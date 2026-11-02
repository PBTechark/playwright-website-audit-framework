import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuditRecord } from './api';
import { api } from './api';

/** Starts a new audit with a previous audit's settings and opens its progress screen. */
export function useRerun(): { rerun: (audit: AuditRecord) => Promise<void>; rerunError: string | null; rerunning: boolean } {
  const navigate = useNavigate();
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);

  async function rerun(audit: AuditRecord) {
    setRerunning(true);
    setRerunError(null);
    try {
      const started = await api.rerun(audit.id);
      navigate(`/audits/${started.id}`);
    } catch (reason) {
      setRerunError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRerunning(false);
    }
  }

  return { rerun, rerunError, rerunning };
}
