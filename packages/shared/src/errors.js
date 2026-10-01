export class PeriodError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PeriodError';
  }
}

export class ClockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ClockError';
  }
}
