export class SourceGateError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class SourceDisabledError extends SourceGateError {
  constructor(sourceId, state) {
    super(`Source ${sourceId} is not active (${state})`, 'SOURCE_NOT_ACTIVE', { sourceId, state });
    this.sourceId = sourceId;
    this.state = state;
  }
}

export class SourceNotFoundError extends SourceGateError {
  constructor(sourceId) {
    super(`Source ${sourceId} is not registered`, 'SOURCE_NOT_FOUND', { sourceId });
    this.sourceId = sourceId;
  }
}

export class SourceRegistryError extends SourceGateError {
  constructor(sourceId, cause) {
    super(`Source registry unavailable for ${sourceId}`, 'SOURCE_REGISTRY_UNAVAILABLE', {
      sourceId
    });
    this.sourceId = sourceId;
    this.cause = cause;
  }
}

export class RateLimitedError extends SourceGateError {
  constructor(sourceId, waitMs) {
    super(`Read cap reached for ${sourceId}`, 'SOURCE_RATE_LIMITED', { sourceId, waitMs });
    this.sourceId = sourceId;
    this.waitMs = waitMs;
  }
}

export class CredentialUnavailableError extends SourceGateError {
  constructor(sourceId, reason) {
    super(`Credentials unavailable for ${sourceId}: ${reason}`, 'CREDENTIAL_UNAVAILABLE', {
      sourceId,
      reason
    });
  }
}

export class ActivationRefusedError extends SourceGateError {
  constructor(sourceId, reason, details = {}) {
    super(`Cannot change ${sourceId}: ${reason}`, 'ACTIVATION_REFUSED', {
      sourceId,
      reason,
      ...details
    });
    this.sourceId = sourceId;
    this.reason = reason;
  }
}

export class InvalidTransitionError extends SourceGateError {
  constructor(sourceId, from, action) {
    super(`Cannot ${action} ${sourceId} from ${from}`, 'INVALID_TRANSITION', {
      sourceId,
      from,
      action
    });
    this.sourceId = sourceId;
    this.from = from;
  }
}
