export function aiFailure(error: unknown): string {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' && Number.isInteger(status)
    ? `AI_GENERATION_FAILED:HTTP_${status}`
    : 'AI_GENERATION_FAILED:TRANSPORT';
}
