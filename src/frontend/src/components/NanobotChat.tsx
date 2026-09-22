import React, { useState, useEffect } from 'react';

interface Message { role: string; content: string; }

const NanobotChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [nanobotAvailable, setNanobotAvailable] = useState<boolean>(false);
  const [nanobotBaseUrl, setNanobotBaseUrl] = useState<string>('http://localhost:8000');

  // Check if nanobot is available on startup
  useEffect(() => {
    // Try to reach the nanobot gateway endpoint
    fetch(`${nanobotBaseUrl}/mcp`)
      .then(res => {
        if (res.ok) setNanobotAvailable(true);
      })
      .catch(() => setNanobotAvailable(false));
  }, [nanobotBaseUrl]);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Try nanobot first if available
      if (nanobotAvailable) {
        const res = await fetch(`${nanobotBaseUrl}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool_name: 'agent', arguments: { message: input } }),
        });
        const data = await res.json();
        if (data.response) {
          const botMsg: Message = { role: 'assistant', content: data.response };
          setMessages((prev) => [...prev, botMsg]);
          return;
        }
      }
      
      // Fallback to MCP equipment search
      const res = await fetch(`${nanobotBaseUrl}/api/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_name: 'search_equipment', arguments: { query: input } }),
      });
      const data = await res.json();
      let content = 'Equipment search results:' + JSON.stringify(data, null, 2);
      
      // If it's a nanobot response with the actual answer, use that
      if (data.response) content = data.response;
      else if (data.mcp?.data?.equipment?.length) content = data.mcp.data.equipment.map((eq: any) => eq.title || eq.name || eq.id).join('\n');
      else if (data.mcp?.data?.specifications) content = JSON.stringify(data.mcp.data.specifications, null, 2);
      
      const botMsg: Message = { role: 'assistant', content };
      setMessages((prev) => [...prev, botMsg]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Error communicating with nanobot — ensure backend and nanobot are running.' }]);
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: 16, border: '1px solid #333', borderRadius: 8, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 8, fontSize: '14px', color: nanobotAvailable ? '#4caf50' : '#ff9800' }}>
        Nanobot: {nanobotAvailable ? 'Connected (AI agent ready)' : 'Unavailable (fallback to equipment search)'}
      </div>
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