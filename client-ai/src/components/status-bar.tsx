import type { ConnectionState } from '../app';

interface StatusBarProps {
    connectionState: ConnectionState;
    queryStatus: 'idle' | 'querying' | 'waiting-permission';
}

const StatusBar: React.FC<StatusBarProps> = ({ connectionState, queryStatus }) => {
    const dotClass = getDotClass(connectionState, queryStatus);
    const label = getLabel(connectionState, queryStatus);

    return (
        <div className="status-bar">
            <span className={`status-dot ${dotClass}`} />
            <span>{label}</span>
        </div>
    );
};

function getDotClass(conn: ConnectionState, query: string): string {
    if (conn === 'reconnecting') {
        return 'reconnecting';
    }
    if (conn !== 'connected') {
        return 'disconnected';
    }
    if (query === 'querying' || query === 'waiting-permission') {
        return 'querying';
    }
    return 'connected';
}

function getLabel(conn: ConnectionState, query: string): string {
    if (conn === 'connecting') {
        return 'Connecting...';
    }
    if (conn === 'reconnecting') {
        return 'Reconnecting...';
    }
    if (conn !== 'connected') {
        return 'Disconnected';
    }
    if (query === 'querying') {
        return 'Thinking...';
    }
    if (query === 'waiting-permission') {
        return 'Awaiting permission';
    }
    return 'Connected';
}

export default StatusBar;
