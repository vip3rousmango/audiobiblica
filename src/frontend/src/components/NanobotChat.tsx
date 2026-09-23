import React, { useState, useEffect, useRef } from 'react';

interface Message { role: string; content: string; }

const NanobotChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [nanobotAvailable, setNanobotAvailable] = useState<boolean>(false);
  const [nanobotBaseUrl, setNanobotBaseUrl] = useState<string>('http://localhost:8000');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${nanobotBaseUrl}/mcp`)
      .then(res => { if (res.ok) setNanobotAvailable(true); })
      .catch(() => setNanobotAvailable(false));
  }, [nanobotBaseUrl]);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages]);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      if (nanobotAvailable) {
        const res = await fetch(`${nanobotBaseUrl}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool_name: 'agent', arguments: { message: input } }),
        });
        const data = await res.json();
        if (data.response) {
          setMessages((prev) => [...prev, { role: 'assistant', content: data.response }]);
          return;
        }
      }
      const res = await fetch(`${nanobotBaseUrl}/api/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_name: 'search_equipment', arguments: { query: input } }),
      });
      const data = await res.json();
      let content = 'Equipment search results:\n' + JSON.stringify(data, null, 2);
      if (data.response) content = data.response;
      else if (data.mcp?.data?.equipment?.length) content = data.mcp.data.equipment.map((eq: unknown) => (eq as Record<string, unknown>).title || (eq as Record<string, unknown>).name || (eq as Record<string, unknown>).id).join('\n');
      else if (data.mcp?.data?.specifications) content = JSON.stringify(data.mcp.data.specifications, null, 2);
      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Error — ensure backend and nanobot are running.' }]);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-3xl mx-auto h-[calc(100vh-180px)] flex flex-col bg-slate-900/50 rounded-2xl border border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${nanobotAvailable ? 'bg-green-500' : 'bg-amber-500'}`} />
          <span>{nanobotAvailable ? 'AI Agent Connected' : 'Equipment Search Mode'}</span>
        </h2>
        <span className="text-xs text-slate-400">MCP: {nanobotBaseUrl}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={messagesEndRef}>
        {messages.length === 0 && (
          <div className="text-center text-slate-500 py-12">
            <svg className="w-16 h-16 mx-auto text-slate-700 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            <p className="text-lg font-medium">Ask about audio equipment</p>
            <p className="text-sm mt-1">Try: <span className="font-mono text-amber-400">"Compare Pultec EQP-1A vs EQP-2A"</span></p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-4 py-3 rounded-2xl ${m.role === 'user' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-100'}`}>
              <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed">{m.content}</pre>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-slate-800 bg-slate-950/50">
        <form onSubmit={e => { e.preventDefault(); send(); }} className="flex gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="Ask about audio gear… (Shift+Enter for newline)"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="px-6 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-semibold rounded-xl transition-colors"
          >
            {loading ? '…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default NanobotChat;