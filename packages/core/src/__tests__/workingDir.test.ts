import { getWorkingDirName } from '../workingDir';

describe('workingDir', () => {
  describe('getWorkingDirName', () => {
    it('should return relative directory name', () => {
      const sabinDir = '/projects/.sabin';
      const projectRoot = '/projects/project-1';

      const result = getWorkingDirName(sabinDir, projectRoot);
      expect(result).toBe('project-1');
    });

    it('should return . for same directory', () => {
      const sabinDir = '/projects/.sabin';
      const projectRoot = '/projects';

      const result = getWorkingDirName(sabinDir, projectRoot);
      expect(result).toBe('.');
    });

    it('should handle nested directories', () => {
      const sabinDir = '/projects/.sabin';
      const projectRoot = '/projects/apps/web';

      const result = getWorkingDirName(sabinDir, projectRoot);
      expect(result).toBe('apps/web');
    });
  });
});
