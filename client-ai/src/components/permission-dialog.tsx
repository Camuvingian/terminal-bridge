import { useCallback } from 'react';
import type { PermissionRequest } from '../state/chat-state';

interface PermissionDialogProps {
    permission: PermissionRequest;
    onRespond: (requestId: string, granted: boolean) => void;
}

const PermissionDialog: React.FC<PermissionDialogProps> = ({ permission, onRespond }) => {
    const handleAllow = useCallback(() => {
        onRespond(permission.requestId, true);
    }, [permission.requestId, onRespond]);

    const handleDeny = useCallback(() => {
        onRespond(permission.requestId, false);
    }, [permission.requestId, onRespond]);

    return (
        <div className="permission-overlay">
            <div className="permission-dialog">
                <div className="permission-title">Permission Required</div>
                <div className="permission-description">{permission.description}</div>
                <div className="permission-tool-name">{permission.toolName}</div>
                <div className="permission-input">{JSON.stringify(permission.input, null, 2)}</div>
                <div className="permission-actions">
                    <button className="permission-btn deny" onClick={handleDeny}>
                        Deny
                    </button>
                    <button className="permission-btn allow" onClick={handleAllow}>
                        Allow
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PermissionDialog;
