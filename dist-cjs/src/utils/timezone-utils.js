export function getLocalTimestamp() {
    const now = new Date();
    return now.toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    });
}
export function getLocalISOTimestamp() {
    const now = new Date();
    const timezoneOffset = -now.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(timezoneOffset) / 60);
    const offsetMinutes = Math.abs(timezoneOffset) % 60;
    const offsetSign = timezoneOffset >= 0 ? '+' : '-';
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const offsetHoursStr = String(offsetHours).padStart(2, '0');
    const offsetMinutesStr = String(offsetMinutes).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHoursStr}:${offsetMinutesStr}`;
}
export function convertToLocalTime(timestamp) {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    if (isNaN(date.getTime())) {
        return 'Invalid Date';
    }
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    });
}
export function getRelativeTime(timestamp) {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (isNaN(date.getTime())) {
        return 'Invalid Date';
    }
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffSeconds < 60) {
        return 'just now';
    } else if (diffMinutes < 60) {
        return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    } else if (diffHours < 24) {
        return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else if (diffDays < 7) {
        return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    } else {
        return date.toLocaleDateString();
    }
}
export function formatTimestampForDisplay(timestamp) {
    const localTime = convertToLocalTime(timestamp);
    const relativeTime = getRelativeTime(timestamp);
    return {
        absolute: localTime,
        relative: relativeTime,
        display: `${localTime} (${relativeTime})`
    };
}
export function getTimezoneInfo() {
    const date = new Date();
    const formatter = new Intl.DateTimeFormat(undefined, {
        timeZoneName: 'long'
    });
    const parts = formatter.formatToParts(date);
    const timeZoneName = parts.find((part)=>part.type === 'timeZoneName')?.value;
    return {
        name: timeZoneName || 'Unknown',
        abbreviation: date.toLocaleString(undefined, {
            timeZoneName: 'short'
        }).split(' ').pop(),
        offset: -date.getTimezoneOffset() / 60,
        offsetString: date.toTimeString().split(' ')[1]
    };
}

//# sourceMappingURL=timezone-utils.js.map