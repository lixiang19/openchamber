export const streamDebugEnabled = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem('ridge_stream_debug') === '1';
    } catch {
        return false;
    }
};

export const sessionStatusDebugEnabled = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem('ridge_session_status_debug') === '1';
    } catch {
        return false;
    }
};
