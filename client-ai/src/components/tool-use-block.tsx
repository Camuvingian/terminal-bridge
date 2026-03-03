import { useState } from 'react';
import type { ToolUseEntry } from '../state/chat-state';

interface ToolUseBlockProps {
    tool: ToolUseEntry;
}

const ToolUseBlock: React.FC<ToolUseBlockProps> = ({ tool }) => {
    const [expanded, setExpanded] = useState(false);

    const statusLabel =
        tool.status === 'running'
            ? 'Running...'
            : tool.status === 'error'
              ? 'Error'
              : tool.durationMs !== undefined
                ? `${(tool.durationMs / 1000).toFixed(1)}s`
                : 'Done';

    return (
        <div className="tool-block">
            <div className="tool-header" onClick={() => setExpanded(!expanded)}>
                <span className="tool-name">
                    {expanded ? '\u25BC' : '\u25B6'} {tool.toolName}
                </span>
                <span className={`tool-status ${tool.status}`}>{statusLabel}</span>
            </div>
            {expanded && (
                <div className="tool-details">
                    <div className="tool-section-label">Input</div>
                    <div className="tool-content">{formatJson(tool.input)}</div>

                    {tool.output !== undefined && (
                        <>
                            <div className="tool-section-label" style={{ marginTop: 10 }}>
                                Output
                            </div>
                            <div className="tool-content">{tool.output}</div>
                        </>
                    )}

                    {tool.durationMs !== undefined && (
                        <div className="tool-duration">Completed in {(tool.durationMs / 1000).toFixed(1)}s</div>
                    )}
                </div>
            )}
        </div>
    );
};

function formatJson(obj: Record<string, unknown>): string {
    try {
        return JSON.stringify(obj, null, 2);
    } catch {
        return String(obj);
    }
}

export default ToolUseBlock;
