import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  GearDraft,
  createEquipment,
  deletePhoto,
  readCapturePhoto,
  updateEquipment,
  uploadCapturePhoto,
} from '../lib/api';
import { downscaleToJpeg } from '../lib/photo';
import { Icon } from '../components/Icon';
import { Button, InlineNotice, StatusDot } from '../components/ui';

/* The page a phone opens after scanning the code in Settings. It is deliberately
   not the desktop app: no sidebar, no catalog browsing, one job — photograph a
   device, check what the reader made of it, put it in the catalog. Everything
   here is sized for a thumb and a rack's worth of standing up. */

type Mode = 'item' | 'studio';
type Phase = 'idle' | 'sending' | 'reading' | 'reviewing';

/* Same list the desktop uses, so a category means one thing everywhere. */
const categories = ['Microphone', 'Console', 'Outboard', 'Instrument', 'Monitor', 'Interface', 'Other'];

interface DraftCard extends GearDraft {
  /* The user's edits, keyed by position; the draft itself stays as read. */
  key: string;
  added: boolean;
}

const Capture: React.FC = () => {
  const fileInput = useRef<HTMLInputElement>(null);
  const objectUrl = useRef<string | null>(null);
  const [mode, setMode] = useState<Mode>('item');
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('');
  const [cards, setCards] = useState<DraftCard[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'success' | 'danger'; text: string } | null>(null);
  const [claimed, setClaimed] = useState(false);

  /* The pairing token is in the URL that the QR code carried. Now that it has
     done its job — the cookie is set — it does not need to sit in the address
     bar, where a screenshot or a shared tab would hand it on. */
  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState({}, '', '/capture');
    }
  }, []);

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  const releasePreview = useCallback(() => {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
    setPreview(null);
  }, []);

  const reset = useCallback(() => {
    releasePreview();
    setCards([]);
    setPhase('idle');
    setStatus('');
    setClaimed(false);
  }, [releasePreview]);

  const describe = (error: unknown): string => {
    if (error instanceof ApiError) return error.message;
    return error instanceof Error ? error.message : 'That did not work. Try again.';
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    /* Reset first: without this, taking the same photo twice in a row fires no
       change event the second time. */
    event.target.value = '';
    if (!file) return;

    setNotice(null);
    setCards([]);
    setClaimed(false);
    releasePreview();
    objectUrl.current = URL.createObjectURL(file);
    setPreview(objectUrl.current);

    try {
      setPhase('sending');
      setStatus('Sending photo…');
      const blob = await downscaleToJpeg(file);
      const photo = await uploadCapturePhoto(blob, file.name.replace(/\.[^.]+$/, '') + '.jpg');

      setPhase('reading');
      setStatus('Reading the photo… this takes a few seconds.');
      const drafts = await readCapturePhoto(photo.id, mode);

      const cards: DraftCard[] = drafts.map((draft, index) => ({
        ...draft,
        key: `${photo.id}-${index}`,
        added: false,
      }));
      setCards(cards);
      setPhase('reviewing');
      setStatus(
        cards.length === 0
          ? 'Nothing was recognised in that photo. Try again, closer to the device.'
          : cards.length === 1
            ? 'Check the details, then add it.'
            : `${cards.length} devices found. Add the ones you want.`,
      );
    } catch (error) {
      setPhase('idle');
      setStatus('');
      setNotice({ tone: 'danger', text: describe(error) });
      releasePreview();
    }
  };

  const editCard = (key: string, field: keyof DraftCard, value: string) => {
    setCards((current) => current.map((card) => (card.key === key ? { ...card, [field]: value } : card)));
  };

  const addCard = async (card: DraftCard) => {
    setNotice(null);
    try {
      setStatus('Adding…');
      const fields = {
        name: card.name.trim() || card.manufacturer,
        manufacturer: card.manufacturer.trim() || 'Unknown',
        category: card.category,
        model: card.model?.trim() || undefined,
        description: card.description?.trim() || undefined,
      };

      /* A photo belongs to the device it produced, and the first card the user
         adds is the one that takes it. A studio shot is evidence for the first
         device, not for all of them, and a photo cannot have two owners. */
      const photoIds = !claimed && card.photo_id ? [card.photo_id] : [];

      if (card.existing_id) {
        await updateEquipment(card.existing_id, { ...fields, review_state: 'reviewed', photo_ids: photoIds });
      } else {
        await createEquipment({ ...fields, review_state: 'draft', photo_ids: photoIds });
      }
      if (photoIds.length > 0) setClaimed(true);

      setCards((current) => current.map((item) => (item.key === card.key ? { ...item, added: true } : item)));
      setNotice({
        tone: 'success',
        text: card.existing_id ? 'Updated in your catalog.' : 'Added to your catalog as a draft.',
      });
      setStatus('');
    } catch (error) {
      setNotice({ tone: 'danger', text: describe(error) });
      setStatus('');
    }
  };

  const skipCard = async (card: DraftCard) => {
    const remaining = cards.filter((item) => item.key !== card.key);
    setCards(remaining);
    if (remaining.length === 0) {
      reset();
    }
    /* Skipping means the photo is not wanted either — but only while nothing has
       taken it. In a studio shot the first card may already own it, and it has
       become that device's picture, not this one's. */
    if (card.photo_id && !claimed) {
      try {
        await deletePhoto(card.photo_id);
      } catch {
        /* Nothing to do about it: an unattached photo is cleared by the app the
           next time it starts. */
      }
    }
  };

  const busy = phase === 'sending' || phase === 'reading';

  return (
    <div className="capture-page">
      <header className="capture-header">
        <div>
          <h1>AudioBiblica</h1>
          <p>Photos taken here are added to the catalog on the computer.</p>
        </div>
        <StatusDot tone="success" label="Paired" />
      </header>

      <div className="capture-modes" role="group" aria-label="What are you photographing?">
        <Button
          variant={mode === 'item' ? 'primary' : 'secondary'}
          icon="package"
          aria-pressed={mode === 'item'}
          disabled={busy}
          onClick={() => setMode('item')}
        >
          One device
        </Button>
        <Button
          variant={mode === 'studio' ? 'primary' : 'secondary'}
          icon="layers"
          aria-pressed={mode === 'studio'}
          disabled={busy}
          onClick={() => setMode('studio')}
        >
          Whole studio
        </Button>
      </div>

      <p className="capture-hint">
        {mode === 'item'
          ? 'Photograph the front of the device, or its back panel with the connections.'
          : 'Stand back and photograph the rack or desk. Everything recognisable is listed.'}
      </p>

      <Button
        className="capture-shot"
        variant="primary"
        icon="camera"
        disabled={busy}
        onClick={() => fileInput.current?.click()}
      >
        {busy ? status : mode === 'item' ? 'Take a photo' : 'Photograph the studio'}
      </Button>
      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take a photo of the equipment"
        disabled={busy}
        onChange={(event) => void handleFile(event)}
      />

      {busy && <p className="capture-status" role="status">{status}</p>}
      {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
      {preview && <img className="capture-preview" src={preview} alt="The photo you just took" />}
      {phase === 'reviewing' && cards.length > 0 && <p className="capture-status">{status}</p>}

      {cards.map((card) => (
        <section className="draft-card" key={card.key} aria-label={card.name}>
          <div className="draft-card-head">
            <h2>{card.added ? 'In your catalog' : card.existing_id ? 'Already in your library' : 'New device'}</h2>
            {typeof card.confidence === 'number' && (
              <span className="draft-chip">{Math.round(card.confidence * 100)}% sure</span>
            )}
          </div>

          <div className="draft-fields">
            <label htmlFor={`name-${card.key}`}>Name</label>
            <input
              id={`name-${card.key}`}
              value={card.name}
              disabled={card.added}
              onChange={(event) => editCard(card.key, 'name', event.target.value)}
            />

            <label htmlFor={`maker-${card.key}`}>Maker</label>
            <input
              id={`maker-${card.key}`}
              value={card.manufacturer}
              disabled={card.added}
              onChange={(event) => editCard(card.key, 'manufacturer', event.target.value)}
            />

            <label htmlFor={`model-${card.key}`}>Model</label>
            <input
              id={`model-${card.key}`}
              value={card.model ?? ''}
              disabled={card.added}
              onChange={(event) => editCard(card.key, 'model', event.target.value)}
            />

            <label htmlFor={`category-${card.key}`}>Category</label>
            <select
              id={`category-${card.key}`}
              value={card.category}
              disabled={card.added}
              onChange={(event) => editCard(card.key, 'category', event.target.value)}
            >
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>

            <label htmlFor={`notes-${card.key}`}>Notes</label>
            <textarea
              id={`notes-${card.key}`}
              rows={2}
              value={card.description ?? ''}
              disabled={card.added}
              onChange={(event) => editCard(card.key, 'description', event.target.value)}
            />
          </div>

          <div className="draft-actions">
            {card.added ? (
              <Button variant="secondary" icon="check" disabled>Added</Button>
            ) : (
              <>
                <Button variant="primary" icon="plus" onClick={() => void addCard(card)}>
                  {card.existing_id ? 'Update' : 'Add'}
                </Button>
                <Button variant="ghost" onClick={() => void skipCard(card)}>Skip</Button>
              </>
            )}
          </div>
        </section>
      ))}

      {phase === 'reviewing' && (
        <Button className="capture-shot" variant="secondary" icon="refresh" onClick={reset}>
          Done — photograph another
        </Button>
      )}

      <footer className="capture-footer">
        <Icon name="package" size={14} />
        <span>Devices arrive on the computer marked “Needs review”, so you can tidy them up there.</span>
      </footer>
    </div>
  );
};

export default Capture;
