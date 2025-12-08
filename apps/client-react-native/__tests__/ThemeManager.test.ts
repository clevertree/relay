import { ThemeManager } from '../src/utils/themeManager';

describe('ThemeManager', () => {
  beforeEach(() => {
    ThemeManager.cleanup();
  });

  it('defaults to dark theme', async () => {
    await ThemeManager.initialize();
    expect(ThemeManager.getTheme()).toBe('dark');
    const tokens = ThemeManager.getTokens();
    expect(tokens.colors.bgPrimary).toBeDefined();
  });

  it('toggles themes', async () => {
    await ThemeManager.initialize();
    const next = await ThemeManager.toggleTheme();
    expect(['light', 'dark']).toContain(next);
  });
});
