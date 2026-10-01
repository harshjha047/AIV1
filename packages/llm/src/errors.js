const OUTCOMES = Object.freeze({
  timeout: 'timeout',
  cancelled: 'cancelled',
  invalid_json: 'validator_fail'
});

export class OllamaError extends Error {
  constructor(errorClass, message, { status = null, retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OllamaError';
    this.errorClass = errorClass;
    this.status = status;
    this.retryable = retryable;
  }

  get outcome() {
    return OUTCOMES[this.errorClass] ?? 'error';
  }
}

export class RemoteInferenceError extends Error {
  constructor(host) {
    super(`Inference must run on the local Ollama instance; refusing host ${host}`);
    this.name = 'RemoteInferenceError';
    this.code = 'LLM_REMOTE_URL';
  }
}

export function classifyHttp(status, body) {
  const detail = String(body ?? '').slice(0, 200);
  if (status === 404 && /model/i.test(detail) && /not found/i.test(detail)) {
    return new OllamaError('model_missing', 'Model not found in Ollama', { status });
  }
  if (status === 429 || status >= 500) {
    return new OllamaError('http_5xx', `Ollama returned ${status}`, { status, retryable: true });
  }
  return new OllamaError('http_4xx', `Ollama returned ${status}`, { status });
}
