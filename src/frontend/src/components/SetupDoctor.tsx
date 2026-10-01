import React, { useCallback, useEffect, useState } from 'react';
import { createBackup, Diagnostics, getAssistantConfig, getDiagnostics, pullModel, sendAssistantChat } from '../lib/api';
import { useUpdateRunner } from '../lib/useUpdate';
import { Icon } from '../components/Icon';
import { Button, InlineNotice, StatusDot } from '../components/ui';

export type SettingsSection = 'assistant' | 'web-search' | 'advanced' | 'your-data' | 'sources' | 'mobile' | 'doctor';

const TONES: Record<Diagnostics['checks'][number]['level'], 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  warn: 'warning',
  fail: 'danger',
};

interface SetupDoctorProps {
  /** Reuse the restore flow in Settings so the confirmation is worded once. */
  onRestore: (name: string) => Promise<void>;
  onOpenSection: (section: SettingsSection) => void;
  onToast: (message: string, type?: 'success' | 'error') => void;
}

/* The app's own health report, and the fixes that can be done from here.
   Every level and every sentence comes from the backend: this component decides
   nothing about what is wrong, it only renders the answer and wires the buttons. */
const SetupDoctor: React.FC<SetupDoctorProps> = ({ onRestore, onOpenSection, onToast }) => {
  const [report, setReport] = useState<Diagnostics | null>(null);
  const updater = useUpdateRunner({ currentVersion: report?.app_version, onMessage: onToast });
  const [loading, setLoading] = useState(false);
  const [pullModelName, setPullModelName] = useState('');
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [busyFix, setBusyFix] = useState('');

  const check = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await getDiagnostics());
    } catch (caught) {
      setReport(null);
      onToast(caught instanceof Error ? caught.message : 'The health check could not run.', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void check();
  }, [check]);

  /* While a model is downloading, keep asking until the report says it arrived,
     then stop — there is nothing else to poll. */
  useEffect(() => {
    if (!pullModelName) return;
    if (report?.assistant.model_available) {
      setPullModelName('');
      return;
    }
    const timer = window.setInterval(() => { void check(); }, 5000);
    return () => window.clearInterval(timer);
  }, [pullModelName, report?.assistant.model_available, check]);

  /* The update itself lives in a hook, because the Overview offers the same
     button on a screen that has none of this report's state. */
  const runFix = async (fix: NonNullable<Diagnostics['checks'][number]['fix']>) => {
    setBusyFix(fix.kind + (fix.name ?? fix.model ?? ''));
    try {
      if (fix.kind === 'restore' && fix.name) {
        await onRestore(fix.name);
        return;
      }
      if (fix.kind === 'backup_now') {
        const result = await createBackup();
        onToast(result.backup ? `Copied your catalog to ${result.backup.name}.` : 'There is nothing to copy yet.', result.backup ? 'success' : 'error');
        await check();
        return;
      }
      if (fix.kind === 'download_model' && fix.model) {
        await pullModel(fix.model);
        onToast(`Downloading ${fix.model}. This can take a few minutes.`);
        await check();
        return;
      }
      if (fix.kind === 'update') {
        await updater.request();
        return;
      }
      if (fix.kind === 'open_settings' && fix.section) {
        onOpenSection(fix.section as SettingsSection);
        return;
      }
    } catch (caught) {
      onToast(caught instanceof Error ? caught.message : 'That fix did not work.', 'error');
    } finally {
      setBusyFix('');
    }
  };

  /* The whole "let the assistant help" feature: send the report as a chat message
     and print what comes back. No tool calls, no writes, no new permissions — the
     assistant explains the report, it does not act on it.

     It is sent as a digest, not the raw report: a chat message is capped, and the
     log tail is the one part that is both the longest and the least useful for an
     explanation. The log can be shortened further if a model's limit is small. */
  const explain = async () => {
    if (!report) return;
    setExplaining(true);
    setExplanation('');
    try {
      const config = await getAssistantConfig();
      /* No log tail: it is the longest part of the report and a small model reads
         it as evidence of problems that are not in the checks. */
      const digest = {
        app_version: report.app_version,
        platform: report.platform,
        database_state: report.database_state,
        counts: report.counts,
        assistant: report.assistant,
        research: report.research,
        checks: report.checks,
        /* Only when a repair actually happened: a null here is "nothing went
           wrong", and a small model reads a bare null as a broken field. */
        ...(report.catalog_recovery ? { catalog_recovery: report.catalog_recovery } : {}),
      };
      const result = await sendAssistantChat({
        runtime: config.runtime,
        session_id: crypto.randomUUID(),
        messages: [{
          role: 'user',
          content: `AudioBiblica is my local studio app and something is not working. Here is its own health report. Explain in plain language what is wrong and the exact next thing I should do. Use only what is in the report; if it does not say, say you do not know.\n\n${JSON.stringify(digest, null, 2)}`,
        }],
      });
      setExplanation(result.answer);
    } catch (caught) {
      setExplanation(caught instanceof Error ? caught.message : 'The assistant could not answer.');
    } finally {
      setExplaining(false);
    }
  };

  const copyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      onToast('Health report copied.');
    } catch {
      onToast('The report could not be copied.', 'error');
    }
  };

  /* The headline tone is the worst tone any check reported, and it is also the
     key used to look that tone up — so it is typed as a key, not a colour. */
  const worst: keyof typeof TONES = report?.checks.some((entry) => entry.level === 'fail')
    ? 'fail'
    : report?.checks.some((entry) => entry.level === 'warn') ? 'warn' : 'ok';
  const summary = !report
    ? 'Run a check to see how AudioBiblica is doing.'
    : worst === 'fail'
      ? 'Something needs fixing before the assistant and your catalog work reliably.'
      : worst === 'warn'
        ? 'AudioBiblica works, but a few things would work better with attention.'
        : 'Everything AudioBiblica checks is working.';

  return (
    <section className="settings-section" aria-labelledby="doctor-heading">
      <div className="settings-section-header">
        <div>
          <h2 id="doctor-heading">Check my setup</h2>
          <p>AudioBiblica inspects itself and offers the fix where there is one. Nothing leaves this computer.</p>
        </div>
      </div>

      <div className="form-actions" style={{ marginBlockEnd: 14 }}>
        <Button variant="secondary" icon="activity" onClick={() => void check()} disabled={loading}>
          {loading ? 'Checking…' : 'Check again'}
        </Button>
        <StatusDot tone={report ? TONES[worst] : 'neutral'} label={report ? summary : 'Not checked'} />
      </div>

      {!report && !loading && <p className="field-help">The health check could not run. Try again in a moment.</p>}

      {report && (
        <>
          <ul className="doctor-list">
            {report.checks.map((entry) => (
              <li key={entry.id}>
                <StatusDot tone={TONES[entry.level]} />
                <div>
                  <strong>{entry.title}</strong>
                  <p>{entry.detail}</p>
                </div>
                {entry.fix && (
                  <Button
                    size="sm"
                    variant={entry.level === 'fail' ? 'primary' : 'ghost'}
                    disabled={busyFix !== '' || pullModelName !== '' || updater.updating}
                    onClick={() => void runFix(entry.fix!)}
                  >
                    {entry.fix.label}
                  </Button>
                )}
              </li>
            ))}
          </ul>

          {pullModelName && !report.assistant.model_available && (
            <InlineNotice tone="info" icon="download">Downloading {pullModelName}. This page updates itself when it is ready.</InlineNotice>
          )}

          {updater.updating && (
            <InlineNotice tone="info" icon="download">
              Updating AudioBiblica. The app is downloading the new version and restarting itself; this page reloads on its own when the new version answers.
            </InlineNotice>
          )}

          <div className="form-actions" style={{ marginBlockStart: 14 }}>
            <Button variant="secondary" icon="sparkles" onClick={() => void explain()} disabled={explaining || !report.assistant.reachable}>
              {explaining ? 'Asking…' : 'Ask the assistant to explain this'}
            </Button>
            <Button variant="ghost" icon="copy" onClick={() => void copyReport()}>Copy report</Button>
          </div>
          {!report.assistant.reachable && (
            <p className="field-help">The assistant is unreachable, so it cannot explain the report yet. The first check explains why.</p>
          )}

          {explanation && (
            <InlineNotice tone="info" icon="sparkles">
              <span style={{ whiteSpace: 'pre-wrap' }}>{explanation}</span>
            </InlineNotice>
          )}

          <dl className="doctor-facts">
            <div><dt>Version</dt><dd>{report.app_version}</dd></div>
            <div><dt>Catalog</dt><dd style={{ overflowWrap: 'anywhere' }}>{report.database_path}</dd></div>
            <div><dt>Devices / manuals / findings</dt><dd>{report.counts.equipment === null ? 'unknown — the catalog could not be read' : `${report.counts.equipment} / ${report.counts.manuals} / ${report.counts.findings}`}</dd></div>
            <div><dt>Assistant</dt><dd>{report.assistant.runtime} · {report.assistant.model}</dd></div>
            <div><dt>Copies of your catalog</dt><dd>{report.backups.length}</dd></div>
          </dl>

          <details className="doctor-errors">
            <summary><Icon name="file" size={15} />Recent log lines ({report.recent_errors.length})</summary>
            <pre>{report.recent_errors.length > 0 ? report.recent_errors.join('\n') : 'Nothing has been logged yet.'}</pre>
          </details>
        </>
      )}
    </section>
  );
};

export default SetupDoctor;
