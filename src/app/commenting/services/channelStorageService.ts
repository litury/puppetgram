/**
 * Channel Storage Service - работа с файлами каналов
 */

import * as fs from 'fs';
import * as path from 'path';
import { COMMENTING_PATHS } from '../config/commentingConfig';

export class ChannelStorageService {
  private p_paths = COMMENTING_PATHS;

  constructor() {
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      path.dirname(this.p_paths.inputs.channelsFile),
      path.dirname(this.p_paths.outputs.successfulFile),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  loadChannels(): string[] {
    if (!fs.existsSync(this.p_paths.inputs.channelsFile)) {
      return [];
    }

    const content = fs.readFileSync(this.p_paths.inputs.channelsFile, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  }

  saveSuccessful(_channelUsername: string): void {
    const cleanUsername = _channelUsername.replace('@', '');

    if (!fs.existsSync(this.p_paths.outputs.successfulFile)) {
      fs.writeFileSync(this.p_paths.outputs.successfulFile, '', 'utf-8');
    }

    const content = fs.readFileSync(this.p_paths.outputs.successfulFile, 'utf-8');
    if (content.includes(cleanUsername)) {
      return;
    }

    fs.appendFileSync(this.p_paths.outputs.successfulFile, `@${cleanUsername}\n`, 'utf-8');
  }

  saveFailed(_channelUsername: string): void {
    const cleanUsername = _channelUsername.replace('@', '');

    if (!fs.existsSync(this.p_paths.outputs.failedFile)) {
      fs.writeFileSync(this.p_paths.outputs.failedFile, '', 'utf-8');
    }

    const content = fs.readFileSync(this.p_paths.outputs.failedFile, 'utf-8');
    if (content.includes(cleanUsername)) {
      return;
    }

    fs.appendFileSync(this.p_paths.outputs.failedFile, `@${cleanUsername}\n`, 'utf-8');
  }

  removeFromQueue(_channelUsername: string): void {
    if (!fs.existsSync(this.p_paths.inputs.channelsFile)) {
      return;
    }

    const cleanUsername = _channelUsername.replace('@', '');
    const content = fs.readFileSync(this.p_paths.inputs.channelsFile, 'utf-8');
    const lines = content.split('\n');

    const filtered = lines.filter(line => {
      const trimmed = line.trim().replace('@', '');
      return trimmed !== cleanUsername;
    });

    fs.writeFileSync(this.p_paths.inputs.channelsFile, filtered.join('\n'), 'utf-8');
  }

  getSuccessfulChannels(): string[] {
    if (!fs.existsSync(this.p_paths.outputs.successfulFile)) {
      return [];
    }

    const content = fs.readFileSync(this.p_paths.outputs.successfulFile, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim().replace('@', ''))
      .filter(Boolean);
  }

  getFailedChannels(): string[] {
    if (!fs.existsSync(this.p_paths.outputs.failedFile)) {
      return [];
    }

    const content = fs.readFileSync(this.p_paths.outputs.failedFile, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim().replace('@', ''))
      .filter(Boolean);
  }
}
