/**
 * Конфигурация модуля commenting - централизованные пути к данным
 */

import * as path from 'path';

const MODULE_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(MODULE_ROOT, 'data');

// Пути для комментирования от имени канала
export const COMMENTING_PATHS = {
  inputs: {
    channelsFile: path.join(DATA_DIR, 'inputs/channel-commenting/channels.txt'),
  },
  outputs: {
    successfulFile: path.join(DATA_DIR, 'outputs/channel-commenting/successful-channels.txt'),
    failedFile: path.join(DATA_DIR, 'outputs/channel-commenting/failed-channels.txt'),
  },
  database: {
    dbPath: path.join(DATA_DIR, 'database/comments.db'),
  },
  dataDir: DATA_DIR,
};

// Пути для профильного комментирования (отдельная папка)
export const PROFILE_COMMENTING_PATHS = {
  inputs: {
    channelsFile: path.join(DATA_DIR, 'inputs/profile-channels/channels.txt'),
  },
  outputs: {
    successfulFile: path.join(DATA_DIR, 'outputs/profile-channels/successful-channels.txt'),
    unavailableFile: path.join(DATA_DIR, 'outputs/profile-channels/unavailable-channels.txt'),
    bannedFilePrefix: path.join(DATA_DIR, 'outputs/profile-channels/banned-for-'),
    moderatedFile: path.join(DATA_DIR, 'outputs/profile-channels/moderated-channels.txt'),
    subscriptionRequiredFile: path.join(DATA_DIR, 'outputs/profile-channels/subscription-required-channels.txt'),
  },
};

// Пути для USA комментирования через прокси (отдельная папка)
export const USA_COMMENTING_PATHS = {
  inputs: {
    channelsFile: path.join(DATA_DIR, 'inputs/usa-channels/channels.txt'),
  },
  outputs: {
    successfulFile: path.join(DATA_DIR, 'outputs/usa-channels/successful-channels.txt'),
    unavailableFile: path.join(DATA_DIR, 'outputs/usa-channels/unavailable-channels.txt'),
  },
};

export function getCommentingConfig() {
  return {
    ...COMMENTING_PATHS,
    targetChannel: process.env.TARGET_CHANNEL || '',
  };
}
