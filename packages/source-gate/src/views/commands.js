import {
  renderMongoDisable,
  renderMongoEnable
} from './mongoScripts.js';
import { renderPostgresDisable, renderPostgresEnable } from './postgresScripts.js';

export function disableEnableCommands(spec, database = spec.database) {
  if (spec.engine === 'mongodb') {
    return {
      engine: 'mongodb',
      language: 'mongosh',
      disable: renderMongoDisable(spec, database).trim(),
      enable: renderMongoEnable(spec, database).trim()
    };
  }
  return {
    engine: 'postgres',
    language: 'sql',
    disable: renderPostgresDisable(spec).trim(),
    enable: renderPostgresEnable(spec).trim()
  };
}
