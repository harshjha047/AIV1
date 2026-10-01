import { viewsSpecs } from '@fab5/sources';
import { runViewsCli } from '@fab5/source-gate/views/cli';

try {
  const report = runViewsCli(process.argv.slice(2), { specs: viewsSpecs });
  process.exit(report.code);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
