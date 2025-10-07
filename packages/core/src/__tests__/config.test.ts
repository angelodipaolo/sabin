import fs from 'fs/promises';
import { readConfig, writeConfig, getDefaultConfig } from '../config';

jest.mock('fs/promises');

describe('config utilities', () => {
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('readConfig', () => {
    it('should return defaults when config file is missing', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const config = await readConfig('.sabin');

      expect(config).toEqual({
        projectPrefix: 'TASK',
        taskNumberPadding: 4
      });
    });

    it('should return config with partial config merged with defaults', async () => {
      mockFs.readFile.mockResolvedValue('{"projectPrefix":"MYPROJECT"}');

      const config = await readConfig('.sabin');

      expect(config).toEqual({
        projectPrefix: 'MYPROJECT',
        taskNumberPadding: 4
      });
    });

    it('should handle invalid JSON gracefully', async () => {
      mockFs.readFile.mockResolvedValue('not valid json{');

      const config = await readConfig('.sabin');

      expect(config).toEqual({
        projectPrefix: 'TASK',
        taskNumberPadding: 4
      });
    });

    it('should read complete config correctly', async () => {
      mockFs.readFile.mockResolvedValue('{"projectPrefix":"CUSTOM","taskNumberPadding":6}');

      const config = await readConfig('.sabin');

      expect(config).toEqual({
        projectPrefix: 'CUSTOM',
        taskNumberPadding: 6
      });
    });
  });

  describe('writeConfig', () => {
    it('should write config with proper JSON structure', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);

      await writeConfig({
        projectPrefix: 'TEST',
        taskNumberPadding: 5
      }, '.sabin');

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '.sabin/config.json',
        expect.stringContaining('"projectPrefix": "TEST"')
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '.sabin/config.json',
        expect.stringContaining('"taskNumberPadding": 5')
      );
    });

    it('should format JSON with 2 space indentation', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);

      await writeConfig({
        projectPrefix: 'TASK',
        taskNumberPadding: 4
      });

      const writtenContent = (mockFs.writeFile.mock.calls[0][1] as string);
      expect(writtenContent).toContain('{\n  "projectPrefix"');
    });
  });

  describe('getDefaultConfig', () => {
    it('should return expected defaults', () => {
      const config = getDefaultConfig();

      expect(config).toEqual({
        projectPrefix: 'TASK',
        taskNumberPadding: 4
      });
    });

    it('should return a new object each time', () => {
      const config1 = getDefaultConfig();
      const config2 = getDefaultConfig();

      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });
});
