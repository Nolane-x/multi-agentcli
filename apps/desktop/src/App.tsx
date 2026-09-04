import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import TerminalGrid from './components/TerminalGrid';
import './App.css';

export interface Terminal {
  id: string;
  agentType: string;
  title: string;
  isMaximized: boolean;
  content: string;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
}

const App: React.FC = () => {
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [workingDirectory, setWorkingDirectory] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const generateId = () => Math.random().toString(36).substring(2, 9);

  const addTerminal = useCallback((agentType: string = 'claude-code', title?: string) => {
    const newTerminal: Terminal = {
      id: generateId(),
      agentType,
      title: title || `${agentType} #${terminals.length + 1}`,
      isMaximized: false,
      content: '',
    };
    setTerminals(prev => [...prev, newTerminal]);
    return newTerminal.id;
  }, [terminals.length]);

  const removeTerminal = useCallback((id: string) => {
    setTerminals(prev => prev.filter(t => t.id !== id));
  }, []);

  const updateTerminalContent = useCallback((id: string, content: string) => {
    setTerminals(prev => prev.map(t => 
      t.id === id ? { ...t, content } : t
    ));
  }, []);

  const toggleMaximize = useCallback((id: string) => {
    setTerminals(prev => prev.map(t => 
      t.id === id ? { ...t, isMaximized: !t.isMaximized } : { ...t, isMaximized: false }
    ));
  }, []);

  const sendMessage = useCallback((from: string, to: string, content: string) => {
    const message: Message = {
      id: generateId(),
      from,
      to,
      content,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, message]);
  }, []);

  const handleSetWorkingDirectory = useCallback((dir: string) => {
    setWorkingDirectory(dir);
  }, []);

  // Initialize with one terminal
  useEffect(() => {
    if (terminals.length === 0) {
      addTerminal('group-leader', 'Group Leader');
    }
  }, []);

  return (
    <div className="app-container">
      <Sidebar 
        isOpen={sidebarOpen}
        workingDirectory={workingDirectory}
        onSetWorkingDirectory={handleSetWorkingDirectory}
        onAddTerminal={addTerminal}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />
      <TerminalGrid
        terminals={terminals}
        messages={messages}
        onRemoveTerminal={removeTerminal}
        onUpdateContent={updateTerminalContent}
        onToggleMaximize={toggleMaximize}
        onSendMessage={sendMessage}
        onAddTerminal={addTerminal}
      />
    </div>
  );
};

export default App;
