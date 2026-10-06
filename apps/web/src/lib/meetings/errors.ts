export class MeetingError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message?: string,
    public readonly details?: unknown
  ) {
    super(message ?? code);
    this.name = 'MeetingError';
  }
}
