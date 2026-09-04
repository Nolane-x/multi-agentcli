import React, { useState, useRef, useEffect } from 'react';
import './TerminalWindow.css';

export interface TerminalData {
  id: string;
  agentType: string;
  title: string;
  isMaximized: boolean;
  content: string;
}

export interface TerminalWindowProps {
  terminal: TerminalData;
  onClose: () => void;
  onContentChange: (content: string) => void;
  onMaximize: () => void;
  onSendMessage: (to: string, content: string) => void;
  allTerminals: TerminalData[];
  onAddTerminal: (agentType?: string, title?: string) => string;
}

const TerminalWindow: React.FC<TerminalWindowProps> = ({
  terminal,
  onClose,
  // onContentChange unused currently but kept for future use
  onMaximize,
  onSendMessage,
  allTerminals,
  onAddTerminal,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<string[]>([
    `Welcome to ${terminal.agentType}!`,
    `Type your commands below. This AI agent can interact with other agents.`,
  ]);
  const [showChatModal, setShowChatModal] = useState(false);
  const [chatTarget, setChatTarget] = useState('');
  const [chatMessage, setChatMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const command = inputValue.trim();
    setHistory(prev => [...prev, `$ ${command}`]);
    
    // Simulate AI response
    setTimeout(() => {
      let response = '';
      if (command.toLowerCase() === 'help') {
        response = 'Available commands: help, clear, chat, new-agent, exit';
      } else if (command.toLowerCase() === 'clear') {
        setHistory([]);
        setInputValue('');
        return;
      } else if (command.toLowerCase().startsWith('chat ')) {
        setShowChatModal(true);
        response = 'Opening chat modal...';
      } else if (command.toLowerCase() === 'new-agent') {
        onAddTerminal('claude-code', 'New Agent');
        response = 'New AI agent terminal created!';
      } else if (command.toLowerCase() === 'exit') {
        onClose();
        return;
      } else {
        response = `[${terminal.agentType}] Processing: ${command}\nThis is a simulated response. In production, this would connect to the actual AI agent.`;
      }
      setHistory(prev => [...prev, response]);
    }, 100);

    setInputValue('');
  };

  const handleSendChat = () => {
    if (chatTarget && chatMessage) {
      onSendMessage(chatTarget, chatMessage);
      setHistory(prev => [...prev, `→ Message sent to ${chatTarget}: ${chatMessage}`]);
      setShowChatModal(false);
      setChatMessage('');
      setChatTarget('');
    }
  };

  const otherTerminals = allTerminals.filter(t => t.id !== terminal.id);

  return (
    <div className={`terminal-window ${terminal.isMaximized ? 'maximized' : ''}`}>
      <div className="terminal-header">
        <div className="terminal-title">
          <span className="agent-badge">{terminal.agentType}</span>
          <span>{terminal.title}</span>
        </div>
        <div className="terminal-actions">
          <button onClick={onMaximize} className="action-btn" title="Maximize/Restore">
            {terminal.isMaximized ? '❐' : '□'}
          </button>
          <button onClick={onClose} className="action-btn close" title="Close">
            ×
          </button>
        </div>
      </div>
      
      <div className="terminal-body">
        <div className="terminal-history">
          {history.map((line, index) => (
            <div key={index} className="history-line">
              {line.startsWith('$ ') ? (
                <span className="command">{line}</span>
              ) : (
                <span className="response">{line}</span>
              )}
            </div>
          ))}
          <div ref={historyEndRef} />
        </div>
        
        <form onSubmit={handleCommand} className="terminal-input-form">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type command... (help, clear, chat, new-agent, exit)"
            className="terminal-input"
          />
        </form>
      </div>

      {showChatModal && (
        <div className="chat-modal-overlay" onClick={() => setShowChatModal(false)}>
          <div className="chat-modal" onClick={e => e.stopPropagation()}>
            <h3>Send Message to Agent</h3>
            <select 
              value={chatTarget} 
              onChange={e => setChatTarget(e.target.value)}
              className="chat-select"
            >
              <option value="">Select an agent...</option>
              {otherTerminals.map(t => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.agentType})
                </option>
              ))}
            </select>
            <textarea
              value={chatMessage}
              onChange={e => setChatMessage(e.target.value)}
              placeholder="Type your message..."
              className="chat-textarea"
              rows={4}
            />
            <div className="chat-actions">
              <button onClick={() => setShowChatModal(false)} className="btn-cancel">
                Cancel
              </button>
              <button onClick={handleSendChat} className="btn-send" disabled={!chatTarget || !chatMessage}>
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TerminalWindow;
