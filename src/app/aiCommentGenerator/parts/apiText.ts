export function sanitizeApiText(text: string): string {
    return text.replace(/[\uD800-\uDFFF]/gu, '\uFFFD')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

export function truncateApiText(text: string, limit: number, suffix = ''): string {
    const characters = Array.from(sanitizeApiText(text));
    return characters.length > limit ? characters.slice(0, limit).join('') + suffix : characters.join('');
}
