// Binary WebSocket protocol constants.
// Shared between client and server — single source of truth.
//
// All WebSocket messages use binary frames. The first byte is a command
// identifier. The remaining bytes are the payload.

// Client → Server commands
export const ClientCmd = {
    INPUT: 0x00, // Raw terminal input (keystrokes)
    RESIZE: 0x01, // JSON: { cols: number, rows: number }
    PAUSE: 0x02, // Flow control: stop sending output
    RESUME: 0x03, // Flow control: resume sending output
} as const;

// Server → Client commands
export const ServerCmd = {
    OUTPUT: 0x00, // Raw terminal output (ANSI escape sequences)
    TITLE: 0x01, // String: window/session title
    ALERT: 0x02, // String: server-side notification
} as const;

// Helper to build a binary message with a command prefix byte
export function buildMessage(cmd: number, payload?: string | Uint8Array): ArrayBuffer {
    const encoder = new TextEncoder();
    const data = typeof payload === 'string' ? encoder.encode(payload) : payload;
    const buf = new Uint8Array(1 + (data?.length ?? 0));
    buf[0] = cmd;
    if (data) {
        buf.set(data, 1);
    }
    return buf.buffer;
}

// Helper to parse a binary message into command byte + payload
export function parseMessage(data: ArrayBuffer): { cmd: number; payload: Uint8Array } {
    const view = new Uint8Array(data);
    return {
        cmd: view[0],
        payload: view.slice(1),
    };
}
