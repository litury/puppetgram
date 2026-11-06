export function aiFailure(error: unknown): string {
  const status = (error as { status?: unknown })?.status;
  const message = String((error as { message?: unknown })?.message || '');
  if (status === 400 && /messages\[\d+\]\.content/i.test(message) &&
      /unexpected end of hex escape|invalid unicode|invalid.*surrogate|unpaired.*surrogate/i.test(message)) {
    return 'AI_GENERATION_FAILED:POST_CONTENT_INVALID';
  }
  return typeof status === 'number' && Number.isInteger(status)
    ? `AI_GENERATION_FAILED:HTTP_${status}`
    : 'AI_GENERATION_FAILED:TRANSPORT';
}

export function isPostContentFailure(message: string): boolean {
  return message === 'AI_GENERATION_FAILED:POST_CONTENT_INVALID';
}
