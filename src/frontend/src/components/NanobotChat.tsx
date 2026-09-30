import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { getAssistantConfig, sendAssistantChat, testAssistantConnection } from '../lib/api';
import { Icon } from './Icon';
import { Button, InlineNotice, PageHeader, StatusDot } from './ui';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const starterPrompts = [
  'Compare two compressors for a vocal chain',
  'What should I check when a monitor sounds dull?',
  'Find the manual for a piece of legacy gear',
  'Help me design a clean drum tracking signal path',
];

const NanobotChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [runtime, setRuntime] = useState<'builtin' | 'nanobot'>('builtin');
  const [runtimeLabel, setRuntimeLabel] = useState('Assistant service');
  const [connection, setConnection] = useState<'checking' | 'connected' | 'offline'>('checking');
  const [connectionMessage, setConnectionMessage] = useState('Checking the configured assistant service…');
  const [sendError, setSendError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionId = useRef(crypto.randomUUID());

  useEffect(() => {
    let active = true;
    void getAssistantConfig().then(async (config) => {
      if (!active) return;
      setRuntime(config.runtime);
      setRuntimeLabel(config.runtime === 'nanobot' ? 'Nanobot agent' : `${config.provider} model`);
      try {
        const status = await testAssistantConnection();
        if (!active) return;
        setConnection('connected');
        setConnectionMessage(status.message);
      } catch (caught) {
        if (!active) return;
        setConnection('offline');
        setConnectionMessage(caught instanceof Error ? caught.message : 'The selected assistant is unavailable.');
      }
    }).catch((caught) => {
      if (!active) return;
      setConnection('offline');
      setConnectionMessage(caught instanceof Error ? caught.message : 'Could not load assistant settings.');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = input.trim();
    if (!prompt || sending) return;
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: prompt };
    const conversation = [...messages, userMessage].slice(-20);
    setMessages(conversation);
    setInput('');
    setSending(true);
    setSendError('');
    try {
      const result = await sendAssistantChat({
        runtime,
        messages: conversation.map(({ role, content }) => ({ role, content })),
        session_id: sessionId.current,
      });
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', content: result.answer }]);
      setConnection('connected');
      setConnectionMessage('Assistant response received.');
    } catch (caught) {
      // A failed request is never an assistant answer: say so beside the composer.
      const error = caught instanceof Error ? caught.message : 'The configured assistant could not answer this request.';
      setSendError(error);
      setConnection('offline');
      setConnectionMessage('The last message was not answered.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="AV intelligence" title="Assistant workspace" description="Ask questions in studio language. Responses use the selected model or Nanobot agent, grounded in your equipment records and imported manuals." actions={<Button variant="secondary" icon="settings" onClick={() => window.location.assign('/settings')}>Configure assistant</Button>} />
      {connection === 'offline' && <InlineNotice tone="warning" icon="plug">{connectionMessage} Check the assistant runtime in Settings.</InlineNotice>}
      <div className="assistant-layout" style={{ marginBlockStart: connection === 'offline' ? 16 : 0 }}>
        <section className="assistant-main" aria-label="Assistant conversation">
          <header className="assistant-header"><div className="assistant-title"><span className="assistant-orb"><Icon name="sparkles" size={16} /></span><div><strong>AudioBiblica assistant</strong><span><StatusDot tone={connection === 'connected' ? 'success' : connection === 'offline' ? 'warning' : 'neutral'} label={connection === 'connected' ? `${runtimeLabel} ready` : connection === 'offline' ? 'Assistant unavailable' : 'Checking assistant'} /></span></div></div><span className="tag">{runtime === 'nanobot' ? 'Agent gateway' : 'Grounded model chat'}</span></header>
          <div className="assistant-messages" aria-live="polite">
            {messages.length === 0 ? <div className="assistant-welcome"><span className="assistant-orb"><Icon name="waveform" size={22} /></span><h2>What are you solving today?</h2><p>Responses are generated by the configured assistant and include available AudioBiblica equipment and manual context.</p><div className="prompt-grid">{starterPrompts.map((prompt) => <button className="prompt-chip" key={prompt} onClick={() => setInput(prompt)}>{prompt}</button>)}</div></div> : messages.map((message) => <div className={`chat-message ${message.role === 'user' ? 'chat-message-user' : ''}`} key={message.id}><span className="chat-avatar"><Icon name={message.role === 'user' ? 'circle' : 'sparkles'} size={13} /></span><div className="chat-bubble">{message.content}</div></div>)}
            {sending && <div className="chat-message"><span className="chat-avatar"><Icon name="sparkles" size={13} /></span><div className="chat-bubble">Waiting for the assistant… <span style={{ color: 'var(--muted)' }}>Local models can take up to a minute, especially on the first question.</span></div></div>}
            <div ref={messagesEndRef} />
          </div>
          {sendError && <div style={{ marginBlockStart: 12 }}><InlineNotice tone="danger">{sendError}</InlineNotice></div>}
          <div className="assistant-composer"><form onSubmit={(event) => void send(event)}><div className="composer-box"><label htmlFor="assistant-input" className="sr-only">Ask the AV assistant</label><textarea id="assistant-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask about gear, routing, manuals, or troubleshooting…" disabled={sending} /><button className="composer-send" type="submit" aria-label="Send message" disabled={sending || !input.trim()}><Icon name="send" size={15} /></button></div><p className="composer-note">ENTER to send · SHIFT + ENTER for a new line</p></form></div>
        </section>
        <aside className="assistant-context" aria-label="Assistant context"><p className="context-label">Session context</p><div className="context-block"><div className="context-row"><span>Runtime</span><strong>{runtime === 'nanobot' ? 'Nanobot' : 'Built-in provider'}</strong></div><div className="context-row"><span>Service</span><strong>{connection === 'connected' ? 'Ready' : connection === 'offline' ? 'Unavailable' : 'Checking'}</strong></div><div className="context-row"><span>Knowledge</span><strong>Equipment + manuals</strong></div></div><div className="context-block"><p className="context-label">AudioBiblica tools</p>{['search_equipment', 'get_equipment_specifications', 'find_manuals', 'search_manufacturer_docs'].map((tool) => <div className="context-tool" key={tool}><Icon name="check" size={13} />{tool}</div>)}</div><div className="context-block"><p className="context-label">Service status</p><p style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{connectionMessage}</p></div></aside>
      </div>
    </>
  );
};

export default NanobotChat;
