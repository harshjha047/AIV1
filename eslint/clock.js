export default [
  {
    files: ['packages/**/src/**/*.js', 'apps/**/src/**/*.js'],
    ignores: ['packages/shared/src/clock.js', 'packages/shared/src/mode.js', 'packages/source-gate/src/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Use the injected clock.' },
        { object: 'performance', property: 'now', message: 'Use clock.monotonic().' }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Use the injected clock.'
        }
      ]
    }
  }
];
