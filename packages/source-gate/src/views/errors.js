export class ViewsSpecError extends Error {
  constructor(message, code = 'VIEWS_SPEC_INVALID', details = {}) {
    super(message);
    this.name = 'ViewsSpecError';
    this.code = code;
    this.details = details;
  }
}

export class SampleCheckError extends Error {
  constructor(problems) {
    super(`Sample document check failed: ${problems.length} problem(s)`);
    this.name = 'SampleCheckError';
    this.code = 'SAMPLE_CHECK_FAILED';
    this.problems = problems;
  }
}

export class PipelineLeakError extends Error {
  constructor(leaks) {
    super(`Generated output references denied fields: ${leaks.length}`);
    this.name = 'PipelineLeakError';
    this.code = 'PIPELINE_LEAK';
    this.leaks = leaks;
  }
}
