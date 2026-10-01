import React, { useCallback, useEffect, useState } from 'react';
import {
  clearResearchProviderKey,
  listResearchProviders,
  ResearchProvider,
  saveResearchProviderKey,
  testResearchProvider,
} from '../lib/api';
import { Button, InlineNotice, StatusDot } from './ui';

/* Which services research may use, and where to paste a key for each.
 *
 * The point of showing every service — including the ones with no key at all — is that a musician can
 * see what the app can already do, what a key would add, and which of their questions are waiting on
 * one. A missing key is answered honestly, never with a silent empty result. */

interface ResearchSourcesProps {
  onToast: (message: string, type?: 'success' | 'error') => void;
}

const ResearchSources: React.FC<ResearchSourcesProps> = ({ onToast }) => {
  const [providers, setProviders] = useState<ResearchProvider[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { status: string; detail: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProviders(await listResearchProviders());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read the list of services.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (provider: ResearchProvider) => {
    const key = (drafts[provider.id] ?? '').trim();
    if (!key) return;
    setBusy(provider.id);
    try {
      await saveResearchProviderKey(provider.id, key);
      setDrafts((current) => ({ ...current, [provider.id]: '' }));
      await refresh();
      onToast(`${provider.label} saved.`);
    } catch (caught) {
      onToast(caught instanceof Error ? caught.message : 'Could not save that key.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const forget = async (provider: ResearchProvider) => {
    setBusy(provider.id);
    try {
      await clearResearchProviderKey(provider.id);
      await refresh();
      setResults((current) => {
        const next = { ...current };
        delete next[provider.id];
        return next;
      });
    } catch (caught) {
      onToast(caught instanceof Error ? caught.message : 'Could not remove that key.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const test = async (provider: ResearchProvider) => {
    setBusy(provider.id);
    try {
      const result = await testResearchProvider(provider.id);
      setResults((current) => ({ ...current, [provider.id]: result }));
    } catch (caught) {
      setResults((current) => ({
        ...current,
        [provider.id]: { status: 'error', detail: caught instanceof Error ? caught.message : 'That did not work.' },
      }));
    } finally {
      setBusy(null);
    }
  };

  const toneFor = (status: string): 'success' | 'warning' | 'danger' | 'neutral' =>
    status === 'ok' || status === 'always' ? 'success' : status === 'untested' ? 'neutral' : 'warning';

  if (error) {
    return (
      <section className="settings-section" aria-labelledby="sources-heading">
        <div className="settings-section-header"><div><h2 id="sources-heading">Research sources</h2></div></div>
        <InlineNotice tone="danger">{error}</InlineNotice>
      </section>
    );
  }

  return (
    <section className="settings-section" aria-labelledby="sources-heading">
      <div className="settings-section-header">
        <div>
          <h2 id="sources-heading">Research sources</h2>
          <p>
            What a research run may read. The first four need nothing; the rest are keys you bring, and
            they are stored on this computer only — never sent anywhere except the service they belong to.
          </p>
        </div>
      </div>

      <div className="research-plan">
        {providers.map((provider) => (
          <div className="provider-row" key={provider.id}>
            <div className="provider-copy">
              <strong>
                <StatusDot
                  tone={provider.configured ? 'success' : provider.keyless ? 'neutral' : 'warning'}
                  label={provider.configured ? 'Ready' : provider.keyless ? 'Always available' : 'Needs a key'}
                />
                {provider.label}
              </strong>
              <p>{provider.unlocks}</p>
              {provider.borrowed_from === 'assistant' && (
                <p className="field-help">
                  Uses the key already saved in <strong>Assistant</strong> above, so there is nothing to add here.
                </p>
              )}
              {results[provider.id] && (
                <p className="provider-status">
                  <StatusDot tone={toneFor(results[provider.id].status)} />
                  {results[provider.id].detail}
                </p>
              )}
            </div>

            <div className="provider-key">
              {provider.key_here && (
                <>
                  <label className="sr-only" htmlFor={`key-${provider.id}`}>{provider.label} key</label>
                  <input
                    id={`key-${provider.id}`}
                    type="password"
                    autoComplete="off"
                    placeholder={provider.configured ? 'A key is saved' : 'Paste a key'}
                    value={drafts[provider.id] ?? ''}
                    disabled={busy === provider.id}
                    onChange={(event) => setDrafts((current) => ({ ...current, [provider.id]: event.target.value }))}
                    onKeyDown={(event) => { if (event.key === 'Enter') void save(provider); }}
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy === provider.id || !(drafts[provider.id] ?? '').trim()}
                    onClick={() => void save(provider)}
                  >
                    Save
                  </Button>
                  {provider.configured && (
                    <Button size="sm" variant="ghost" icon="x" disabled={busy === provider.id} onClick={() => void forget(provider)}>
                      Remove
                    </Button>
                  )}
                </>
              )}
              {provider.testable && provider.configured && !provider.keyless && (
                <Button size="sm" variant="secondary" icon="check" disabled={busy === provider.id} onClick={() => void test(provider)}>
                  Test
                </Button>
              )}
              {provider.docs && (
                <a className="field-help" href={provider.docs} target="_blank" rel="noreferrer">Get a key</a>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default ResearchSources;
