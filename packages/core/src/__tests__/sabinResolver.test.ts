import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  resolveSabinDir,
  writeSabinLink,
  checkSabinType
} from '../sabinResolver';

describe('sabinResolver', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('resolveSabinDir', () => {
    it('should resolve .sabin directory (traditional setup)', async () => {
      const sabinDir = path.join(testDir, '.sabin');
      await fs.mkdir(sabinDir);

      const result = await resolveSabinDir(testDir);

      expect(result.sabinDir).toBe(sabinDir);
      expect(result.isLinked).toBe(false);
      expect(result.projectRoot).toBe(testDir);
    });

    it('should resolve .sabin file (linked setup)', async () => {
      const sharedSabin = path.join(testDir, 'shared', '.sabin');
      await fs.mkdir(sharedSabin, { recursive: true });

      const projectDir = path.join(testDir, 'project-1');
      await fs.mkdir(projectDir);
      await writeSabinLink(projectDir, sharedSabin);

      const result = await resolveSabinDir(projectDir);

      expect(result.sabinDir).toBe(sharedSabin);
      expect(result.isLinked).toBe(true);
      expect(result.projectRoot).toBe(projectDir);
    });

    it('should throw error when .sabin does not exist', async () => {
      await expect(resolveSabinDir(testDir)).rejects.toThrow('.sabin not found');
    });

    it('should throw error when .sabin file has invalid JSON', async () => {
      const sabinFile = path.join(testDir, '.sabin');
      await fs.writeFile(sabinFile, 'invalid json');

      await expect(resolveSabinDir(testDir)).rejects.toThrow();
    });

    it('should throw error when .sabin file missing sabinDir field', async () => {
      const sabinFile = path.join(testDir, '.sabin');
      await fs.writeFile(sabinFile, JSON.stringify({ foo: 'bar' }));

      await expect(resolveSabinDir(testDir)).rejects.toThrow('must contain "sabinDir"');
    });
  });

  describe('checkSabinType', () => {
    it('should return "directory" for .sabin directory', async () => {
      await fs.mkdir(path.join(testDir, '.sabin'));
      const type = await checkSabinType(testDir);
      expect(type).toBe('directory');
    });

    it('should return "file" for .sabin file', async () => {
      await fs.writeFile(path.join(testDir, '.sabin'), '{}');
      const type = await checkSabinType(testDir);
      expect(type).toBe('file');
    });

    it('should return "none" when .sabin does not exist', async () => {
      const type = await checkSabinType(testDir);
      expect(type).toBe('none');
    });
  });
});
