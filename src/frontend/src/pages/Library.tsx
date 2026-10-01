import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addManual, batchUpdateEquipment, createEquipment, deleteEquipment, deleteManual, deletePhoto, Equipment, listEquipment, Manual, updateEquipment, uploadManualPdf, getApiBaseUrl } from '../lib/api';
import { Icon } from '../components/Icon';
import { Dropdown } from '../components/Dropdown';
import SendToEasySchematic from '../components/SendToEasySchematic';
import { Button, EmptyState, InlineNotice, PageHeader, Surface } from '../components/ui';

type ViewMode = 'grid' | 'table';

type EquipmentForm = {
  name: string;
  manufacturer: string;
  model: string;
  category: string;
  description: string;
};

const blankForm: EquipmentForm = { name: '', manufacturer: '', model: '', category: 'Other', description: '' };

const categories = ['All categories', 'Microphone', 'Console', 'Outboard', 'Instrument', 'Monitor', 'Interface', 'Other'];

const formatSpecValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const EquipmentDrawer: React.FC<{
  equipment: Equipment;
  onClose: () => void;
  onUpdated: (equipment: Equipment) => void;
}> = ({ equipment, onClose, onUpdated }) => {
  const specifications = Object.entries(equipment.specifications ?? {});
  const findings = equipment.research_findings ?? [];
  const [linking, setLinking] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'danger' | 'success'>('danger');
  const fileInput = useRef<HTMLInputElement>(null);

  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = drawerRef.current;
    if (!node) return;
    node.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', handleKeyDown);
    return () => node.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const refreshEquipment = async () => {
    const updated = (await listEquipment()).find((item) => item.id === equipment.id);
    if (updated) onUpdated(updated);
  };

  const linkDocument = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setBusy(true);
      setMessage('');
      const url = new URL(manualUrl.trim());
      await addManual(equipment.id, {
        title: manualTitle.trim() || `${equipment.manufacturer} ${equipment.model || equipment.name} documentation`,
        url: url.toString(),
        source: url.hostname,
      });
      await refreshEquipment();
      setManualTitle('');
      setManualUrl('');
      setLinking(false);
      setMessageTone('success');
      setMessage('Documentation linked.');
    } catch (caught) {
      setMessageTone('danger');
      setMessage(caught instanceof Error ? caught.message : 'Could not link this document.');
    } finally {
      setBusy(false);
    }
  };

  const uploadDocument = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setBusy(true);
      setMessage('');
      const result = await uploadManualPdf(equipment.id, file);
      await refreshEquipment();
      setMessageTone('success');
      const specs = Object.entries(result.extracted_specifications);
      setMessage(`PDF text indexed (${result.characters_extracted.toLocaleString()} characters). ${specs.length ? `Extracted ${specs.length} specification${specs.length === 1 ? '' : 's'}.` : 'No matching specifications found.'}`);
    } catch (caught) {
      setMessageTone('danger');
      setMessage(caught instanceof Error ? caught.message : 'Could not import this PDF.');
    } finally {
      setBusy(false);
    }
  };

  const removeManual = async (manual: Manual) => {
    if (!window.confirm(`Remove "${manual.title}"?`)) return;
    try {
      setBusy(true);
      await deleteManual(equipment.id, manual.id);
      await refreshEquipment();
    } catch (caught) {
      setMessageTone('danger');
      setMessage(caught instanceof Error ? caught.message : 'Could not remove this manual.');
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = async (photoId: string) => {
    if (!window.confirm('Remove this photo? The device and its details stay.')) return;
    try {
      setBusy(true);
      await deletePhoto(photoId);
      await refreshEquipment();
    } catch (caught) {
      setMessageTone('danger');
      setMessage(caught instanceof Error ? caught.message : 'Could not remove this photo.');
    } finally {
      setBusy(false);
    }
  };

  const markReviewed = async () => {
    try {
      setBusy(true);
      onUpdated(await updateEquipment(equipment.id, { review_state: 'reviewed' }));
    } catch (caught) {
      setMessageTone('danger');
      setMessage(caught instanceof Error ? caught.message : 'Could not update this record.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="drawer-backdrop" aria-label="Close equipment details" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="equipment-detail-title" ref={drawerRef} tabIndex={-1}>
        <div className="drawer-header">
          <div><h2 id="equipment-detail-title">{equipment.name}</h2><p>{equipment.manufacturer}{equipment.model ? ` · ${equipment.model}` : ''}</p></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {equipment.review_state === 'draft' && <Button size="sm" variant="secondary" icon="check" disabled={busy} onClick={() => void markReviewed()}>Mark reviewed</Button>}
            <button className="modal-close" aria-label="Close equipment details" onClick={onClose}><Icon name="close" size={17} /></button>
          </div>
        </div>
        <div className="drawer-body">
          {equipment.review_state === 'draft' && (
            <InlineNotice tone="warning" icon="camera">
              This device came from a photo and has not been checked over yet.
            </InlineNotice>
          )}
          <dl className="spec-list">
            <div className="spec-row"><dt>Manufacturer</dt><dd>{equipment.manufacturer || 'Unknown'}</dd></div>
            <div className="spec-row"><dt>Model</dt><dd>{equipment.model || 'Not set'}</dd></div>
            <div className="spec-row"><dt>Manuals</dt><dd>{equipment.manuals?.length ?? 0} linked</dd></div>
            <div className="spec-row"><dt>Research findings</dt><dd>{findings.length} documents</dd></div>
            {specifications.map(([key, value]) => <div className="spec-row" key={key}><dt>{key}</dt><dd>{formatSpecValue(value)}</dd></div>)}
          </dl>

          <section style={{ marginBlockStart: 24 }} aria-labelledby="manuals-heading">
            <h3 id="manuals-heading" style={{ fontSize: '0.8rem', marginBlockEnd: 12, color: 'var(--text-soft)' }}>Documentation ({equipment.manuals?.length ?? 0})</h3>
            {equipment.manuals?.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {equipment.manuals.map((manual) => {
                const localPdf = manual.metadata?.kind === 'uploaded_pdf';
                const href = localPdf ? `${getApiBaseUrl()}${manual.url}` : manual.url;
                return <article key={manual.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                  <a href={href} target="_blank" rel="noreferrer" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <strong style={{ display: 'block', fontSize: '0.7rem' }}>{manual.title}</strong>
                    <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.6rem' }}>{manual.source}{localPdf ? ' · stored PDF' : ''}</span>
                  </a>
                  <Button variant="ghost" size="sm" icon="x" disabled={busy} onClick={() => void removeManual(manual)}>Remove</Button>
                </article>;
              })}
            </div> : <p style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>No documents linked yet.</p>}
            {linking && <form onSubmit={(event) => void linkDocument(event)} style={{ display: 'grid', gap: 8, marginBlockStart: 12 }}>
              <label className="form-field"><span>Document title</span><input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="Service manual" maxLength={255} /></label>
              <label className="form-field"><span>Document URL</span><input type="url" required value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} placeholder="https://manufacturer.com/manual.pdf" /></label>
              <div className="form-actions"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setLinking(false)}>Cancel</Button><Button type="submit" variant="primary" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save link'}</Button></div>
            </form>}
            <div className="form-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBlockStart: 12 }}>
              <Button variant="secondary" size="sm" icon="book" disabled={busy} onClick={() => { setLinking((current) => !current); setMessage(''); }}>Link URL</Button>
              <Button variant="secondary" size="sm" icon="upload" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? 'Processing…' : 'Import PDF'}</Button>
              <input ref={fileInput} className="sr-only" type="file" accept="application/pdf,.pdf" aria-label="Choose a PDF manual to import" disabled={busy} onChange={(event) => void uploadDocument(event)} />
              <Button variant="secondary" size="sm" icon="research" onClick={() => { onClose(); window.location.href = `/research?equipment=${equipment.id}`; }}>Research this model</Button>
            </div>
            {message && <InlineNotice tone={messageTone} icon={messageTone === 'success' ? 'check' : 'x'}>{message}</InlineNotice>}
          </section>

          {(equipment.photos?.length ?? 0) > 0 && (
            <section style={{ marginBlockStart: 24 }} aria-labelledby="photos-heading">
              <h3 id="photos-heading" style={{ fontSize: '0.8rem', marginBlockEnd: 12, color: 'var(--text-soft)' }}>Photos ({equipment.photos?.length})</h3>
              <div className="photo-strip">
                {equipment.photos?.map((photo) => (
                  <div className="photo-thumb" key={photo.id}>
                    <a href={`${getApiBaseUrl()}${photo.url}`} target="_blank" rel="noreferrer">
                      <img src={`${getApiBaseUrl()}${photo.url}`} alt={photo.file_name} loading="lazy" />
                    </a>
                    <Button variant="ghost" size="sm" icon="x" disabled={busy} onClick={() => void removePhoto(photo.id)}>Remove</Button>
                  </div>
                ))}
              </div>
              <p className="field-help" style={{ marginBlockStart: 8 }}>Taken from your phone, kept with this device.</p>
            </section>
          )}

          {findings.length > 0 && (
            <section style={{ marginBlockStart: 24 }} aria-labelledby="research-findings-heading">
              <h3 id="research-findings-heading" style={{ fontSize: '0.8rem', marginBlockEnd: 12, color: 'var(--text-soft)' }}>Research findings ({findings.length})</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {findings.map((finding) => (
                  <article key={finding.id} style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', background: 'var(--panel)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBlockEnd: 8 }}>
                      <div style={{ flex: 1 }}>
                        <strong style={{ color: 'var(--text)', fontSize: '0.75rem' }}>{finding.title}</strong>
                        <p style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBlockStart: 4, wordBreak: 'break-all' }}>{finding.source_url}</p>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span className="tag tag-acid" style={{ fontSize: '0.55rem' }}>{Math.round(finding.confidence * 100)}%</span>
                        <span className="tag" style={{ fontSize: '0.55rem' }}>{finding.status}</span>
                      </div>
                    </div>
                    {Object.keys(finding.extracted_specs).length > 0 && <details style={{ marginBlockStart: 8 }}>
                      <summary style={{ fontSize: '0.6rem', color: 'var(--teal)', cursor: 'pointer' }}>Extracted specs ({Object.keys(finding.extracted_specs).length})</summary>
                      <pre style={{ marginBlockStart: 6, fontSize: '0.55rem', color: 'var(--muted)', whiteSpace: 'pre-wrap', maxHeight: '120px', overflow: 'auto' }}>{JSON.stringify(finding.extracted_specs, null, 2)}</pre>
                    </details>}
                    <p style={{ marginBlockStart: 8, fontSize: '0.6rem', color: 'var(--faint)' }}>Query: "{finding.query}" · {new Date(finding.created_at).toLocaleString()}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          <SendToEasySchematic equipmentId={equipment.id} />

          <InlineNotice tone="info" icon="sparkles">Uploaded PDF text and linked documentation are available to the AV assistant and MCP tools.</InlineNotice>
        </div>
      </aside>
    </>
  );
};

const AddEquipmentModal: React.FC<{ equipment?: Equipment; onClose: () => void; onSaved: (equipment: Equipment) => void }> = ({ equipment, onClose, onSaved }) => {
  const [form, setForm] = useState<EquipmentForm>(() => equipment ? {
    name: equipment.name,
    manufacturer: equipment.manufacturer,
    model: equipment.model ?? '',
    category: equipment.category,
    description: equipment.description ?? '',
  } : blankForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, saving]);

  const update = (key: keyof EquipmentForm, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.manufacturer.trim()) {
      setError('Name and manufacturer are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        manufacturer: form.manufacturer.trim(),
        model: form.model.trim() || null,
        category: form.category,
        description: form.description.trim() || null,
      };
      const saved = equipment
        ? await updateEquipment(equipment.id, payload)
        : await createEquipment({ ...payload, specifications: {} });
      onSaved(saved);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${equipment ? 'save' : 'create'} equipment record.`);
    } finally {
      setSaving(false);
    }
  };

  const title = equipment ? 'Edit equipment' : 'Add equipment';
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="equipment-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><h2 id="equipment-modal-title">{title}</h2><p>{equipment ? 'Update the canonical equipment record.' : 'Create the canonical record for a device in your studio.'}</p></div><button className="modal-close" aria-label={`Close ${title.toLowerCase()} dialog`} onClick={onClose} disabled={saving}><Icon name="close" size={17} /></button></div>
        <form className="modal-body" onSubmit={(event) => void submit(event)}>
          {error && <InlineNotice tone="danger" icon="x">{error}</InlineNotice>}
          <div className="form-grid" style={{ marginBlockStart: error ? 14 : 0 }}>
            <div className="form-field form-field-wide"><label htmlFor="equipment-name">Device name *</label><input id="equipment-name" name="name" required autoFocus value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. 1073-style preamp" /></div>
            <div className="form-field"><label htmlFor="equipment-manufacturer">Manufacturer *</label><input id="equipment-manufacturer" name="manufacturer" required value={form.manufacturer} onChange={(event) => update('manufacturer', event.target.value)} placeholder="e.g. Neve" /></div>
            <div className="form-field"><label htmlFor="equipment-model">Model</label><input id="equipment-model" name="model" value={form.model} onChange={(event) => update('model', event.target.value)} placeholder="e.g. 1073" /></div>
            <div className="form-field"><label htmlFor="equipment-category">Category</label><select id="equipment-category" name="category" value={form.category} onChange={(event) => update('category', event.target.value)}>{categories.slice(1).map((category) => <option key={category}>{category}</option>)}</select></div>
            <div className="form-field form-field-wide"><label htmlFor="equipment-description">Context</label><textarea id="equipment-description" name="description" value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="What is this device used for? Include rack position, studio role, or useful notes." /></div>
          </div>
          <div className="form-actions"><Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" variant="primary" icon="check" disabled={saving}>{saving ? 'Saving…' : equipment ? 'Save changes' : 'Create record'}</Button></div>
        </form>
      </div>
    </div>
  );
};

const Library: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All categories');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showAdd, setShowAdd] = useState(searchParams.get('new') === '1');
  const [selected, setSelected] = useState<Equipment | null>(null);
  const [editing, setEditing] = useState<Equipment | null>(null);
  /* Ticking devices is how a studio capture gets tidied: capture marks them as
     drafts, this is where a batch of them is confirmed or thrown away. */
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [reviewOnly, setReviewOnly] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  const loadEquipment = useCallback(async () => {
    setLoading(true);
    try {
      setEquipment(await listEquipment());
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load equipment.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadEquipment(); }, [loadEquipment]);
  useEffect(() => { setShowAdd(searchParams.get('new') === '1'); }, [searchParams]);

  const filteredEquipment = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return equipment.filter((item) => {
      const matchesCategory = category === 'All categories' || item.category === category;
      const matchesReview = !reviewOnly || item.review_state === 'draft';
      const haystack = [item.name, item.manufacturer, item.model, item.category, item.description, ...Object.values(item.specifications ?? {})].join(' ').toLowerCase();
      return matchesCategory && matchesReview && (!normalized || haystack.includes(normalized));
    });
  }, [category, equipment, query, reviewOnly]);

  const drafts = useMemo(() => equipment.filter((item) => item.review_state === 'draft'), [equipment]);

  const toggleMarked = (id: string) => {
    setMarked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* One request for the whole selection: the backend does the work, and a
     studio's worth of drafts is cleared in a single gesture. */
  const runBatch = async (changes: Record<string, unknown> = {}, remove = false) => {
    const ids = [...marked];
    if (ids.length === 0) return;
    if (remove && !window.confirm(`Delete ${ids.length} device${ids.length === 1 ? '' : 's'} and their photos? This cannot be undone.`)) return;
    setBatchBusy(true);
    try {
      await batchUpdateEquipment(ids, changes, remove);
      await loadEquipment();
      setMarked(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update those devices.');
    } finally {
      setBatchBusy(false);
    }
  };

  const closeAdd = () => {
    setShowAdd(false);
    setEditing(null);
    if (searchParams.has('new')) {
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  };

  const handleSaved = (item: Equipment) => {
    setEquipment((current) => {
      const exists = current.some((entry) => entry.id === item.id);
      return exists ? current.map((entry) => entry.id === item.id ? item : entry) : [item, ...current];
    });
  };

  const handleEdit = (item: Equipment) => {
    setEditing(item);
    setShowAdd(true);
  };

  const handleArchive = async (item: Equipment) => {
    try {
      const updated = await updateEquipment(item.id, { archived: !item.archived });
      setEquipment(current => current.map(e => e.id === item.id ? updated : e));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update archive status.');
    }
  };

  const handleDelete = async (item: Equipment) => {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      await deleteEquipment(item.id);
      setEquipment(current => current.filter(e => e.id !== item.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete equipment.');
    }
  };

  return (
    <>
      <PageHeader eyebrow="Knowledge base" title="Equipment library" description="The canonical inventory for every microphone, console, processor, and monitor in your world." actions={<><Button variant="secondary" icon="book" onClick={() => navigate('/research')}>Find manuals</Button><Button variant="primary" icon="plus" onClick={() => setShowAdd(true)}>Add equipment</Button></>} />

      {error && <InlineNotice tone="warning" icon="server">{error} The interface is still usable; reconnect to load or persist catalog changes.</InlineNotice>}

      {drafts.length > 0 && !bannerDismissed && (
        <div className="draft-banner">
          <InlineNotice tone="warning" icon="camera">
            {drafts.length} captured device{drafts.length === 1 ? '' : 's'} need a look — they came from a
            phone photo and have not been checked over.{' '}
            <button type="button" className="link-button" onClick={() => setReviewOnly(true)}>Review them</button>{' '}
            <button type="button" className="link-button" onClick={() => setBannerDismissed(true)}>Dismiss</button>
          </InlineNotice>
        </div>
      )}

      <Surface>
        <div className="surface-body">
          <div className="library-toolbar">
            <div className="search-field"><Icon name="search" size={15} className="search-icon" /><label className="sr-only" htmlFor="equipment-search">Search equipment</label><input id="equipment-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, model, manufacturer, or spec…" /></div>
            <div className="toolbar-controls"><span className="library-count">{loading ? 'Loading…' : `${filteredEquipment.length} of ${equipment.length} records`}</span><select className="select-control" aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select><div className="view-toggle" aria-label="Choose view"><button className={viewMode === 'grid' ? 'active' : ''} aria-label="Grid view" aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')}><Icon name="grid" size={15} /></button><button className={viewMode === 'table' ? 'active' : ''} aria-label="Table view" aria-pressed={viewMode === 'table'} onClick={() => setViewMode('table')}><Icon name="layers" size={15} /></button></div><Button variant="ghost" size="sm" icon="refresh" aria-label="Refresh equipment" onClick={() => void loadEquipment()} disabled={loading} /></div>
          </div>

          {reviewOnly && (
            <div className="draft-banner">
              <InlineNotice tone="info" icon="camera">
                Showing only captured devices.{' '}
                <button type="button" className="link-button" onClick={() => setReviewOnly(false)}>Show everything</button>
              </InlineNotice>
            </div>
          )}

          {marked.size > 0 && (
            <div className="batch-bar">
              <span className="batch-count">{marked.size} selected</span>
              <select
                aria-label="Set the category for the selected devices"
                defaultValue=""
                disabled={batchBusy}
                onChange={(event) => { if (event.target.value) void runBatch({ category: event.target.value }); }}
              >
                <option value="">Set category…</option>
                {categories.slice(1).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <input
                type="text"
                placeholder="Set manufacturer…"
                aria-label="Set the manufacturer for the selected devices"
                disabled={batchBusy}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  const value = event.currentTarget.value.trim();
                  if (value) void runBatch({ manufacturer: value });
                }}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value) void runBatch({ manufacturer: value });
                }}
              />
              <div className="batch-actions">
                <Button size="sm" variant="secondary" icon="check" disabled={batchBusy} onClick={() => void runBatch({ review_state: 'reviewed' })}>Mark reviewed</Button>
                <Button size="sm" variant="secondary" icon="database" disabled={batchBusy} onClick={() => void runBatch({ archived: true })}>Archive</Button>
                <Button size="sm" variant="danger" icon="x" disabled={batchBusy} onClick={() => void runBatch({}, true)}>Delete</Button>
                <Button size="sm" variant="ghost" disabled={batchBusy} onClick={() => setMarked(new Set())}>Clear</Button>
              </div>
            </div>
          )}

          {!loading && filteredEquipment.length === 0 ? (
            <EmptyState
              icon={query || category !== 'All categories' ? 'search' : 'package'}
              title={
                reviewOnly && drafts.length === 0
                  ? 'Nothing left to review'
                  : query || category !== 'All categories'
                    ? 'No matching equipment'
                    : 'Your library is empty'
              }
              description={
                reviewOnly && drafts.length === 0
                  ? 'Every device captured from a photo has been checked over.'
                  : query || category !== 'All categories'
                    ? 'Try a broader search or remove the category filter.'
                    : 'Start with the gear that defines your setup. You can enrich each record with manuals and research afterward.'
              }
              action={reviewOnly && drafts.length === 0 ? (
                <Button variant="secondary" size="sm" onClick={() => setReviewOnly(false)}>Show everything</Button>
              ) : query || category !== 'All categories' ? (
                <Button variant="secondary" size="sm" onClick={() => { setQuery(''); setCategory('All categories'); setReviewOnly(false); }}>Clear filters</Button>
              ) : (
                <>
                  <Button variant="primary" size="sm" icon="plus" onClick={() => setShowAdd(true)}>Add first device</Button>
                  <Button variant="secondary" size="sm" icon="upload" disabled={equipment.length === 0} onClick={() => setSelected(equipment[0])}>Import a PDF</Button>
                  {equipment.length === 0 && <span className="field-help" style={{ display: 'block' }}>Add a device first — a PDF manual belongs to a piece of gear.</span>}
                </>
              )}
            />
          ) : viewMode === 'grid' ? (
            <div className="equipment-grid">
              {filteredEquipment.map((item) => (
                <article className="equipment-card" key={item.id}>
                  <div className="equipment-card-header">
                    <div className="card-select">
                      {(reviewOnly || marked.size > 0) && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.name}`}
                          checked={marked.has(item.id)}
                          onChange={() => toggleMarked(item.id)}
                        />
                      )}
                      <div><h3><button type="button" className="equipment-card-title" onClick={() => setSelected(item)}>{item.name}</button></h3><p className="equipment-card-manufacturer">{item.manufacturer}</p></div>
                    </div>
                    <Dropdown
                      trigger={<Icon name="more" size={16} />}
                      items={[
                        { label: 'Edit', icon: 'file', onClick: () => handleEdit(item) },
                        { label: item.archived ? 'Unarchive' : 'Archive', icon: 'database', onClick: () => handleArchive(item) },
                        { label: 'Delete', icon: 'x', danger: true, onClick: () => handleDelete(item) },
                      ]}
                    />
                  </div>
                  <p className="equipment-card-description">{item.description || 'No context added yet. Open this record to review specifications and link documentation.'}</p>
                  <div className="equipment-meta">
                    <span className="tag tag-acid">{item.category || 'Other'}</span>
                    {item.review_state === 'draft' && <span className="tag tag-draft">Needs review</span>}
                    {item.model && <span className="tag">{item.model}</span>}
                    <span className="tag">{item.manuals?.length ?? 0} manuals</span>
                    <span className="tag tag-acid">{item.research_findings?.length ?? 0} research</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="table-wrap"><table className="data-table"><thead><tr><th className="select-cell"><span className="sr-only">Select</span></th><th>Device</th><th>Category</th><th>Model</th><th>Manuals</th><th>Research</th><th>Record ID</th></tr></thead><tbody>{filteredEquipment.map((item) => <tr key={item.id} tabIndex={0} onClick={() => setSelected(item)} onKeyDown={(event) => { if (event.key === 'Enter') setSelected(item); }}><td className="select-cell">{(reviewOnly || marked.size > 0) && <input type="checkbox" aria-label={`Select ${item.name}`} checked={marked.has(item.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleMarked(item.id)} />}</td><td><span className="table-name"><strong>{item.name}</strong><span>{item.manufacturer}</span></span></td><td><span className="tag tag-acid">{item.category || 'Other'}</span>{item.review_state === 'draft' && <span className="tag tag-draft">Needs review</span>}</td><td>{item.model || '—'}</td><td>{item.manuals?.length ?? 0}</td><td><span className="tag tag-acid">{item.research_findings?.length ?? 0}</span></td><td><span className="tag">{item.id}</span></td></tr>)}</tbody></table></div>
          )}
        </div>
      </Surface>
      {showAdd && <AddEquipmentModal equipment={editing ?? undefined} onClose={closeAdd} onSaved={handleSaved} />}
      {selected && <EquipmentDrawer equipment={selected} onClose={() => setSelected(null)} onUpdated={(updated) => { setSelected(updated); setEquipment((current) => current.map((item) => item.id === updated.id ? updated : item)); }} />}
    </>
  );
};

export default Library;