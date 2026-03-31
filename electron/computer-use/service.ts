import type { AppConfig } from '../config/schema.js';
import { ComputerUseSessionManager } from './session-manager.js';

let manager: ComputerUseSessionManager | null = null;

export function getComputerUseManager(appHome: string, getConfig: () => AppConfig): ComputerUseSessionManager {
  manager ??= new ComputerUseSessionManager(appHome, getConfig);
  return manager;
}

/** Returns the existing manager if already initialized, or null. */
export function getExistingComputerUseManager(): ComputerUseSessionManager | null {
  return manager;
}
