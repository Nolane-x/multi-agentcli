import React from 'react';
import TerminalWindow from './TerminalWindow';
import './TerminalGrid.css';

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

export interface TerminalGridProps {
  terminals: Terminal[];
  messages: Message[];
  onRemoveTerminal: (id: string) => void;
  onUpdateContent: (id: string, content: string) => void;
  onToggleMaximize: (id: string) => void;
  onSendMessage: (from: string, to: string, content: string) => void;
  onAddTerminal: (agentType?: string, title?: string) => string;
}

const calculateGridSize = (count: number): number => {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  if (count <= 25) return 5;
  return Math.ceil(Math.sqrt(count));
};

const TerminalGrid: React.FC<TerminalGridProps> = ({
  terminals,
  onRemoveTerminal,
  onUpdateContent,
  onToggleMaximize,
  onSendMessage,
  onAddTerminal,
}) => {
  const maximizedTerminal = terminals.find(t => t.isMaximized);
  const gridSize = calculateGridSize(maximizedTerminal ? 1 : terminals.length);
  const showNewTerminalBtn = !maximizedTerminal && terminals.length < 25;

  const handleAddTerminalClick = () => {
    onAddTerminal('claude-code', `New Terminal #${terminals.length + 1}`);
  };

  const visibleTerminals = maximizedTerminal 
    ? [maximizedTerminal] 
    : terminals.filter(t => !t.isMaximized);

  return (
    <div className="terminal-grid-container">
      <div 
        className={`terminal-grid ${maximizedTerminal ? 'maximized' : ''}`}
        style={{
          gridTemplateColumns: maximizedTerminal ? '1fr' : `repeat(${gridSize}, 1fr)`,
          gridTemplateRows: maximizedTerminal ? '1fr' : `repeat(${gridSize}, 1fr)`,
        }}
      >
        {visibleTerminals.map(terminal => (
          <TerminalWindow
            key={terminal.id}
            terminal={terminal}
            onClose={() => onRemoveTerminal(terminal.id)}
            onContentChange={(content) => onUpdateContent(terminal.id, content)}
            onMaximize={() => onToggleMaximize(terminal.id)}
            onSendMessage={(to, content) => onSendMessage(terminal.id, to, content)}
            allTerminals={terminals}
            onAddTerminal={onAddTerminal}
          />
        ))}
        
        {!maximizedTerminal && showNewTerminalBtn && (
          <button 
            className="add-terminal-btn"
            onClick={handleAddTerminalClick}
            title="Add new AI agent terminal"
          >
            <span className="plus-icon">+</span>
            <span>New Terminal</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default TerminalGrid;
