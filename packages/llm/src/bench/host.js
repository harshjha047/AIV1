import os from 'node:os';

export function createHostInfo(source = os) {
  return {
    freeMb: () => source.freemem() / (1024 * 1024),
    describe: () => ({
      platform: `${source.platform()} ${source.release()}`,
      cpuModel: source.cpus()[0]?.model ?? 'unknown',
      cores: source.cpus().length,
      totalMb: Math.round(source.totalmem() / (1024 * 1024))
    })
  };
}
