import React from 'react';
import './Sidebar.css';

export interface SidebarProps {
  isOpen: boolean;
  workingDirectory: string;
  onSetWorkingDirectory: (dir: string) => void;
  onAddTerminal: (agentType?: string, title?: string) => string;
  onToggleSidebar: () => void;
}

const agentTypes = [
  { id: 'group-leader', name: 'Group Leader', description: 'Team coordinator AI' },
  { id: 'claude-code', name: 'Claude Code', description: 'Anthropic coding assistant' },
  { id: 'codex-cli', name: 'Codex CLI', description: 'OpenAI code interpreter' },
  { id: 'deepseek', name: 'DeepSeek', description: 'DeepSeek coding assistant' },
];

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  workingDirectory,
  onSetWorkingDirectory,
  onAddTerminal,
  onToggleSidebar,
}) => {
  const handleSelectDirectory = async () => {
    // In Electron, this would use dialog.showOpenDialog
    const dir = prompt('Enter working directory path:', workingDirectory || '/');
    if (dir) {
      onSetWorkingDirectory(dir);
    }
  };

  const handleAddAgent = (agentId: string) => {
    const agent = agentTypes.find(a => a.id === agentId);
    if (agent) {
      onAddTerminal(agentId, agent.name);
    }
  };

  return (
    <>
      {!isOpen && (
        <button className="sidebar-toggle" onClick={onToggleSidebar}>
          ☰
        </button>
      )}
      <aside className={`sidebar ${isOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <h2>DSH Desktop</h2>
          <button className="close-btn" onClick={onToggleSidebar}>×</button>
        </div>

        <div className="sidebar-section">
          <h3>Working Directory</h3>
          <div className="directory-control">
            <input
              type="text"
              value={workingDirectory}
              placeholder="No directory selected"
              readOnly
              className="directory-input"
            />
            <button onClick={handleSelectDirectory} className="btn-select">
              Select
            </button>
          </div>
        </div>

        <div className="sidebar-section">
          <h3>AI Agents</h3>
          <div className="agent-list">
            {agentTypes.map(agent => (
              <button
                key={agent.id}
                className="agent-btn"
                onClick={() => handleAddAgent(agent.id)}
                title={agent.description}
              >
                <span className="agent-icon">🤖</span>
                <span className="agent-name">{agent.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <h3>Plugins</h3>
          <button className="plugin-btn">
            <span>➕ Add Plugin</span>
          </button>
          <button className="plugin-btn">
            <span>🔧 Create Plugin</span>
          </button>
        </div>

        <div className="sidebar-footer">
          <small>v0.1.2-alpha.5</small>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
