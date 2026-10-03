export class SourceReaderError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'SourceReaderError';
    this.code = code;
    this.details = details;
  }
}

export class MappingError extends Error {
  constructor(message, code = 'MAPPING_INVALID', details = {}) {
    super(message);
    this.name = 'MappingError';
    this.code = code;
    this.details = details;
  }
}
