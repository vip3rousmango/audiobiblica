import React, { useState } from 'react';

interface Message { role: string; content: string; }

const NanobotChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // IPC call to Electron main, which talks to nanobot gateway
      // For now, call the MCP server's tool directly via HTTP as a fallback
      const res = await fetch('http://127.0.0.1:8000/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_name: 'search_equipment', arguments: { query: input } }),
      });
      const data = await res.json();
      const botMsg: Message = { role: 'assistant', content: JSON.stringify(data, null, 2) };
      setMessages((prev) => [...prev, botMsg]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Nanobot unreachable — ensure AudioBiblica backend is running.' }]);
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: 16, border: '1px solid #333', borderRadius: 8, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h3>Nanobot Assistant</h3>
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 8 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ textAlign: m.role === 'user' ? 'right' : 'left', marginBottom: 8 }}>
            <span style={{ background: m.role === 'user' ? '#1a73e8' : '#333', color: '#fff', padding: '6px 12px', borderRadius: 12, display: 'inline-block' }}>{m.content}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Ask about audio equipment…" style={{ flex: 1, padding: 8 }} />
        <button onClick={send} disabled={loading}>{loading ? '…' : 'Send'}</button>
      </div>
    </div>
  );
};

export default NanobotChat;
